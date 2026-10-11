import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { TaskQueue } from "./analyzer/queue.js";
import { buildApp } from "./app.js";
import { createSafeFetcher } from "./security/safe-fetch.js";
import { createUrlGuard } from "./security/url-guard.js";
import { startTestSite, type TestSite } from "./testing/site-server.js";

try {
  process.loadEnvFile("../../.env");
} catch {
  // no .env: DB tests are skipped below
}

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
const COUNTRY = "ZZ-Internal";
const KEY = "test-internal-key-0123456789abcdef";

describe.skipIf(!url)("internal job routes used by n8n (Neon)", () => {
  let db: PrismaClient;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let site: TestSite;
  const sites: TestSite[] = [];

  const call = async (method: "GET" | "POST", path: string, payload?: unknown, key: string | null = KEY) => {
    const res = await app.inject({ method, url: path, payload: payload as object | undefined, headers: key ? { "x-api-key": key } : {} });
    return { status: res.statusCode, body: res.json() };
  };
  const newJob = async (limit = 6, city = "Testville") => (await call("POST", "/internal/jobs", { country: COUNTRY, city, category: "Cafe", limit, provider: "mock" })).body.jobId as string;
  const clean = async () => {
    await db.business.deleteMany({ where: { location: { country: COUNTRY } } });
    await db.searchJob.deleteMany({ where: { country: COUNTRY } });
  };

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    site = await startTestSite({ "/": `<html lang="en"><head><title>Local Cafe</title></head><body><a href="tel:+15550100">Call</a><p>${"Coffee and cake. ".repeat(20)}</p></body></html>` });
    sites.push(site);
    const lazyFetcher = {
      fetch: (u: string, o?: Parameters<ReturnType<typeof createSafeFetcher>["fetch"]>[1]) =>
        createSafeFetcher({ guard: createUrlGuard({ testAllowList: sites.map((s) => s.hostPort) }) }).fetch(u, o),
    };
    app = await buildApp({
      pingDb: async () => true,
      webOrigin: "http://localhost:3000",
      db,
      audit: { db, fetcher: lazyFetcher, queue: new TaskQueue(2, 20), performance: null },
      internalApiKey: KEY,
      maxAuditsPerJob: 3,
    });
    await clean();
  });
  afterAll(async () => {
    await clean();
    await db.$disconnect();
    await Promise.all(sites.map((s) => s.close()));
  });

  it("requires the API key", async () => {
    expect((await call("POST", "/internal/jobs", {}, null)).status).toBe(401);
    expect((await call("POST", "/internal/jobs", {}, "wrong")).status).toBe(401);
    expect((await call("GET", "/internal/jobs/whatever", undefined, null)).status).toBe(401);
  });

  it("validates new jobs", async () => {
    for (const bad of [{}, { country: COUNTRY, city: "x", category: "y", limit: 0 }, { country: COUNTRY, city: "x", category: "y", limit: 501 }, { country: "", city: "x", category: "y", limit: 5 }, { country: COUNTRY, city: "x", category: "y", limit: 5, provider: "csv" }]) {
      expect((await call("POST", "/internal/jobs", bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("runs the whole research flow: search, save, audit, score, complete", async () => {
    const jobId = await newJob(6);
    const search = await call("POST", `/internal/jobs/${jobId}/search`);
    expect(search.status).toBe(200);
    expect(search.body.count).toBe(6);

    // A real business with a reachable (local test) website joins the mock results.
    const businesses = [...search.body.businesses, { name: "Local Test Cafe", category: "Cafe", country: COUNTRY, city: "Testville", website: `${site.origin}/`, reviewCount: 600 }];
    const saved = await call("POST", `/internal/jobs/${jobId}/save`, { businesses });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ found: 7, inserted: 7, duplicatesSkipped: 0 });
    expect(saved.body.websitesFound).toBeGreaterThanOrEqual(1);
    expect(saved.body.auditsPlanned).toBe(3); // capped by maxAuditsPerJob
    expect(saved.body.toAudit).toHaveLength(3);
    expect(saved.body.auditsLeftOutByLimit).toBe(saved.body.websitesFound - 3);

    const localBusiness = await db.business.findFirstOrThrow({ where: { name: "Local Test Cafe", location: { country: COUNTRY } } });
    const mid = await call("GET", `/internal/jobs/${jobId}`);
    expect(mid.body).toMatchObject({ status: "RUNNING", step: "auditing", businessesFound: 7, auditsPlanned: 3 });

    // The workflow audits one site at a time.
    const ok = await call("POST", `/internal/jobs/${jobId}/audit`, { businessId: localBusiness.id });
    expect(ok.body).toMatchObject({ status: "COMPLETED" });
    expect(typeof ok.body.websiteScore).toBe("number");

    const failing = saved.body.toAudit.find((id: string) => id !== localBusiness.id) as string;
    const failed = await call("POST", `/internal/jobs/${jobId}/audit`, { businessId: failing });
    expect(failed.body.status).toBe("FAILED"); // *.example does not exist

    const after = (await call("GET", `/internal/jobs/${jobId}`)).body;
    expect(after).toMatchObject({ auditsCompleted: 1, auditsFailed: 1 });
    expect(after.progress).toBeGreaterThan(25);

    const scored = await call("POST", `/internal/jobs/${jobId}/score`);
    expect(scored.body).toMatchObject({ scored: 7 });
    expect((await call("GET", `/internal/jobs/${jobId}`)).body.step).toBe("scoring");

    const done = await call("POST", `/internal/jobs/${jobId}/complete`);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: "COMPLETED", step: "done", progress: 100, businessesFound: 7, auditsCompleted: 1, auditsFailed: 1 });
    expect(done.body.highPriorityCount).toBeGreaterThanOrEqual(1); // no-website businesses and the 600-review cafe

    // The local cafe was scored from its audit and linked to the job.
    const lead = await db.lead.findUniqueOrThrow({ where: { businessId: localBusiness.id } });
    expect(lead.score).not.toBeNull();
    expect(await db.searchResult.count({ where: { jobId } })).toBe(7);

    // Finished jobs cannot be changed any more.
    expect((await call("POST", `/internal/jobs/${jobId}/complete`)).status).toBe(409);
    expect((await call("POST", `/internal/jobs/${jobId}/search`)).status).toBe(409);
    expect((await call("POST", `/internal/jobs/${jobId}/progress`, { step: "saving" })).status).toBe(409);
  }, 120_000);

  it("links duplicates found by an earlier job instead of re-inserting them", async () => {
    const first = await newJob(5, "Dupeville");
    const found = (await call("POST", `/internal/jobs/${first}/search`)).body.businesses;
    await call("POST", `/internal/jobs/${first}/save`, { businesses: found });

    const second = await newJob(5, "Dupeville");
    const again = (await call("POST", `/internal/jobs/${second}/search`)).body.businesses;
    const saved = await call("POST", `/internal/jobs/${second}/save`, { businesses: again });
    expect(saved.body).toMatchObject({ found: 5, inserted: 0, duplicatesSkipped: 5 });
    expect(await db.searchResult.count({ where: { jobId: second } })).toBe(5);
    expect(await db.business.count({ where: { location: { country: COUNTRY, city: "Dupeville" } } })).toBe(5);
  });

  it("rejects bad input, unknown jobs and businesses from other jobs", async () => {
    const jobId = await newJob(2, "Strict");
    const badBodies = [{}, { businesses: [{ name: "x" }] }, { businesses: [{ name: "n", category: "c", country: "c", city: "c", website: "javascript:alert(1)" }] }, { businesses: [{ name: "n", category: "c", country: "c", city: "c", rating: 9 }] }];
    for (const body of badBodies) expect((await call("POST", `/internal/jobs/${jobId}/save`, body)).status, JSON.stringify(body)).toBe(400);
    expect((await call("POST", `/internal/jobs/${jobId}/save`, { businesses: Array.from({ length: 501 }, (_, i) => ({ name: `n${i}`, category: "c", country: "c", city: "c" })) })).status).toBe(400);

    expect((await call("POST", "/internal/jobs/missing/search")).status).toBe(404);
    expect((await call("GET", "/internal/jobs/missing")).status).toBe(404);
    expect((await call("POST", `/internal/jobs/${jobId}/progress`, { step: "flying" })).status).toBe(400);

    const stranger = await db.business.findFirstOrThrow({ where: { location: { country: COUNTRY } } });
    expect((await call("POST", `/internal/jobs/${jobId}/audit`, { businessId: stranger.id })).status).toBe(404);
    expect((await call("POST", `/internal/jobs/${jobId}/audit`, {})).status).toBe(400);
  });

  it("can mark a job as failed with a message", async () => {
    const jobId = await newJob(2, "Failville");
    const res = await call("POST", `/internal/jobs/${jobId}/fail`, { message: "provider timed out" });
    expect(res.body).toMatchObject({ status: "FAILED", errorMessage: "provider timed out" });
    expect((await call("POST", `/internal/jobs/${jobId}/fail`, {})).status).toBe(409);
  });
});
