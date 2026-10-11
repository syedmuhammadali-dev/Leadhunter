import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
const COUNTRY = "ZZ-Audit";

const PAGE = `<html lang="en"><head><title>Test Shop</title></head><body>
<a href="tel:+15550123">Call</a><a href="mailto:shop@test.example">Mail</a><a href="https://facebook.com/testshop">FB</a>
<a href="/gone">Old</a><p>Hello</p></body></html>`;

describe.skipIf(!url)("website audits via the API (Neon + local sites)", () => {
  let db: PrismaClient;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const sites: TestSite[] = [];
  let counter = 0;

  async function business(website: string | null) {
    const n = ++counter;
    return db.business.create({
      data: {
        name: `Audit Test ${n}`, normalizedName: `audit test ${n}`, category: "Test", website,
        websiteDomain: website ? `h${n}.test` : null, websiteStatus: website ? "UNKNOWN" : "NO_WEBSITE",
        source: "test", dedupeKey: `audit test ${n}|nowhere|${Date.now()}`,
        location: { create: { country: COUNTRY, city: "Nowhere" } },
      },
    });
  }

  async function site(routes: Parameters<typeof startTestSite>[0]) {
    const s = await startTestSite(routes);
    sites.push(s);
    return s;
  }

  async function waitFor(auditId: string) {
    for (let i = 0; i < 100; i++) {
      const res = await app.inject({ method: "GET", url: `/api/audits/${auditId}` });
      const body = res.json();
      if (!["PENDING", "RUNNING"].includes(body.status)) return body;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("audit did not finish");
  }

  const clean = () => db.business.deleteMany({ where: { location: { country: COUNTRY } } });

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const guardAll = () => createSafeFetcher({ guard: createUrlGuard({ testAllowList: sites.map((s) => s.hostPort) }) });
    // The fetcher reads the allow-list lazily so sites started per test are allowed.
    const lazyFetcher = { fetch: (u: string, o?: Parameters<ReturnType<typeof guardAll>["fetch"]>[1]) => guardAll().fetch(u, o) };
    app = await buildApp({
      pingDb: async () => true,
      webOrigin: "http://localhost:3000",
      db,
      audit: { db, fetcher: lazyFetcher, queue: new TaskQueue(2, 5), performance: null },
    });
    await clean();
  });
  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await db.$disconnect();
    await Promise.all(sites.map((s) => s.close()));
  });

  it("runs an audit, stores score, breakdown and issues, and updates the business", async () => {
    const s = await site({ "/": PAGE });
    const biz = await business(`${s.origin}/`);
    const res = await app.inject({ method: "POST", url: `/api/businesses/${biz.id}/audit` });
    expect(res.statusCode).toBe(202);
    const audit = await waitFor(res.json().auditId);

    expect(audit.status).toBe("COMPLETED");
    expect(audit.httpStatus).toBe(200);
    expect(audit.title).toBe("Test Shop");
    expect(audit.usesHttps).toBe(false);
    expect(audit.websiteScore).toBeGreaterThanOrEqual(0);
    expect(audit.websiteScore).toBeLessThan(100);
    const deducted = audit.issues.reduce((sum: number, i: { pointsDeducted: number }) => sum + i.pointsDeducted, 0);
    expect(audit.websiteScore).toBe(Math.max(0, 100 - deducted));
    expect(audit.scoreBreakdown.length).toBe(audit.issues.length);
    const types = audit.issues.map((i: { type: string }) => i.type);
    expect(types).toEqual(expect.arrayContaining(["no-https", "broken-links", "missing-meta-description"]));
    expect(audit.issues[0].pointsDeducted).toBeGreaterThanOrEqual(audit.issues.at(-1).pointsDeducted);
    expect(audit.issues.every((i: { explanation: string; severity: string }) => i.explanation && i.severity)).toBe(true);

    const after = await db.business.findUniqueOrThrow({ where: { id: biz.id }, include: { contactMethods: true } });
    expect(after.websiteStatus).toBe("ACTIVE");
    expect(after.contactMethods.map((c) => c.type).sort()).toEqual(["EMAIL", "FACEBOOK", "PHONE"]);
    expect(after.contactMethods.every((c) => c.source === "website-audit")).toBe(true);

    const list = (await app.inject({ method: "GET", url: `/api/businesses/${biz.id}/audits` })).json();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(audit.id);
  });

  it("does not start a second audit while one is running", async () => {
    const s = await site({
      "/": (_q, res) => setTimeout(() => { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE); }, 600),
    });
    const biz = await business(`${s.origin}/`);
    const first = (await app.inject({ method: "POST", url: `/api/businesses/${biz.id}/audit` })).json();
    const second = (await app.inject({ method: "POST", url: `/api/businesses/${biz.id}/audit` })).json();
    expect(second.auditId).toBe(first.auditId);
    expect(second.reused).toBe(true);
    await waitFor(first.auditId);
    expect(await db.websiteAudit.count({ where: { businessId: biz.id } })).toBe(1);
  });

  it("records FAILED + UNREACHABLE for a dead site, and SKIPPED for a robots-disallowed site", async () => {
    const dead = await startTestSite({});
    const deadUrl = dead.origin;
    sites.push(dead);
    const deadBiz = await business(`${deadUrl}/`);
    const deadStart = (await app.inject({ method: "POST", url: `/api/businesses/${deadBiz.id}/audit` })).json();
    await dead.close();
    const failed = await waitFor(deadStart.auditId);
    expect(failed.status).toBe("FAILED");
    expect(failed.errorMessage).toBeTruthy();
    expect((await db.business.findUniqueOrThrow({ where: { id: deadBiz.id } })).websiteStatus).toBe("UNREACHABLE");

    const closed = await site({ "/": PAGE, "/robots.txt": "User-agent: *\nDisallow: /" });
    const closedBiz = await business(`${closed.origin}/`);
    const start = (await app.inject({ method: "POST", url: `/api/businesses/${closedBiz.id}/audit` })).json();
    const skipped = await waitFor(start.auditId);
    expect(skipped.status).toBe("SKIPPED");
    expect(skipped.issues).toHaveLength(0);
    expect(closed.hits).not.toContain("GET /");
  });

  it("blocks audits of internal addresses (SSRF) even though the business is in the database", async () => {
    const internal = await business("http://169.254.169.254/latest/meta-data/");
    const start = (await app.inject({ method: "POST", url: `/api/businesses/${internal.id}/audit` })).json();
    const audit = await waitFor(start.auditId);
    expect(audit.status).toBe("FAILED");
    expect(audit.errorMessage).toMatch(/not allowed|blocked/i);
    expect((await db.business.findUniqueOrThrow({ where: { id: internal.id } })).websiteStatus).toBe("ERROR");
  });

  it("validates requests: unknown id, no website, bad batches", async () => {
    expect((await app.inject({ method: "POST", url: "/api/businesses/does-not-exist/audit" })).statusCode).toBe(404);
    const noSite = await business(null);
    const r = await app.inject({ method: "POST", url: `/api/businesses/${noSite.id}/audit` });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/no website/i);

    expect((await app.inject({ method: "POST", url: "/api/audits/batch", payload: { businessIds: [] } })).statusCode).toBe(400);
    const tooMany = Array.from({ length: 26 }, (_, i) => `id${i}`);
    expect((await app.inject({ method: "POST", url: "/api/audits/batch", payload: { businessIds: tooMany } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/audits/nope" })).statusCode).toBe(404);
  });

  it("starts a batch, skipping businesses that cannot be audited", async () => {
    const s = await site({ "/": PAGE });
    const a = await business(`${s.origin}/`);
    const noSite = await business(null);
    const res = await app.inject({ method: "POST", url: "/api/audits/batch", payload: { businessIds: [a.id, noSite.id, "missing", a.id] } });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.started).toHaveLength(1);
    expect(body.skipped.map((x: { businessId: string }) => x.businessId).sort()).toEqual([noSite.id, "missing"].sort());
    expect((await waitFor(body.started[0].auditId)).status).toBe("COMPLETED");
  });
});
