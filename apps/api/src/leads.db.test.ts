import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildApp } from "./app.js";
import { scoreBusinesses } from "./services/scoring-service.js";

try {
  process.loadEnvFile("../../.env");
} catch {
  // no .env: DB tests are skipped below
}

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
const COUNTRY = "ZZ-Leads";

describe.skipIf(!url)("leads API (Neon)", () => {
  let db: PrismaClient;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const ids: Record<string, { business: string; lead: string }> = {};

  async function add(name: string, opts: { website?: string; reviews?: number | null; city?: string; rating?: number; status?: "UNKNOWN" | "ACTIVE" | "UNREACHABLE"; audit?: { status: "COMPLETED" | "FAILED"; score?: number; issues?: { type: string; title: string; points: number }[] } }) {
    const b = await db.business.create({
      data: {
        name, normalizedName: name.toLowerCase(), category: "Test", website: opts.website ?? null,
        websiteStatus: opts.website ? (opts.status ?? "UNKNOWN") : "NO_WEBSITE", reviewCount: opts.reviews ?? null, rating: opts.rating ?? null,
        websiteScore: opts.audit?.score ?? null, source: "test", dedupeKey: `${name.toLowerCase()}|${COUNTRY}|${Date.now()}`,
        location: { create: { country: COUNTRY, city: opts.city ?? "Testville" } },
        lead: { create: {} },
        contactMethods: { create: [{ type: "PHONE", value: "+1 555 0100", source: "test" }] },
        ...(opts.audit
          ? {
              audits: {
                create: {
                  url: opts.website!, status: opts.audit.status, websiteScore: opts.audit.score ?? null,
                  issues: { create: (opts.audit.issues ?? []).map((i) => ({ type: i.type, severity: "HIGH" as const, title: i.title, explanation: "x", pointsDeducted: i.points })) },
                },
              },
            }
          : {}),
      },
      include: { lead: true },
    });
    ids[name] = { business: b.id, lead: b.lead!.id };
  }

  const list = async (query = "") => {
    const pageSize = query.includes("pageSize=") ? "" : "&pageSize=50";
    return (await app.inject({ method: "GET", url: `/api/leads?country=${COUNTRY}${pageSize}${query ? `&${query}` : ""}` })).json();
  };
  const names = async (query = "") => (await list(query)).items.map((i: { name: string }) => i.name);

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    app = await buildApp({ pingDb: async () => true, webOrigin: "http://localhost:3000", db });
    await db.business.deleteMany({ where: { location: { country: COUNTRY } } });

    await add("Zeta Grill", { reviews: 900, rating: 4.5 });
    await add("Alpha Cafe", { reviews: 10, rating: 3.9 });
    await add("Bravo Bakery", {
      website: "https://bravo.example/", status: "ACTIVE", reviews: 120, rating: 4.1,
      audit: { status: "COMPLETED", score: 70, issues: [{ type: "missing-viewport", title: "No mobile viewport tag", points: 15 }, { type: "no-cta", title: "No clear call to action", points: 8 }, { type: "no-sitemap", title: "No sitemap", points: 2 }] },
    });
    await add("Charlie Gym", { website: "https://charlie.example/", status: "ACTIVE", reviews: 5, rating: 4.8, audit: { status: "COMPLETED", score: 100 } });
    await add("Delta Spa", { website: "https://delta.example/", status: "UNREACHABLE", audit: { status: "FAILED" } });
    await add("Echo Dental", { website: "https://echo.example/", city: "Elsewhere" });
    await scoreBusinesses(db, Object.values(ids).map((x) => x.business));
  });
  afterAll(async () => {
    await db.business.deleteMany({ where: { location: { country: COUNTRY } } });
    await db.$disconnect();
  });

  it("sorts by score (highest first) with alphabetical tie-breaks, and reports scores", async () => {
    const body = await list();
    expect(body.total).toBe(6);
    expect(body.items.map((i: { name: string }) => i.name)).toEqual(["Zeta Grill", "Bravo Bakery", "Alpha Cafe", "Delta Spa", "Charlie Gym", "Echo Dental"]);
    expect(body.items.map((i: { score: number }) => i.score)).toEqual([7, 6, 5, 3, 0, 0]);
    expect(body.items.map((i: { priority: string }) => i.priority)).toEqual(["HIGH", "HIGH", "MEDIUM", "MEDIUM", "LOW", "LOW"]);
    expect(body.items[0].maximumScore).toBe(17);
  });

  it("sorts by the other keys, putting missing values last", async () => {
    expect(await names("sort=score&dir=asc")).toEqual(["Charlie Gym", "Echo Dental", "Delta Spa", "Alpha Cafe", "Bravo Bakery", "Zeta Grill"]);
    expect(await names("sort=name&dir=asc")).toEqual(["Alpha Cafe", "Bravo Bakery", "Charlie Gym", "Delta Spa", "Echo Dental", "Zeta Grill"]);
    expect(await names("sort=websiteScore&dir=desc")).toEqual(["Charlie Gym", "Bravo Bakery", "Alpha Cafe", "Delta Spa", "Echo Dental", "Zeta Grill"]);
    expect((await names("sort=reviews&dir=desc")).slice(0, 3)).toEqual(["Zeta Grill", "Bravo Bakery", "Alpha Cafe"]);
    expect((await names("sort=rating&dir=desc")).slice(0, 2)).toEqual(["Charlie Gym", "Zeta Grill"]);
  });

  it("applies the quick filters", async () => {
    expect(await names("filter=no-website")).toEqual(["Zeta Grill", "Alpha Cafe"]);
    expect((await names("filter=has-website")).length).toBe(4);
    expect(await names("filter=problems")).toEqual(["Bravo Bakery", "Delta Spa"]);
    expect(await names("filter=high")).toEqual(["Zeta Grill", "Bravo Bakery"]);
    expect(await names("filter=medium")).toEqual(["Alpha Cafe", "Delta Spa"]);
    expect(await names("filter=low")).toEqual(["Charlie Gym", "Echo Dental"]);
  });

  it("filters by score range, priority, text, city and combines filters", async () => {
    expect(await names("minScore=5")).toEqual(["Zeta Grill", "Bravo Bakery", "Alpha Cafe"]);
    expect(await names("maxScore=0")).toEqual(["Charlie Gym", "Echo Dental"]);
    expect(await names("minScore=3&maxScore=5")).toEqual(["Alpha Cafe", "Delta Spa"]);
    expect(await names("priority=HIGH&filter=has-website")).toEqual(["Bravo Bakery"]);
    expect(await names("q=bakery")).toEqual(["Bravo Bakery"]);
    expect(await names("city=elsewhere")).toEqual(["Echo Dental"]);
    expect(await names("status=NEW")).toHaveLength(6);
    expect(await names("status=WON")).toEqual([]);
  });

  it("paginates, clamps pages and honours the maximum results cap", async () => {
    const p1 = await list("pageSize=2&page=1");
    const p3 = await list("pageSize=2&page=3");
    expect(p1).toMatchObject({ total: 6, pages: 3, page: 1 });
    expect(p1.items.map((i: { name: string }) => i.name)).toEqual(["Zeta Grill", "Bravo Bakery"]);
    expect(p3.items.map((i: { name: string }) => i.name)).toEqual(["Charlie Gym", "Echo Dental"]);
    expect((await list("pageSize=2&page=99")).page).toBe(3);

    const capped = await list("limit=3&pageSize=2&page=2");
    expect(capped.total).toBe(3);
    expect(capped.items.map((i: { name: string }) => i.name)).toEqual(["Alpha Cafe"]);
  });

  it("lists the main problems from the audit", async () => {
    const byName = Object.fromEntries((await list()).items.map((i: { name: string }) => [i.name, i]));
    expect(byName["Zeta Grill"].problems).toEqual(["No website"]);
    expect(byName["Delta Spa"].problems).toEqual(["Website unreachable"]);
    expect(byName["Bravo Bakery"].problems).toEqual(["No mobile viewport tag", "No clear call to action"]);
    expect(byName["Charlie Gym"].problems).toEqual([]);
    expect(byName["Echo Dental"].problems).toEqual([]);
    expect(byName["Bravo Bakery"]).toMatchObject({ auditStatus: "COMPLETED", websiteScore: 70, city: "Testville", country: COUNTRY });
  });

  it("rejects invalid queries", async () => {
    for (const bad of ["sort=bogus", "pageSize=1000", "page=0", "priority=URGENT", "minScore=-1", "filter=nope"]) {
      expect((await app.inject({ method: "GET", url: `/api/leads?${bad}` })).statusCode, bad).toBe(400);
    }
  });

  it("returns a lead's detail with the score explanation, contacts and history", async () => {
    const res = await app.inject({ method: "GET", url: `/api/leads/${ids["Zeta Grill"]!.lead}` });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d).toMatchObject({ name: "Zeta Grill", score: 7, priority: "HIGH", status: "NEW", businessId: ids["Zeta Grill"]!.business });
    expect(d.latestScore.reasons).toEqual(["No website found (+5)", "Strong public presence: 900 reviews (+2)"]);
    expect(d.latestScore.details.signals.length).toBeGreaterThan(0);
    expect(d.latestScore.configVersion).toMatch(/^[0-9a-f]{8}$/);
    expect(d.contactMethods).toEqual([{ type: "PHONE", value: "+1 555 0100", source: "test" }]);
    expect(d.scoreHistory).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: "/api/leads/missing" })).statusCode).toBe(404);
  });

  it("returns dashboard stats", async () => {
    const s = (await app.inject({ method: "GET", url: "/api/leads/stats" })).json();
    expect(s.total).toBeGreaterThanOrEqual(6);
    expect(s.byPriority.HIGH).toBeGreaterThanOrEqual(2);
    expect(s.noWebsite).toBeGreaterThanOrEqual(2);
    expect(typeof s.averageScore).toBe("number");
    expect(s.topLeads.length).toBeLessThanOrEqual(5);
    expect(s.topLeads.every((l: { priority: string }) => l.priority === "HIGH")).toBe(true);
  });
});
