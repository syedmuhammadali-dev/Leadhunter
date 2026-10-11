import http from "node:http";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { createUrlGuard, UrlBlockedError, type UrlGuard } from "./url-guard.js";

export const USER_AGENT = "LeadHunterBot/0.1 (website research; respects robots.txt)";

export type FetchErrorCode = "blocked" | "timeout" | "network" | "too-many-redirects" | "bad-redirect";

export class FetchError extends Error {
  constructor(
    readonly code: FetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

/** Spaces out requests to the same host so audits never hammer a site. */
export class HostRateLimiter {
  private readonly nextSlot = new Map<string, number>();

  constructor(private readonly minIntervalMs: number) {}

  async wait(host: string): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + this.minIntervalMs);
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  }
}

export interface FetchOptions {
  method?: "GET" | "HEAD";
  /** Stop reading the body after this many bytes (result.truncated = true). Default 1 MB. */
  maxBytes?: number;
  /** Total time for the whole request including redirects. Default 10 s. */
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: string;
  /** If set and the response Content-Type does not match, the body is not read (result.skippedBody). */
  contentTypePattern?: RegExp;
}

export interface FetchResult {
  /** Final URL after redirects. */
  url: string;
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  bytes: number;
  truncated: boolean;
  /** True when the Content-Type did not match contentTypePattern, so the body was skipped. */
  skippedBody: boolean;
  /** URLs visited before the final one, in order. */
  redirectChain: string[];
}

export interface SafeFetcherConfig {
  guard?: UrlGuard;
  limiter?: HostRateLimiter;
}

export interface SafeFetcher {
  fetch(url: string, options?: FetchOptions): Promise<FetchResult>;
}

/**
 * HTTP client for fetching untrusted public pages. It validates every URL (including each redirect),
 * resolves DNS through the guard (so a name cannot point at an internal address), caps body size,
 * time and redirects, never sends credentials or cookies, and asks for uncompressed content.
 */
export function createSafeFetcher(config: SafeFetcherConfig = {}): SafeFetcher {
  const guard = config.guard ?? createUrlGuard();
  const limiter = config.limiter;

  async function fetchOnce(url: URL, o: Required<Pick<FetchOptions, "method" | "maxBytes">> & FetchOptions, signal: AbortSignal) {
    await limiter?.wait(url.hostname);
    return new Promise<{ res: http.IncomingMessage; body: string; bytes: number; truncated: boolean; skippedBody: boolean }>((resolve, reject) => {
      const lib = url.protocol === "https:" ? https : http;
      const req = lib.request(
        url,
        {
          method: o.method,
          lookup: guard.lookup,
          agent: false,
          headers: {
            "user-agent": USER_AGENT,
            accept: o.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
            "accept-encoding": "identity",
          },
          signal,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const isRedirect = status >= 300 && status < 400 && res.headers.location;
          const contentType = String(res.headers["content-type"] ?? "");
          const skip = !isRedirect && o.method === "GET" && !!o.contentTypePattern && !!contentType && !o.contentTypePattern.test(contentType);
          if (isRedirect || o.method === "HEAD" || skip) {
            res.destroy();
            return resolve({ res, body: "", bytes: 0, truncated: false, skippedBody: skip });
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          let truncated = false;
          res.on("data", (chunk: Buffer) => {
            if (truncated) return;
            const room = o.maxBytes - bytes;
            if (chunk.length >= room) {
              chunks.push(chunk.subarray(0, room));
              bytes += room;
              truncated = true;
              res.destroy();
              return resolve({ res, body: Buffer.concat(chunks).toString("utf8"), bytes, truncated, skippedBody: false });
            }
            chunks.push(chunk);
            bytes += chunk.length;
          });
          res.on("end", () => resolve({ res, body: Buffer.concat(chunks).toString("utf8"), bytes, truncated, skippedBody: false }));
          res.on("error", (e) => {
            if (!truncated) reject(e);
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  async function fetchUrl(input: string, options: FetchOptions = {}): Promise<FetchResult> {
    const method = options.method ?? "GET";
    const maxBytes = options.maxBytes ?? 1024 * 1024;
    const maxRedirects = options.maxRedirects ?? 5;
    const timeoutMs = options.timeoutMs ?? 10_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const redirectChain: string[] = [];

    try {
      let current = guard.validateUrl(input);
      for (let hop = 0; ; hop++) {
        const { res, body, bytes, truncated, skippedBody } = await fetchOnce(current, { ...options, method, maxBytes }, controller.signal);
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          if (hop >= maxRedirects) throw new FetchError("too-many-redirects", `More than ${maxRedirects} redirects`);
          let next: URL;
          try {
            next = guard.validateUrl(new URL(location, current).toString());
          } catch (e) {
            if (e instanceof UrlBlockedError) throw e;
            throw new FetchError("bad-redirect", "Redirect target is not a valid URL");
          }
          redirectChain.push(current.toString());
          current = next;
          continue;
        }
        return { url: current.toString(), status, headers: res.headers, body, bytes, truncated, skippedBody, redirectChain };
      }
    } catch (e) {
      if (e instanceof UrlBlockedError || e instanceof FetchError) throw e;
      if (controller.signal.aborted) throw new FetchError("timeout", `Request timed out after ${timeoutMs} ms`);
      const err = e as NodeJS.ErrnoException & { cause?: unknown };
      // The guarded lookup reports blocked addresses through the socket error.
      if (err instanceof UrlBlockedError || (err.cause instanceof UrlBlockedError)) throw err.cause ?? err;
      throw new FetchError("network", err.code ? `${err.code}: ${err.message}` : err.message);
    } finally {
      clearTimeout(timer);
    }
  }

  return { fetch: fetchUrl };
}
