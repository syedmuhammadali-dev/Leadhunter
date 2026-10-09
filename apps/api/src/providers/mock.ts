import type { ProviderBusiness, SearchBusinessesParams } from "@leadhunter/shared";
import type { BusinessDataProvider } from "./types.js";

// All data produced here is FAKE. Domains use the reserved .example TLD.
const NAME_A = ["Al Noor", "Golden", "Royal", "Sunrise", "Blue Pearl", "Urban", "Oasis", "Capital", "Green Leaf", "Silver", "Heritage", "Pearl"];
const NAME_B = ["Central", "Express", "House", "Corner", "Point", "Studio", "Place", "Works"];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeId(country: string, city: string, category: string, n: number): string {
  return ["mock", country, city, category, String(n)].join("|");
}

function generate(country: string, city: string, category: string, n: number): ProviderBusiness {
  const rand = seeded(hash(`${country}|${city}|${category}|${n}`));
  const a = NAME_A[Math.floor(rand() * NAME_A.length)]!;
  const b = NAME_B[Math.floor(rand() * NAME_B.length)]!;
  const name = `${a} ${category} ${b} ${n + 1}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const hasWebsite = rand() > 0.25;
  return {
    name,
    category,
    country,
    city,
    address: `${Math.floor(rand() * 90) + 1} Main Street, ${city}`,
    website: hasWebsite ? `https://${slug}.example` : undefined,
    phone: `+${Math.floor(rand() * 90) + 10} ${Math.floor(rand() * 900000000) + 100000000}`,
    rating: Math.round((3.4 + rand() * 1.6) * 10) / 10,
    reviewCount: Math.floor(rand() * rand() * 1500) + 5,
    sourceId: makeId(country, city, category, n),
  };
}

/** Free development provider: deterministic fake businesses for any country/city/category. */
export class MockProvider implements BusinessDataProvider {
  readonly name = "mock";

  async searchBusinesses({ country, city, category, limit }: SearchBusinessesParams): Promise<ProviderBusiness[]> {
    const c = country || "United Arab Emirates";
    const ci = city || "Dubai";
    const cat = category || "Restaurant";
    return Array.from({ length: Math.min(limit, 500) }, (_, n) => generate(c, ci, cat, n));
  }

  async getBusinessDetails(id: string): Promise<ProviderBusiness | null> {
    const [prefix, country, city, category, n] = id.split("|");
    const index = Number(n);
    if (prefix !== "mock" || !country || !city || !category || !Number.isInteger(index) || index < 0 || index > 499) return null;
    return generate(country, city, category, index);
  }
}
