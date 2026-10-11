import { FetchError, USER_AGENT, type SafeFetcher } from "../security/safe-fetch.js";
import { UrlBlockedError } from "../security/url-guard.js";

interface Rule {
  allow: boolean;
  path: string;
}

interface Group {
  agents: string[];
  rules: Rule[];
}

export interface RobotsPolicy {
  groups: Group[];
  sitemaps: string[];
}

/** Our robots.txt product token. */
export const ROBOT_TOKEN = "leadhunterbot";

export function parseRobots(text: string): RobotsPolicy {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "allow" || field === "disallow") {
      lastWasAgent = false;
      if (!current) continue;
      // An empty Disallow means "allow everything"; an empty Allow is ignored.
      if (value === "") continue;
      current.rules.push({ allow: field === "allow", path: value });
    } else if (field === "sitemap") {
      if (value) sitemaps.push(value);
    } else {
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Pick the most specific group for our token, falling back to "*". */
function pickGroup(policy: RobotsPolicy, token: string): Group | null {
  let best: { group: Group; len: number } | null = null;
  for (const group of policy.groups) {
    for (const agent of group.agents) {
      if (agent === "*") {
        if (!best) best = { group, len: 0 };
      } else if (token.includes(agent) && agent.length > (best?.len ?? 0)) {
        best = { group, len: agent.length };
      }
    }
  }
  return best?.group ?? null;
}

/** RFC 9309 matching: the longest matching rule wins; Allow wins ties; no match means allowed. */
export function isPathAllowed(policy: RobotsPolicy, path: string, token = ROBOT_TOKEN): boolean {
  const group = pickGroup(policy, token);
  if (!group) return true;
  let verdict: { allow: boolean; len: number } | null = null;
  for (const rule of group.rules) {
    if (!patternToRegExp(rule.path).test(path)) continue;
    const len = rule.path.length;
    if (!verdict || len > verdict.len || (len === verdict.len && rule.allow)) verdict = { allow: rule.allow, len };
  }
  return verdict ? verdict.allow : true;
}

export interface RobotsResult {
  /** Whether a robots.txt file was found. */
  exists: boolean;
  /** HTTP status of the robots.txt request, if one was received. */
  status: number | null;
  sitemaps: string[];
  allows(path: string): boolean;
}

const ALLOW_ALL = (): boolean => true;

/** Fetch and parse /robots.txt for an origin. Missing file (4xx) = allowed; server error (5xx) = treated as disallowed. */
export async function fetchRobots(fetcher: SafeFetcher, origin: string): Promise<RobotsResult> {
  try {
    const res = await fetcher.fetch(new URL("/robots.txt", origin).toString(), {
      maxBytes: 200 * 1024,
      timeoutMs: 5000,
      accept: "text/plain,*/*;q=0.1",
    });
    if (res.status >= 500) return { exists: false, status: res.status, sitemaps: [], allows: () => false };
    if (res.status >= 400) return { exists: false, status: res.status, sitemaps: [], allows: ALLOW_ALL };
    const looksLikeHtml = /<html|<!doctype/i.test(res.body.slice(0, 200));
    if (looksLikeHtml) return { exists: false, status: res.status, sitemaps: [], allows: ALLOW_ALL };
    const policy = parseRobots(res.body);
    return { exists: true, status: res.status, sitemaps: policy.sitemaps, allows: (p) => isPathAllowed(policy, p) };
  } catch (e) {
    if (e instanceof UrlBlockedError) throw e;
    // Network problem or timeout: the page fetch will surface the real failure.
    if (e instanceof FetchError) return { exists: false, status: null, sitemaps: [], allows: ALLOW_ALL };
    throw e;
  }
}

export { USER_AGENT };
