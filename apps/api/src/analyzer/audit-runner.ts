import { FetchError, type SafeFetcher } from "../security/safe-fetch.js";
import { UrlBlockedError } from "../security/url-guard.js";
import { analyzeHtml, type PageSignals } from "./html-analyzer.js";
import type { PerformanceProvider } from "./performance.js";
import { fetchRobots } from "./robots.js";
import { LARGE_IMAGE_BYTES, scoreAudit, type AuditObservation, type AuditScore } from "./scoring.js";

export interface AuditDeps {
  fetcher: SafeFetcher;
  performance?: PerformanceProvider | null;
  /** Max internal links to test for 404s. Default 8. */
  maxLinkChecks?: number;
  /** Max same-site images to measure with HEAD requests. Default 5. */
  maxImageChecks?: number;
  /** Stop optional extra checks after this many ms. Default 60 s. */
  budgetMs?: number;
}

export interface AuditSignals {
  title: string | null;
  phones: string[];
  emails: string[];
  whatsappLinks: string[];
  socialLinks: PageSignals["socialLinks"];
  contactPageUrl: string | null;
  hasContactForm: boolean;
  mapsLink: string | null;
  bookingLink: string | null;
  ctaTexts: string[];
  hasPricing: boolean;
  hasServicesInfo: boolean;
  linksChecked: number;
  imagesChecked: number;
  performance: { provider: string; score: number } | null;
  htmlTruncated: boolean;
}

export type AuditOutcome =
  | { kind: "completed"; observation: AuditObservation; result: AuditScore; signals: AuditSignals }
  | { kind: "skipped"; reason: "robots-disallowed"; message: string }
  | { kind: "failed"; code: "blocked" | "timeout" | "network" | "too-many-redirects" | "bad-redirect" | "invalid-url"; message: string };

const HTML_TYPES = /html|xml/i;

/**
 * Audit one homepage. Read-only: only GET/HEAD requests, no forms, no logins, no cookies.
 * Honours robots.txt for every page it requests and spaces requests with the fetcher's rate limiter.
 */
export async function runAudit(url: string, deps: AuditDeps): Promise<AuditOutcome> {
  const { fetcher } = deps;
  const deadline = Date.now() + (deps.budgetMs ?? 60_000);
  const withinBudget = () => Date.now() < deadline;

  let start: URL;
  try {
    start = new URL(url);
  } catch {
    return { kind: "failed", code: "invalid-url", message: "The website URL is not valid" };
  }

  try {
    // 1. robots.txt for the site we were asked to audit.
    const startRobots = await fetchRobots(fetcher, start.origin);
    if (!startRobots.allows(start.pathname || "/")) {
      return { kind: "skipped", reason: "robots-disallowed", message: "robots.txt does not allow automated access to the homepage" };
    }

    // 2. Homepage.
    const home = await fetcher.fetch(start.toString(), { maxBytes: 1024 * 1024, timeoutMs: 12_000, contentTypePattern: HTML_TYPES });
    const final = new URL(home.url);

    // A redirect can land on another site, which has its own robots.txt.
    const robots = final.origin === start.origin ? startRobots : await fetchRobots(fetcher, final.origin);
    if (final.origin !== start.origin && !robots.allows(final.pathname || "/")) {
      return { kind: "skipped", reason: "robots-disallowed", message: "robots.txt on the redirected site does not allow automated access" };
    }

    const isHtml = !home.skippedBody && home.status < 400;
    const page = isHtml ? analyzeHtml(home.body, home.url) : null;

    // 3. Sitemap.
    let sitemapFound = robots.sitemaps.length > 0;
    if (!sitemapFound && robots.allows("/sitemap.xml") && withinBudget()) {
      sitemapFound = await probe(fetcher, new URL("/sitemap.xml", final.origin).toString());
    }

    // 4. A few internal links, to find 404s.
    const brokenLinks: AuditObservation["brokenLinks"] = [];
    let linksChecked = 0;
    for (const link of page?.internalLinks ?? []) {
      if (linksChecked >= (deps.maxLinkChecks ?? 8) || !withinBudget()) break;
      const u = new URL(link);
      if (u.origin !== final.origin || u.pathname === final.pathname || !robots.allows(u.pathname)) continue;
      linksChecked++;
      const status = await statusOf(fetcher, link);
      if (status !== null && status >= 400) brokenLinks.push({ url: link, status });
    }

    // 5. A few same-site images, to find very large ones.
    const largeImages: AuditObservation["largeImages"] = [];
    let imagesChecked = 0;
    for (const src of page?.images.sampleUrls ?? []) {
      if (imagesChecked >= (deps.maxImageChecks ?? 5) || !withinBudget()) break;
      const u = new URL(src);
      if (u.origin !== final.origin || !robots.allows(u.pathname)) continue;
      imagesChecked++;
      try {
        const head = await fetcher.fetch(src, { method: "HEAD", timeoutMs: 6000 });
        const bytes = Number(head.headers["content-length"] ?? 0);
        if (head.status < 400 && bytes > LARGE_IMAGE_BYTES) largeImages.push({ url: src, bytes });
      } catch (e) {
        if (e instanceof UrlBlockedError) continue;
      }
    }

    // 6. Optional performance score.
    let performance: AuditObservation["performance"] = null;
    if (deps.performance && isHtml && withinBudget()) {
      const r = await deps.performance.run(home.url).catch(() => null);
      if (r) performance = { provider: deps.performance.name, score: r.score };
    }

    const observation: AuditObservation = {
      requestedUrl: start.toString(),
      finalUrl: home.url,
      httpStatus: home.status,
      usesHttps: final.protocol === "https:",
      redirectCount: home.redirectChain.length,
      page,
      robotsTxtFound: robots.exists,
      sitemapFound,
      brokenLinks,
      linksChecked,
      largeImages,
      imagesChecked,
      performance,
    };
    const result = scoreAudit(observation);
    return {
      kind: "completed",
      observation,
      result,
      signals: {
        title: page?.title ?? null,
        phones: page?.phones ?? [],
        emails: page?.emails ?? [],
        whatsappLinks: page?.whatsappLinks ?? [],
        socialLinks: page?.socialLinks ?? [],
        contactPageUrl: page?.contactPageUrl ?? null,
        hasContactForm: page?.hasContactForm ?? false,
        mapsLink: page?.mapsLink ?? null,
        bookingLink: page?.bookingLink ?? null,
        ctaTexts: page?.ctaTexts ?? [],
        hasPricing: page?.hasPricing ?? false,
        hasServicesInfo: page?.hasServicesInfo ?? false,
        linksChecked,
        imagesChecked,
        performance,
        htmlTruncated: home.truncated,
      },
    };
  } catch (e) {
    if (e instanceof UrlBlockedError) return { kind: "failed", code: "blocked", message: e.message };
    if (e instanceof FetchError) return { kind: "failed", code: e.code, message: e.message };
    throw e;
  }
}

/** HTTP status for a URL via HEAD, falling back to a small GET when HEAD is not supported. Null on network trouble. */
async function statusOf(fetcher: SafeFetcher, url: string): Promise<number | null> {
  try {
    let res = await fetcher.fetch(url, { method: "HEAD", timeoutMs: 6000 });
    if (res.status === 405 || res.status === 501) res = await fetcher.fetch(url, { maxBytes: 2048, timeoutMs: 6000 });
    return res.status;
  } catch {
    return null;
  }
}

async function probe(fetcher: SafeFetcher, url: string): Promise<boolean> {
  const status = await statusOf(fetcher, url);
  return status !== null && status >= 200 && status < 300;
}
