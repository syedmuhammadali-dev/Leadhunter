import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildApp } from "./app.js";

try {
  process.loadEnvFile("../../.env");
} catch {
  // no .env: DB tests are skipped below
}

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
const TEST_COUNTRY = "ZZ-Test";

const csv = [
  "name,category,country,city,address,website,phone,email,rating,reviewCount,facebook,instagram,linkedin",
  `"Acme, Café ""Best""",Cafe,${TEST_COUNTRY},Testville,1 Main St,acmecafe.example,+1 555 0100,hi@acmecafe.example,4.5,"1,200",https://facebook.com/acme.example,,`,
  `No Site Gym,Gym,${TEST_COUNTRY},Testville,,,+1 555 0101,,3.9,40,,,`,
  `Bad Row,Gym,${TEST_COUNTRY},Testville,,,,not-an-email,9,x,,,`,
  `Acme  Café "Best",Cafe,${TEST_COUNTRY},Testville,,https://www.acmecafe.example/,,,,,,,`,
  `Renamed Acme,Cafe,${TEST_COUNTRY},Testville,,acmecafe.example,,,,,,,`,
].join("\n");

describe.skipIf(!url)("CSV import + search display (Neon)", () => {
  let db: PrismaClient;
  let app: Awaited<ReturnType<typeof buildApp>>;

  const clean = () => db.business.deleteMany({ where: { location: { country: TEST_COUNTRY } } });

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    app = await buildApp({ pingDb: async () => true, webOrigin: "http://localhost:3000", db });
    await clean();
  });
  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await db.$disconnect();
  });

  const upload = (csvText: string) => app.inject({ method: "POST", url: "/api/import/csv", payload: { csvText } });

  it("imports valid rows, reports invalid rows and flags duplicates", async () => {
    const res = await upload(csv);
    expect(res.statusCode).toBe(200);
    const report = res.json();
    expect(report).toMatchObject({ totalRows: 5, validRows: 4, inserted: 2 });
    expect(report.invalid).toHaveLength(1);
    expect(report.invalid[0]).toMatchObject({ line: 4 });
    expect(report.duplicates.map((d: { line: number }) => d.line)).toEqual([5, 6]);

    const saved = await db.business.findFirstOrThrow({
      where: { location: { country: TEST_COUNTRY }, name: { startsWith: "Acme" } },
      include: { location: true, lead: true, contactMethods: true },
    });
    expect(saved.name).toBe('Acme, Café "Best"');
    expect(saved.source).toBe("csv");
    expect(saved.reviewCount).toBe(1200);
    expect(saved.websiteDomain).toBe("acmecafe.example");
    expect(saved.lead?.status).toBe("NEW");
    expect(saved.contactMethods.map((c) => c.type).sort()).toEqual(["EMAIL", "FACEBOOK", "PHONE"]);
    const noSite = await db.business.findFirstOrThrow({ where: { name: "No Site Gym" } });
    expect(noSite.websiteStatus).toBe("NO_WEBSITE");
  });

  it("skips everything on a re-import (already in the database)", async () => {
    await upload(csv);
    const again = (await upload(csv)).json();
    expect(again.inserted).toBe(0);
    expect(again.duplicates.length).toBe(4);
    expect(await db.business.count({ where: { location: { country: TEST_COUNTRY } } })).toBe(2);
  });

  it("rejects bad requests and files with missing columns", async () => {
    expect((await app.inject({ method: "POST", url: "/api/import/csv", payload: {} })).statusCode).toBe(400);
    const res = await upload("name,city\nA,B");
    expect(res.statusCode).toBe(400);
    expect(res.json().fileErrors[0]).toMatch(/Missing required column/);
  });

  it("shows imported businesses through the list endpoint", async () => {
    await upload(csv);
    const res = await app.inject({ method: "GET", url: "/api/businesses?source=csv&q=gym&pageSize=100" });
    const body = res.json();
    const mine = body.items.filter((b: { location: { country: string } }) => b.location.country === TEST_COUNTRY);
    expect(mine.map((b: { name: string }) => b.name)).toEqual(["No Site Gym"]);
    expect((await app.inject({ method: "GET", url: "/api/businesses?page=0" })).statusCode).toBe(400);
  });

  it("searches the mock provider and saves results once", async () => {
    const payload = { provider: "mock", country: TEST_COUNTRY, city: "Mockville", category: "Cafe", limit: 5, save: true };
    const first = (await app.inject({ method: "POST", url: "/api/search", payload })).json();
    expect(first.count).toBe(5);
    expect(first.saved.inserted).toBe(5);
    const second = (await app.inject({ method: "POST", url: "/api/search", payload })).json();
    expect(second.saved.inserted).toBe(0);
    expect(second.saved.duplicates).toHaveLength(5);
  });

  it("validates search requests", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/search", payload: { provider: "csv", limit: 5 } });
    expect(bad.statusCode).toBe(400);
    const tooMany = await app.inject({ method: "POST", url: "/api/search", payload: { limit: 100000 } });
    expect(tooMany.statusCode).toBe(400);
    const list = (await app.inject({ method: "GET", url: "/api/providers" })).json();
    expect(list.map((p: { name: string }) => p.name)).toEqual(["mock", "csv"]);
  });
});
