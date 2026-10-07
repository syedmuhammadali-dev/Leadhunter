import { LEADS } from "./fake-data";
import type { Lead } from "./types";

export type SearchParams = Record<string, string | string[] | undefined>;

export const PAGE_SIZE = 10;

export const SORTS = ["score", "name", "rating", "reviews", "websiteScore"] as const;
export type SortKey = (typeof SORTS)[number];

export const QUICK_FILTERS = [
  { value: "", label: "All" },
  { value: "has-website", label: "Has website" },
  { value: "no-website", label: "No website" },
  { value: "problems", label: "Website problems" },
  { value: "high", label: "High priority" },
  { value: "medium", label: "Medium priority" },
  { value: "low", label: "Low priority" },
] as const;

export interface LeadQuery {
  q: string;
  filter: string;
  country: string;
  city: string;
  category: string;
  sort: SortKey;
  dir: "asc" | "desc";
  page: number;
  limit: number;
}

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function parseQuery(sp: SearchParams): LeadQuery {
  const sort = one(sp.sort) as SortKey;
  const page = Number.parseInt(one(sp.page), 10);
  const limit = Number.parseInt(one(sp.limit), 10);
  return {
    q: one(sp.q).trim(),
    filter: one(sp.filter),
    country: one(sp.country),
    city: one(sp.city).trim(),
    category: one(sp.category).trim(),
    sort: SORTS.includes(sort) ? sort : "score",
    dir: one(sp.dir) === "asc" ? "asc" : "desc",
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
  };
}

function matches(l: Lead, q: LeadQuery): boolean {
  const text = (s: string) => s.toLowerCase();
  if (q.q && !text(`${l.name} ${l.category} ${l.city}`).includes(text(q.q))) return false;
  if (q.country && l.country !== q.country) return false;
  if (q.city && !text(l.city).includes(text(q.city))) return false;
  if (q.category && !text(l.category).includes(text(q.category))) return false;
  switch (q.filter) {
    case "has-website": return l.website !== null;
    case "no-website": return l.website === null;
    case "problems": return l.website !== null && l.problems.length > 0;
    case "high": return l.priority === "HIGH";
    case "medium": return l.priority === "MEDIUM";
    case "low": return l.priority === "LOW";
    default: return true;
  }
}

function sortValue(l: Lead, key: SortKey): number | string {
  switch (key) {
    case "name": return l.name.toLowerCase();
    case "rating": return l.rating;
    case "reviews": return l.reviewCount;
    case "websiteScore": return l.audit?.websiteScore ?? -1;
    default: return l.score;
  }
}

export function queryLeads(q: LeadQuery) {
  let rows = LEADS.filter((l) => matches(l, q));
  const factor = q.dir === "asc" ? 1 : -1;
  rows = [...rows].sort((a, b) => {
    const av = sortValue(a, q.sort);
    const bv = sortValue(b, q.sort);
    return (av < bv ? -1 : av > bv ? 1 : 0) * factor || a.name.localeCompare(b.name);
  });
  // "Maximum Results" from the search form caps the result set (fake data only).
  if (q.limit > 0) rows = rows.slice(0, q.limit);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(q.page, pages);
  return { rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total, pages, page };
}

/** Build a /leads URL from the current query with some params overridden. */
export function leadsHref(q: LeadQuery, overrides: Partial<Record<keyof LeadQuery, string | number>>): string {
  const merged: Record<string, string | number> = {
    q: q.q, filter: q.filter, country: q.country, city: q.city, category: q.category,
    sort: q.sort, dir: q.dir, page: q.page, limit: q.limit || "",
    ...overrides,
  };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== "" && v !== undefined) params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `/leads?${s}` : "/leads";
}
