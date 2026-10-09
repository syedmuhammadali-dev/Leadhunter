import { describe, expect, it } from "vitest";
import { MockProvider } from "./providers/mock.js";
import { PROVIDER_INFO, createProvider } from "./providers/registry.js";

describe("MockProvider", () => {
  const params = { country: "Pakistan", city: "Lahore", category: "Gym", limit: 12 };

  it("is deterministic and respects the limit", async () => {
    const p = new MockProvider();
    const a = await p.searchBusinesses(params);
    const b = await p.searchBusinesses(params);
    expect(a).toHaveLength(12);
    expect(b).toEqual(a);
    expect(new Set(a.map((x) => x.sourceId)).size).toBe(12);
    expect(a.every((x) => x.city === "Lahore" && x.category === "Gym")).toBe(true);
  });

  it("returns details for an id it produced and null for junk", async () => {
    const p = new MockProvider();
    const [first] = await p.searchBusinesses(params);
    expect(await p.getBusinessDetails(first!.sourceId!)).toEqual(first);
    expect(await p.getBusinessDetails("nope")).toBeNull();
    expect(await p.getBusinessDetails("mock|a|b|c|9999")).toBeNull();
  });

  it("only uses reserved .example website domains", async () => {
    const all = await new MockProvider().searchBusinesses({ ...params, limit: 100 });
    for (const b of all) if (b.website) expect(new URL(b.website).hostname.endsWith(".example")).toBe(true);
  });
});

describe("provider registry", () => {
  it("creates every listed provider", () => {
    for (const info of PROVIDER_INFO) expect(createProvider(info.name, { csvText: "" }).name).toBe(info.name);
  });
});
