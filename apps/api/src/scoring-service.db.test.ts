import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { TaskQueue } from "./analyzer/queue.js";
import { buildApp } from "./app.js";
import { buildScoringConfig, getScoringConfig, setScoringConfig } from "./scoring/config.js";
import { createSafeFetcher } from "./security/safe-fetch.js";
import { createUrlGuard } from "./security/url-guard.js";
import { recalculateAll, scoreBusinesses } from "./services/scoring-service.js";
import { startTestSite, type TestSite } from "./testing/site-server.js";

try {
  process.loadEnvFile("../../.env");
} catch {
  // no .env: DB tests are skipped below
}

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
const COUNTRY = "ZZ-Score";

describe.skipIf(!url)("lead scoring service (Neon)", () => {
  let db: PrismaClient;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const sites: TestSite[] = [];
  let n = 0;

  const clean = () => db.business.deleteMany({ where: { location: { country: COUNTRY } } });

  async function business(website: string | null, reviewCount: number | null = 0) {
    const i = ++n;
    return db.business.create({
      data: {
        name: `Score Test ${i}`, normalizedName: `score test ${i}`, category: "Test", website, reviewCount,
        websiteStatus: website ? "UNKNOWN" : "NO_WEBSITE", source: "test", dedupeKey: `score test ${i}|nowhere|${Date.now()}`,
        location: { create: { country: COUNTRY, city: "Nowhere" } },
        lead: { create: {} },
      },
      include: { lead: true },
    });
  }

  const leadOf = (businessId: string) => db.lead.findUniqueOrThrow({ where: { businessId }, include: { scores: { orderBy: { calculatedAt: "desc" } } } });

  async function until<T>(read: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
    for (let i = 0; i < 100; i++) {
      const v = await read();
      if (done(v)) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("condition not reached");
  }

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const lazyFetcher = {
      fetch: (u: string, o?: Parameters<ReturnType<typeof createSafeFetcher>["fetch"]>[1]) =>
        createSafeFetcher({ guard: createUrlGuard({ testAllowList: sites.map((s) => s.hostPort) }) }).fetch(u, o),
    };
    app = await buildApp({
      pingDb: async () => true,
      webOrigin: "http://localhost:3000",
      db,
      audit: { db, fetcher: lazyFetcher, queue: new TaskQueue(2, 5), performance: null },
    });
    await clean();
  });
  beforeEach(clean);
  afterEach(() => setScoringConfig(undefined));
  afterAll(async () => {
    await clean();
    await db.$disconnect();
    await Promise.all(sites.map((s) => s.close()));
  });

  it("scores businesses on import: no website, strong presence, and unaudited website", async () => {
    const csv = [
      "name,category,country,city,website,reviewCount",
      `Plain No Site,Test,${COUNTRY},Nowhere,,10`,
      `Popular No Site,Test,${COUNTRY},Nowhere,,900`,
      `Has Site,Test,${COUNTRY},Nowhere,hassite-score.example,40`,
    ].join("\n");
    expect((await app.inject({ method: "POST", url: "/api/import/csv", payload: { csvText: csv } })).statusCode).toBe(200);

    const get = (name: string) => db.lead.findFirstOrThrow({ where: { business: { name } }, include: { scores: true } });
    const plain = await get("Plain No Site");
    expect(plain).toMatchObject({ score: 5, priority: "MEDIUM", maximumScore: 17 });
    expect(plain.scoredAt).toBeTruthy();
    expect(plain.scores[0]!.reasons).toEqual(["No website found (+5)"]);

    const popular = await get("Popular No Site");
    expect(popular).toMatchObject({ score: 7, priority: "HIGH" });
    expect(popular.scores[0]!.reasons).toEqual(["No website found (+5)", "Strong public presence: 900 reviews (+2)"]);

    const unaudited = await get("Has Site");
    expect(unaudited).toMatchObject({ score: 0, priority: "LOW" });
    const stored = unaudited.scores[0]!.signals as { signals: { signal: string; evaluated: boolean }[]; notes: string[] };
    expect(stored.notes[0]).toMatch(/not been audited/);
    expect(stored.signals.find((s) => s.signal === "noCta")!.evaluated).toBe(false);
  });

  it("only writes a new history row when the score actually changes", async () => {
    const b = await business(null, 0);
    expect((await scoreBusinesses(db, [b.id])).changed).toBe(1);
    expect((await scoreBusinesses(db, [b.id])).changed).toBe(0);
    expect((await leadOf(b.id)).scores).toHaveLength(1);

    // Same weights but a different config version: history records the new rules.
    const custom = buildScoringConfig({ signals: { noWebsite: { weight: 8 } } });
    expect((await scoreBusinesses(db, [b.id], custom)).changed).toBe(1);
    const lead = await leadOf(b.id);
    expect(lead.scores).toHaveLength(2);
    expect(lead).toMatchObject({ score: 8, priority: "HIGH" });
    expect(lead.scores.map((s) => s.configVersion)).toEqual([custom.version, getScoringConfig().version]);
  });

  it("recalculates with a new config (scoped to test data so other leads are not touched)", async () => {
    const b = await business(null, 0);
    await scoreBusinesses(db, [b.id]);
    const custom = buildScoringConfig({ signals: { noWebsite: { weight: 10 } } });
    setScoringConfig(custom);
    const summary = await recalculateAll(db, custom, { location: { is: { country: COUNTRY } } });
    expect(summary).toMatchObject({ scored: 1, changed: 1, configVersion: custom.version });
    expect((await leadOf(b.id)).score).toBe(10);

    // The API route reports the active config; it is only checked, not run, here because it scores every lead.
    const cfg = (await app.inject({ method: "GET", url: "/api/scoring/config" })).json();
    expect(cfg.signals.noWebsite.weight).toBe(10);
    // The maximum is the best of the two paths: website signals (15) or no-website (10), plus 2 for presence.
    expect(cfg.maximumScore).toBe(17);
  });

  it("rescores a lead after its website audit finishes", async () => {
    const s = await startTestSite({ "/": `<html><head><title>Plain</title></head><body><p>${"Hello there. ".repeat(30)}</p></body></html>` });
    sites.push(s);
    const b = await business(`${s.origin}/`, 150);
    await scoreBusinesses(db, [b.id]);
    expect((await leadOf(b.id)).score).toBe(1); // only "solid presence" until the site is audited

    const started = (await app.inject({ method: "POST", url: `/api/businesses/${b.id}/audit` })).json();
    expect(started.auditId).toBeTruthy();
    const lead = await until(() => leadOf(b.id), (l) => (l.score ?? 0) > 1);

    // The test page has no viewport, no CTA, no WhatsApp, no contact info, and a missing meta description.
    const reasons = lead.scores[0]!.reasons as string[];
    expect(reasons).toEqual(
      expect.arrayContaining(["Website has major mobile problems (+3)", "No clear call to action (+2)", "No WhatsApp/contact option (+2)", "Important contact problems (+2)", "Missing basic SEO elements (+2)"]),
    );
    expect(lead.scores[0]!.score).toBe(lead.score);
    const biz = await db.business.findUniqueOrThrow({ where: { id: b.id } });
    expect(biz.websiteScore).toBeGreaterThan(0);
    expect(biz.lastAuditedAt).toBeTruthy();
  });

  it("adds the unreachable signal when the website cannot be reached", async () => {
    const dead = await startTestSite({});
    sites.push(dead);
    const origin = dead.origin;
    const b = await business(`${origin}/`, 0);
    const started = (await app.inject({ method: "POST", url: `/api/businesses/${b.id}/audit` })).json();
    await dead.close();
    const lead = await until(() => leadOf(b.id), (l) => l.score === 3);
    expect(lead.scores[0]!.reasons).toEqual(["Website could not be reached (+3)"]);
    expect(started.auditId).toBeTruthy();
  });
});
