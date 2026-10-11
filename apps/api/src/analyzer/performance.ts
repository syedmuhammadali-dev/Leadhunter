/**
 * Optional, pluggable performance measurement. Nothing here is required: with no provider the audit
 * simply has no performance data. A provider only ever receives the public URL being audited.
 */
export interface PerformanceProvider {
  readonly name: string;
  /** Returns a 0-100 performance score, or null if unavailable. */
  run(url: string): Promise<{ score: number } | null>;
}

type FetchFn = (input: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Google PageSpeed Insights (free API; an API key is optional but raises the quota). */
export class PageSpeedProvider implements PerformanceProvider {
  readonly name = "pagespeed";

  constructor(
    private readonly apiKey?: string,
    private readonly fetchFn: FetchFn = fetch as unknown as FetchFn,
    private readonly timeoutMs = 60_000,
  ) {}

  async run(url: string): Promise<{ score: number } | null> {
    const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    endpoint.searchParams.set("url", url);
    endpoint.searchParams.set("strategy", "mobile");
    endpoint.searchParams.set("category", "performance");
    if (this.apiKey) endpoint.searchParams.set("key", this.apiKey);
    try {
      const res = await this.fetchFn(endpoint.toString(), { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) return null;
      const body = (await res.json()) as { lighthouseResult?: { categories?: { performance?: { score?: number | null } } } };
      const raw = body.lighthouseResult?.categories?.performance?.score;
      return typeof raw === "number" ? { score: Math.round(raw * 100) } : null;
    } catch {
      return null;
    }
  }
}

/** Build the configured provider from environment variables. Disabled unless PAGESPEED_ENABLED=true. */
export function createPerformanceProvider(env: Record<string, string | undefined> = process.env): PerformanceProvider | null {
  return env.PAGESPEED_ENABLED === "true" ? new PageSpeedProvider(env.PAGESPEED_API_KEY || undefined) : null;
}
