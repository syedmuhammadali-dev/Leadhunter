import type { IncomingMessage } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { TaskQueue } from "./analyzer/queue.js";
import { buildApp } from "./app.js";
import { createSafeFetcher } from "./security/safe-fetch.js";
import { loadN8nConfig, triggerResearch } from "./services/n8n-client.js";
import { startTestSite, type SiteHandler, type TestSite } from "./testing/site-server.js";

try {
  process.loadEnvFile("../../.env");
} catch {
  // no .env: DB tests are skipped below
}

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
const COUNTRY = "ZZ-JobsApi";
const INTERNAL_KEY = "test-internal-key-0123456789abcdef";
const SECRET = "test-webhook-secret-0123456789abcdef";

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

describe("n8n client", () => {
  const cfg = (over: object = {}) => ({ ...loadN8nConfig({ N8N_WEBHOOK_SECRET: SECRET }), ...over });
  const reply = (status: number, body: string) => async () => ({ status, ok: status >= 200 && status < 300, text: async () => body });

  it("returns the job id from a good answer and sends the secret", async () => {
    let seen: { url: string; headers: Record<string, string>; body: string } | undefined;
    const r = await triggerResearch(cfg(), { city: "Dubai" }, async (u, init) => {
      seen = { url: u, headers: init.headers, body: init.body };
      return { status: 200, ok: true, text: async () => JSON.stringify({ jobId: "job123" }) };
    });
    expect(r).toEqual({ ok: true, jobId: "job123" });
    expect(seen!.headers["x-webhook-secret"]).toBe(SECRET);
    expect(JSON.parse(seen!.body)).toEqual({ city: "Dubai" });
    expect(seen!.url).toBe("http://localhost:5678/webhook/lead-research");
  });

  it.each([
    [404, "{}", "not-found"],
    [401, "{}", "rejected"],
    [403, "{}", "rejected"],
    [500, '{"error":"boom"}', "failed"],
    [200, "not json", "bad-response"],
    [200, '{"jobId":""}', "bad-response"],
    [200, '{"other":1}', "bad-response"],
  ])("maps HTTP %i %s to %s", async (status, body, reason) => {
    expect(await triggerResearch(cfg(), {}, reply(status, body))).toMatchObject({ ok: false, reason });
  });

  it("reports unreachable and not-configured states without leaking secrets", async () => {
    const down = await triggerResearch(cfg(), {}, async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(down).toMatchObject({ ok: false, reason: "unreachable" });
    const timeout = await triggerResearch(cfg(), {}, async () => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    });
    expect(timeout).toMatchObject({ ok: false, reason: "unreachable", message: expect.stringContaining("did not answer in time") });
    for (const bad of [cfg({ webhookSecret: undefined }), cfg({ webhookSecret: "change-me" }), cfg({ webhookUrl: "ftp://x" }), cfg({ webhookUrl: "nope" })]) {
      const r = await triggerResearch(bad, {}, reply(200, "{}"));
      expect(r).toMatchObject({ ok: false, reason: "not-configured" });
      expect(JSON.stringify(r)).not.toContain(SECRET);
    }
  });
});

