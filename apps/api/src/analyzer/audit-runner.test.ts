import { afterAll, describe, expect, it } from "vitest";
import { createSafeFetcher } from "../security/safe-fetch.js";
import { createUrlGuard } from "../security/url-guard.js";
import { redirectTo, startTestSite, type SiteHandler, type TestSite } from "../testing/site-server.js";
import { runAudit, type AuditOutcome } from "./audit-runner.js";
import { PageSpeedProvider, createPerformanceProvider } from "./performance.js";
import { TaskQueue } from "./queue.js";

const sites: TestSite[] = [];
async function site(routes: Record<string, SiteHandler | string>) {
  const s = await startTestSite(routes);
  sites.push(s);
  return s;
}
afterAll(() => Promise.all(sites.map((s) => s.close())));

const fetcherFor = (...allowed: TestSite[]) => createSafeFetcher({ guard: createUrlGuard({ testAllowList: allowed.map((s) => s.hostPort) }) });

function completed(o: AuditOutcome) {
  expect(o.kind).toBe("completed");
  if (o.kind !== "completed") throw new Error("not completed");
  return o;
}
const types = (o: AuditOutcome) => completed(o).result.issues.map((i) => i.type);

const GOOD_HOME = `<!doctype html><html lang="en"><head><title>Acme Cafe</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Coffee and cake">
<link rel="canonical" href="/"></head><body>
<header><nav><a href="/">Home</a><a href="/menu">Menu</a><a href="/contact">Contact</a><a href="/about">About</a></nav></header>
<h1>Acme Cafe</h1><h2>Our menu</h2>
<p>${"Fresh coffee, cakes and sandwiches made every day. ".repeat(10)} Coffee from $3.</p>
<a href="tel:+15550100">Call us</a> <a href="mailto:hi@acme.example">Email</a> <a href="https://wa.me/15550100">WhatsApp</a>
<a href="https://maps.google.com/maps?q=acme">Map</a><a href="https://instagram.com/acmecafe">Instagram</a>
<a href="/book">Book a table</a><img src="/logo.png" alt="Acme logo"><img src="/hero.jpg" alt="Cafe">
<form><label for="e">Email</label><input id="e" type="email"><textarea aria-label="Message"></textarea></form>
</body></html>`;

