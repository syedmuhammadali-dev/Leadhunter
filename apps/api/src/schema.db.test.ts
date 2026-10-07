import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildDedupeKey, normalizeName, websiteDomain } from "@leadhunter/shared";

try {
  process.loadEnvFile("../../.env");
} catch {
  // no .env: DB tests are skipped below
}

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;

describe("dedupe helpers", () => {
  it("normalizes names and domains", () => {
    expect(normalizeName("  Café  Al-Noor!! ")).toBe("cafe al noor");
    expect(websiteDomain("HTTPS://www.Example.com/path")).toBe("example.com");
    expect(websiteDomain("not a url ::")).toBeNull();
    expect(buildDedupeKey("Al Noor Grill", "Dubai", "http://www.alnoor.example")).toBe(
      "al noor grill|dubai|alnoor.example",
    );
    expect(buildDedupeKey("Al Noor Grill", "Dubai")).toBe("al noor grill|dubai|");
  });
});

describe.skipIf(!url)("database schema (Neon)", () => {
  let db: PrismaClient;

  beforeAll(() => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(() => db.$disconnect());

  it("has the seeded fake businesses with related data", async () => {
    expect(await db.business.count({ where: { source: "mock" } })).toBeGreaterThanOrEqual(8);
    const noSite = await db.business.findFirstOrThrow({
      where: { name: "Al Noor Grill" },
      include: { location: true, lead: { include: { scores: true } }, contactMethods: true },
    });
    expect(noSite.websiteStatus).toBe("NO_WEBSITE");
    expect(noSite.location?.city).toBe("Dubai");
    expect(noSite.lead?.scores[0]?.priority).toBe("HIGH");
    expect(noSite.contactMethods.length).toBeGreaterThan(0);
  });

  it("stores audits with issues and a score breakdown", async () => {
    const audit = await db.websiteAudit.findFirstOrThrow({
      where: { business: { name: "Marina Bites" } },
      include: { issues: true },
    });
    expect(audit.websiteScore).toBe(100 - 38);
    expect(audit.issues).toHaveLength(3);
    expect(audit.issues.reduce((s, i) => s + i.pointsDeducted, 0)).toBe(38);
  });

  it("rejects a duplicate business (unique dedupeKey)", async () => {
    const existing = await db.business.findFirstOrThrow({ where: { name: "Marina Bites" } });
    await expect(
      db.business.create({
        data: {
          name: "Marina Bites", normalizedName: "marina bites", category: "Restaurant",
          source: "csv", dedupeKey: existing.dedupeKey,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate (source, sourceId) pair", async () => {
    const existing = await db.business.findFirstOrThrow({ where: { sourceId: "seed-001" } });
    await expect(
      db.business.create({
        data: {
          name: "Other Name", normalizedName: "other name", category: "Restaurant",
          source: existing.source, sourceId: existing.sourceId, dedupeKey: "other name|dubai|",
        },
      }),
    ).rejects.toThrow();
  });

  it("prevents the same business appearing twice in one search job", async () => {
    const result = await db.searchResult.findFirstOrThrow({});
    await expect(
      db.searchResult.create({ data: { jobId: result.jobId, businessId: result.businessId } }),
    ).rejects.toThrow();
  });

  it("cascades deletes from business to children", async () => {
    const key = `cascade test|nowhere|${Date.now()}`;
    const b = await db.business.create({
      data: {
        name: "Cascade Test", normalizedName: "cascade test", category: "Test", source: "test", dedupeKey: key,
        location: { create: { country: "X", city: "Y" } },
        lead: { create: { outreachDrafts: { create: { body: "draft", author: "AI" } } } },
      },
      include: { lead: true },
    });
    await db.business.delete({ where: { id: b.id } });
    expect(await db.lead.count({ where: { id: b.lead!.id } })).toBe(0);
    expect(await db.outreachDraft.count({ where: { leadId: b.lead!.id } })).toBe(0);
  });

  it("defaults new drafts to DRAFT status and new leads to NEW", async () => {
    const b = await db.business.create({
      data: {
        name: "Default Test", normalizedName: "default test", category: "Test", source: "test",
        dedupeKey: `default test|nowhere|${Date.now()}`,
        lead: { create: { outreachDrafts: { create: { body: "x" } } } },
      },
      include: { lead: { include: { outreachDrafts: true } } },
    });
    expect(b.lead?.status).toBe("NEW");
    expect(b.lead?.outreachDrafts[0]?.status).toBe("DRAFT");
    await db.business.delete({ where: { id: b.id } });
  });
});