describe.skipIf(!url)("research job API (Neon + fake n8n)", () => {
  let db: PrismaClient;
  let main: Awaited<ReturnType<typeof buildApp>>;
  const sites: TestSite[] = [];

  const clean = async () => {
    await db.business.deleteMany({ where: { location: { country: COUNTRY } } });
    await db.searchJob.deleteMany({ where: { country: COUNTRY } });
  };

  async function appFor(webhook: string, over: { secret?: string; maxActiveJobs?: number } = {}) {
    return buildApp({
      pingDb: async () => true,
      webOrigin: "http://localhost:3000",
      db,
      audit: { db, fetcher: createSafeFetcher(), queue: new TaskQueue(1, 5), performance: null },
      internalApiKey: INTERNAL_KEY,
      n8n: { webhookUrl: webhook, webhookSecret: over.secret ?? SECRET, timeoutMs: 3000 },
      maxActiveJobs: over.maxActiveJobs ?? 1000,
    });
  }

  /** Stand-in for the first half of the workflow: check the secret, create the job through the internal API, answer with its id. */
  const fakeWorkflow: SiteHandler = async (req, res) => {
    if (req.headers["x-webhook-secret"] !== SECRET) {
      res.writeHead(403, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "forbidden" }));
    }
    const body = JSON.parse(await readBody(req));
    const created = await main.inject({ method: "POST", url: "/internal/jobs", payload: body, headers: { "x-api-key": INTERNAL_KEY } });
    res.writeHead(created.statusCode === 201 ? 200 : 500, { "content-type": "application/json" });
    res.end(created.body);
  };

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const n8n = await startTestSite({ "/webhook/lead-research": fakeWorkflow, "/webhook/garbage": (_q, res) => res.end("hello") });
    sites.push(n8n);
    main = await appFor(`${n8n.origin}/webhook/lead-research`);
    await clean();
  });
  afterAll(async () => {
    await clean();
    await db.$disconnect();
    await Promise.all(sites.map((s) => s.close()));
  });

  const start = (payload: object, app = main) => app.inject({ method: "POST", url: "/api/search-jobs", payload });
  const good = { country: COUNTRY, city: "Testville", category: "Cafe", limit: 5 };

  it("starts a job through n8n and exposes its progress", async () => {
    const res = await start(good);
    expect(res.statusCode).toBe(202);
    const { jobId } = res.json();
    const job = (await main.inject({ method: "GET", url: `/api/search-jobs/${jobId}` })).json();
    expect(job).toMatchObject({ id: jobId, status: "RUNNING", step: "searching", country: COUNTRY, maxResults: 5, progress: 5 });

    const list = (await main.inject({ method: "GET", url: "/api/search-jobs?pageSize=100" })).json();
    expect(list.items.some((j: { id: string }) => j.id === jobId)).toBe(true);
    expect(list.total).toBeGreaterThanOrEqual(1);
  });

  it("fills in the default limit and validates input", async () => {
    const { jobId } = (await start({ country: COUNTRY, city: "Defaultville", category: "Cafe" })).json();
    expect((await main.inject({ method: "GET", url: `/api/search-jobs/${jobId}` })).json().maxResults).toBe(50);
    for (const bad of [{}, { ...good, limit: 0 }, { ...good, limit: 501 }, { ...good, country: "" }, { ...good, provider: "csv" }, { ...good, limit: "five" }]) {
      expect((await start(bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it("explains n8n problems: wrong secret, no active webhook, nonsense answer, n8n down", async () => {
    const wrongSecret = await appFor(`${sites[0]!.origin}/webhook/lead-research`, { secret: "another-secret-0123456789abcdef" });
    const r1 = await start(good, wrongSecret);
    expect(r1.statusCode).toBe(502);
    expect(r1.json()).toMatchObject({ reason: "rejected" });

    const missing = await appFor(`${sites[0]!.origin}/webhook/not-imported`);
    expect(((await start(good, missing)).json())).toMatchObject({ reason: "not-found" });

    const garbage = await appFor(`${sites[0]!.origin}/webhook/garbage`);
    expect(((await start(good, garbage)).json())).toMatchObject({ reason: "bad-response" });

    const dead = await startTestSite({});
    const deadUrl = `${dead.origin}/webhook/lead-research`;
    await dead.close();
    const down = await start(good, await appFor(deadUrl));
    expect(down.statusCode).toBe(502);
    expect(down.json()).toMatchObject({ reason: "unreachable", error: expect.stringContaining("Cannot reach n8n") });

    const unconfigured = await appFor(deadUrl, { secret: "change-me" });
    expect((await start(good, unconfigured)).statusCode).toBe(503);
  });

  it("refuses to start more jobs than allowed at once", async () => {
    const active = await db.searchJob.count({ where: { status: { in: ["RUNNING", "QUEUED"] } } });
    const limited = await appFor(`${sites[0]!.origin}/webhook/lead-research`, { maxActiveJobs: active });
    const res = await start(good, limited);
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toMatch(/already running/);
  });

  it("returns 404 for an unknown job and 400 for a bad query", async () => {
    expect((await main.inject({ method: "GET", url: "/api/search-jobs/missing" })).statusCode).toBe(404);
    expect((await main.inject({ method: "GET", url: "/api/search-jobs?pageSize=1000" })).statusCode).toBe(400);
  });

  it("lets the leads list be filtered to one job's results", async () => {
    const { jobId } = (await start({ ...good, city: "Linkville" })).json();
    const biz = await db.business.create({
      data: {
        name: "Linked Cafe", normalizedName: "linked cafe", category: "Cafe", source: "test", dedupeKey: `linked cafe|${Date.now()}`,
        location: { create: { country: COUNTRY, city: "Linkville" } }, lead: { create: {} },
        searchResults: { create: { jobId } },
      },
    });
    await db.business.create({
      data: { name: "Other Cafe", normalizedName: "other cafe", category: "Cafe", source: "test", dedupeKey: `other cafe|${Date.now()}`, location: { create: { country: COUNTRY, city: "Linkville" } }, lead: { create: {} } },
    });
    const leads = (await main.inject({ method: "GET", url: `/api/leads?jobId=${jobId}&country=${COUNTRY}` })).json();
    expect(leads.items.map((l: { businessId: string }) => l.businessId)).toEqual([biz.id]);
    expect((await main.inject({ method: "GET", url: `/api/leads?country=${COUNTRY}&pageSize=50` })).json().total).toBeGreaterThanOrEqual(2);
  });
});
