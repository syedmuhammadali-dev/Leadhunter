import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.literal("leadhunter-api"),
  database: z.enum(["up", "down"]),
  time: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function websiteDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Key used to detect duplicate businesses: normalized name | city | website domain. */
export function buildDedupeKey(name: string, city: string, website?: string | null): string {
  return [normalizeName(name), normalizeName(city), websiteDomain(website) ?? ""].join("|");
}

export * from "./csv.js";
export * from "./business.js";
