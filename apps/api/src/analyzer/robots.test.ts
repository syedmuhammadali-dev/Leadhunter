import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchRobots, isPathAllowed, parseRobots } from "./robots.js";
import { createSafeFetcher } from "../security/safe-fetch.js";
import { createUrlGuard } from "../security/url-guard.js";
import { startTestSite, type TestSite } from "../testing/site-server.js";

describe("robots.txt rules", () => {
  it("allows everything when there is no matching group", () => {
    expect(isPathAllowed(parseRobots(""), "/anything")).toBe(true);
    expect(isPathAllowed(parseRobots("User-agent: googlebot\nDisallow: /"), "/")).toBe(true);
  });

  it("applies the * group and longest-match precedence", () => {
    const p = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/public\n");
    expect(isPathAllowed(p, "/")).toBe(true);
    expect(isPathAllowed(p, "/private/x")).toBe(false);
    expect(isPathAllowed(p, "/private/public/page")).toBe(true);
  });

  it("prefers a group naming us over *, and treats an empty Disallow as allow-all", () => {
    const p = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: LeadHunterBot\nDisallow:\n");
    expect(isPathAllowed(p, "/")).toBe(true);
    const blocked = parseRobots("User-agent: LeadHunterBot\nDisallow: /\n");
    expect(isPathAllowed(blocked, "/")).toBe(false);
  });

  it("supports wildcards, end anchors, comments and stacked user-agent lines", () => {
    const p = parseRobots("# comment\nUser-agent: a\nUser-agent: *\nDisallow: /*.pdf$ # no pdfs\nDisallow: /tmp*/cache\n");
    expect(isPathAllowed(p, "/files/doc.pdf")).toBe(false);
    expect(isPathAllowed(p, "/files/doc.pdf?x=1")).toBe(true);
    expect(isPathAllowed(p, "/tmp2/cache")).toBe(false);
    expect(isPathAllowed(p, "/other")).toBe(true);
  });

  it("collects sitemap lines", () => {
    expect(parseRobots("Sitemap: https://x.example/sitemap.xml\nUser-agent: *\nDisallow:").sitemaps).toEqual(["https://x.example/sitemap.xml"]);
  });
});

describe("fetchRobots", () => {
  let site: TestSite;
  let fetcher: ReturnType<typeof createSafeFetcher>;

  beforeAll(async () => {
    site = await startTestSite({
      "/robots.txt": "User-agent: *\nDisallow: /admin\nSitemap: http://example.com/sitemap.xml\n",
    });
    fetcher = createSafeFetcher({ guard: createUrlGuard({ testAllowList: [site.hostPort] }) });
  });
  afterAll(() => site.close());

  it("reads a robots.txt file", async () => {
    const r = await fetchRobots(fetcher, site.origin);
    expect(r.exists).toBe(true);
    expect(r.allows("/")).toBe(true);
    expect(r.allows("/admin/x")).toBe(false);
    expect(r.sitemaps).toEqual(["http://example.com/sitemap.xml"]);
  });

  it("treats a missing file as allow-all, and a 5xx as disallow-all", async () => {
    const none = await startTestSite({});
    const bad = await startTestSite({ "/robots.txt": (_q, res) => { res.writeHead(503); res.end(); } });
    const f = createSafeFetcher({ guard: createUrlGuard({ testAllowList: [none.hostPort, bad.hostPort] }) });
    const missing = await fetchRobots(f, none.origin);
    expect(missing).toMatchObject({ exists: false, status: 404 });
    expect(missing.allows("/x")).toBe(true);
    const down = await fetchRobots(f, bad.origin);
    expect(down.allows("/")).toBe(false);
    await none.close();
    await bad.close();
  });

  it("ignores an HTML page served at /robots.txt", async () => {
    const html = await startTestSite({ "/robots.txt": "<!DOCTYPE html><html><body>Welcome</body></html>" });
    const f = createSafeFetcher({ guard: createUrlGuard({ testAllowList: [html.hostPort] }) });
    const r = await fetchRobots(f, html.origin);
    expect(r.exists).toBe(false);
    expect(r.allows("/")).toBe(true);
    await html.close();
  });
});
