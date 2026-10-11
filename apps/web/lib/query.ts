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

/** Filters, sorting and paging for the Leads page, kept in the URL so views can be shared and bookmarked. */
export interface LeadQuery {
  q: string;
  filter: string;
  country: string;
  city: string;
  category: string;
  minScore: string;
  maxScore: string;
  sort: SortKey;
  dir: "asc" | "desc";
  page: number;
  limit: number;
}

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function scoreParam(v: string | string[] | undefined): string {
  const n = Number.parseInt(one(v), 10);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? String(n) : "";
}

export function parseQuery(sp: SearchParams): LeadQuery {
  const sort = one(sp.sort) as SortKey;
  const page = Number.parseInt(one(sp.page), 10);
  const limit = Number.parseInt(one(sp.limit), 10);
  const filter = one(sp.filter);
  return {
    q: one(sp.q).trim(),
    filter: QUICK_FILTERS.some((f) => f.value === filter) ? filter : "",
    country: one(sp.country),
    city: one(sp.city).trim(),
    category: one(sp.category).trim(),
    minScore: scoreParam(sp.minScore),
    maxScore: scoreParam(sp.maxScore),
    sort: SORTS.includes(sort) ? sort : "score",
    dir: one(sp.dir) === "asc" ? "asc" : "desc",
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 0,
  };
}

function toParams(q: LeadQuery, overrides: Partial<Record<keyof LeadQuery, string | number>> = {}): URLSearchParams {
  const merged: Record<string, string | number> = {
    q: q.q, filter: q.filter, country: q.country, city: q.city, category: q.category,
    minScore: q.minScore, maxScore: q.maxScore, sort: q.sort, dir: q.dir, page: q.page, limit: q.limit || "",
    ...overrides,
  };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== "" && v !== undefined) params.set(k, String(v));
  }
  return params;
}

/** Query string for the API: the same parameters plus the page size. */
export function apiQueryString(q: LeadQuery): string {
  const params = toParams(q);
  params.set("pageSize", String(PAGE_SIZE));
  return params.toString();
}

/** Build a /leads URL from the current query with some params overridden. */
export function leadsHref(q: LeadQuery, overrides: Partial<Record<keyof LeadQuery, string | number>>): string {
  const s = toParams(q, overrides).toString();
  return s ? `/leads?${s}` : "/leads";
}