describe("runAudit against local test sites", () => {
  it("scores a well-built site highly and only uses GET/HEAD", async () => {
    const s = await site({
      "/": GOOD_HOME,
      "/menu": "<html><body>menu</body></html>",
      "/contact": "<html><body>contact</body></html>",
      "/about": "<html><body>about</body></html>",
      "/book": "<html><body>book</body></html>",
      "/robots.txt": "User-agent: *\nDisallow: /admin\nSitemap: http://x.example/sitemap.xml",
      "/logo.png": (_q, res) => { res.writeHead(200, { "content-type": "image/png", "content-length": "1200" }); res.end(); },
      "/hero.jpg": (_q, res) => { res.writeHead(200, { "content-type": "image/jpeg", "content-length": "800000" }); res.end(); },
    });
    const out = completed(await runAudit(`${s.origin}/`, { fetcher: fetcherFor(s) }));
    // The only issues are the local server being plain HTTP and the hero image being large.
    expect(types(out)).toEqual(expect.arrayContaining(["no-https", "large-images"]));
    expect(types(out)).not.toEqual(expect.arrayContaining(["missing-title", "missing-viewport", "no-cta", "broken-links", "no-robots-txt", "no-sitemap"]));
    expect(out.result.score).toBeGreaterThanOrEqual(75);
    expect(out.observation.linksChecked).toBeGreaterThanOrEqual(3);
    expect(out.signals.phones).toContain("+15550100");
    expect(out.signals.emails).toContain("hi@acme.example");
    expect(out.signals.title).toBe("Acme Cafe");
    expect(s.hits.every((h) => h.startsWith("GET ") || h.startsWith("HEAD "))).toBe(true);
    expect(s.hits).not.toContain("GET /admin");
  });

  it("finds many problems on a poor site, including broken links", async () => {
    const s = await site({
      "/": `<html><body><h3>Welcome</h3><a href="/gone">old</a><a href="/also-gone">old2</a><img src="/a.jpg"></body></html>`,
    });
    const out = completed(await runAudit(`${s.origin}/`, { fetcher: fetcherFor(s) }));
    expect(types(out)).toEqual(
      expect.arrayContaining(["missing-title", "missing-meta-description", "missing-viewport", "no-contact-info", "no-cta", "broken-links", "no-robots-txt", "no-sitemap", "images-missing-alt", "thin-content", "missing-lang"]),
    );
    const broken = out.result.issues.find((i) => i.type === "broken-links")!;
    expect(broken.pointsDeducted).toBe(6);
    expect(broken.evidence).toContain("/gone -> 404");
    expect(out.result.score).toBeLessThan(25);
    // The score is 100 minus every deduction, never below 0.
    expect(Math.max(0, out.result.breakdown.reduce((sum, b) => sum + b.points, 100))).toBe(out.result.score);
  });

  it("falls back to GET when a server rejects HEAD", async () => {
    const s = await site({
      "/": `<html lang="en"><head><title>t</title></head><body><a href="/page">p</a></body></html>`,
      "/page": (req, res) => {
        if (req.method === "HEAD") { res.writeHead(405); return res.end(); }
        res.writeHead(200, { "content-type": "text/html" });
        res.end("ok");
      },
    });
    const out = completed(await runAudit(`${s.origin}/`, { fetcher: fetcherFor(s) }));
    expect(out.observation.brokenLinks).toEqual([]);
    expect(s.hits).toContain("GET /page");
  });

  it("skips sites whose robots.txt disallows us, without fetching the homepage", async () => {
    const s = await site({ "/": "<html>secret</html>", "/robots.txt": "User-agent: *\nDisallow: /" });
    const out = await runAudit(`${s.origin}/`, { fetcher: fetcherFor(s) });
    expect(out).toMatchObject({ kind: "skipped", reason: "robots-disallowed" });
    expect(s.hits).not.toContain("GET /");
  });

  it("skips when a redirect lands on a site that disallows us", async () => {
    const target = await site({ "/": "<html>x</html>", "/robots.txt": "User-agent: LeadHunterBot\nDisallow: /" });
    const entry = await site({ "/": redirectTo(`${target.origin}/`) });
    const out = await runAudit(`${entry.origin}/`, { fetcher: fetcherFor(entry, target) });
    expect(out).toMatchObject({ kind: "skipped", reason: "robots-disallowed" });
  });

  it("reports HTTP errors and non-HTML homepages", async () => {
    const err = await site({ "/": (_q, res) => { res.writeHead(500, { "content-type": "text/html" }); res.end("<h1>oops</h1>"); } });
    const e = completed(await runAudit(`${err.origin}/`, { fetcher: fetcherFor(err) }));
    expect(types(e)).toContain("http-error");
    expect(e.observation.page).toBeNull();

    const json = await site({ "/": (_q, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); } });
    const j = completed(await runAudit(`${json.origin}/`, { fetcher: fetcherFor(json) }));
    expect(types(j)).toContain("not-html");
  });

  it("handles redirects and huge pages", async () => {
    const s = await site({
      "/": redirectTo("/home"),
      "/home": (_q, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(`<html><head><title>Big</title></head><body>${"word ".repeat(400_000)}</body></html>`); },
    });
    const out = completed(await runAudit(`${s.origin}/`, { fetcher: fetcherFor(s) }));
    expect(out.observation.redirectCount).toBe(1);
    expect(out.signals.htmlTruncated).toBe(true);
    expect(out.signals.title).toBe("Big");
  });

  it("fails cleanly for unreachable, blocked, invalid and looping sites", async () => {
    const dead = await startTestSite({});
    const deadOrigin = dead.origin;
    const deadFetcher = fetcherFor(dead);
    await dead.close();
    expect(await runAudit(`${deadOrigin}/`, { fetcher: deadFetcher })).toMatchObject({ kind: "failed", code: "network" });

    const s = await site({ "/": "<html></html>" });
    expect(await runAudit(`${s.origin}/`, { fetcher: createSafeFetcher() })).toMatchObject({ kind: "failed", code: "blocked" });
    expect(await runAudit("http://169.254.169.254/latest/meta-data/", { fetcher: createSafeFetcher() })).toMatchObject({ kind: "failed", code: "blocked" });
    expect(await runAudit("not a url", { fetcher: createSafeFetcher() })).toMatchObject({ kind: "failed", code: "invalid-url" });

    const loop = await site({ "/": redirectTo("/") });
    expect(await runAudit(`${loop.origin}/`, { fetcher: fetcherFor(loop) })).toMatchObject({ kind: "failed", code: "too-many-redirects" });
  });

  it("never submits forms (no POST requests)", async () => {
    const s = await site({ "/": `<html><body><form method="post" action="/submit"><input name="a"><button>Book now</button></form></body></html>`, "/submit": "no" });
    await runAudit(`${s.origin}/`, { fetcher: fetcherFor(s) });
    expect(s.hits.some((h) => h.startsWith("POST"))).toBe(false);
    expect(s.hits).not.toContain("GET /submit");
  });

  it("includes an optional performance provider's score", async () => {
    const s = await site({ "/": GOOD_HOME });
    const out = completed(await runAudit(`${s.origin}/`, { fetcher: fetcherFor(s), performance: { name: "fake", run: async () => ({ score: 30 }) } }));
    expect(out.observation.performance).toEqual({ provider: "fake", score: 30 });
    expect(types(out)).toContain("slow-performance");
  });
});

describe("performance provider", () => {
  it("parses PageSpeed responses and fails soft", async () => {
    const ok = new PageSpeedProvider("k", async (url) => {
      expect(url).toContain("url=https%3A%2F%2Fa.example%2F");
      expect(url).toContain("key=k");
      return { ok: true, json: async () => ({ lighthouseResult: { categories: { performance: { score: 0.42 } } } }) };
    });
    expect(await ok.run("https://a.example/")).toEqual({ score: 42 });
    expect(await new PageSpeedProvider(undefined, async () => ({ ok: false, json: async () => ({}) })).run("https://a.example/")).toBeNull();
    expect(await new PageSpeedProvider(undefined, async () => { throw new Error("offline"); }).run("https://a.example/")).toBeNull();
  });

  it("is disabled unless explicitly enabled", () => {
    expect(createPerformanceProvider({})).toBeNull();
    expect(createPerformanceProvider({ PAGESPEED_ENABLED: "true" })?.name).toBe("pagespeed");
  });
});

describe("TaskQueue", () => {
  it("never exceeds the concurrency limit and runs everything", async () => {
    const q = new TaskQueue(2);
    let active = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        q.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 20));
          active--;
          return i;
        }),
      ),
    );
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(2);
  });

  it("rejects when too many tasks are waiting, and survives task errors", async () => {
    const q = new TaskQueue(1, 1);
    const slow = q.run(() => new Promise((r) => setTimeout(() => r("a"), 50)));
    const waiting = q.run(async () => "b");
    await expect(q.run(async () => "c")).rejects.toThrow(/queue is full/);
    await expect(q.run(async () => { throw new Error("boom"); })).rejects.toThrow();
    expect(await slow).toBe("a");
    expect(await waiting).toBe("b");
    expect(await q.run(async () => "d")).toBe("d");
    expect(q.active).toBe(0);
  });
});
