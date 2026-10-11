import type { LeadDetail, LeadList, LeadStats, ScoringConfigView } from "./types";

/** Server-side base URL of the LeadHunter API. Not a secret. */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number | null };

/** GET a JSON endpoint from server components. Never throws: callers show a friendly message instead. */
export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: null };
  }
}

export const getLeads = (queryString: string) => apiGet<LeadList>(`/api/leads${queryString ? `?${queryString}` : ""}`);
export const getLead = (id: string) => apiGet<LeadDetail>(`/api/leads/${encodeURIComponent(id)}`);
export const getLeadStats = () => apiGet<LeadStats>("/api/leads/stats");
export const getScoringConfig = () => apiGet<ScoringConfigView>("/api/scoring/config");
