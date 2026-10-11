import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSafeFetcher, FetchError, HostRateLimiter } from "./security/safe-fetch.js";
import { createUrlGuard, isBlockedIp, UrlBlockedError } from "./security/url-guard.js";
import { redirectTo, startTestSite, type TestSite } from "./testing/site-server.js";

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1", "127.255.255.254", "10.0.0.1", "10.255.1.1", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "169.254.0.1", "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255", "198.18.0.1",
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1",
    "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "2002:7f00:1::1", "64:ff9b::7f00:1", "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "93.184.216.34", "1.1.1.1", "172.32.0.1", "172.15.255.255", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows public address %s",
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );
});

describe("validateUrl", () => {
  const guard = createUrlGuard();

  it.each([
    "http://localhost/", "http://localhost:3000/", "http://foo.localhost/", "http://127.0.0.1/", "http://127.0.0.1:4000/health",
    "http://10.1.2.3/", "http://192.168.0.10/admin", "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/computeMetadata/v1/", "http://[::1]/", "http://[::ffff:7f00:1]/", "http://[fd00::1]/",
    "http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/", "http://0/", "http://printer.local/", "http://intranet/",
    "http://router.lan/", "http://example.com:22/", "http://example.com:6379/", "https://example.com:5432/",
    "ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "gopher://example.com/", "data:text/html,hi",
    "http://user:pass@example.com/", "not a url", "", "http://" + "a".repeat(3000) + ".com/",
  ])("rejects %s", (url) => {
    expect(() => guard.validateUrl(url)).toThrow(UrlBlockedError);
  });

  it.each(["https://example.com/", "http://example.com/path?q=1", "https://sub.example.co.uk:443/", "http://example.com:80/", "http://93.184.216.34/"])(
    "accepts %s",
    (url) => {
      expect(guard.validateUrl(url).hostname).toBeTruthy();
    },
  );

  it("resolves names through the guard and refuses internal results", async () => {
    const result = await new Promise<{ err: unknown }>((resolve) => {
      guard.lookup("localhost", {}, (err) => resolve({ err }));
    });
    expect(result.err).toBeInstanceOf(UrlBlockedError);
  });
});

describe("safe fetcher", () => {
  let site: TestSite;
  let fetcher: ReturnType<typeof createSafeFetcher>;

  beforeAll(async () => {
    site = await startTestSite({
      "/": "<html><title>Hi</title></html>",
      "/redirect": redirectTo("/final"),
      "/final": "<html>final</html>",
      "/loop": redirectTo("/loop"),
      "/to-metadata": redirectTo("http://169.254.169.254/latest/meta-data/"),
      "/to-localhost": redirectTo("http://localhost:1234/"),
      "/to-file": redirectTo("file:///etc/passwd"),
      "/big": (_req, res) => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("x".repeat(500_000));
      },
      "/image": (_req, res) => {
        res.writeHead(200, { "content-type": "image/png" });
        res.end("not really a png");
      },
      "/slow": () => {
        /* never responds */
      },
    });
    fetcher = createSafeFetcher({ guard: createUrlGuard({ testAllowList: [site.hostPort] }) });
  });
  afterAll(() => site.close());

  it("fetches a page", async () => {
    const r = await fetcher.fetch(`${site.origin}/`);
    expect(r.status).toBe(200);
    expect(r.body).toContain("<title>Hi</title>");
    expect(r.redirectChain).toEqual([]);
  });

  it("follows redirects and records the chain", async () => {
    const r = await fetcher.fetch(`${site.origin}/redirect`);
    expect(r.url).toBe(`${site.origin}/final`);
    expect(r.redirectChain).toEqual([`${site.origin}/redirect`]);
  });

  it("stops redirect loops", async () => {
    await expect(fetcher.fetch(`${site.origin}/loop`, { maxRedirects: 3 })).rejects.toMatchObject({ code: "too-many-redirects" });
  });

  it("blocks redirects to metadata, localhost names and non-http schemes", async () => {
    await expect(fetcher.fetch(`${site.origin}/to-metadata`)).rejects.toBeInstanceOf(UrlBlockedError);
    await expect(fetcher.fetch(`${site.origin}/to-localhost`)).rejects.toBeInstanceOf(UrlBlockedError);
    await expect(fetcher.fetch(`${site.origin}/to-file`)).rejects.toBeInstanceOf(UrlBlockedError);
  });

  it("refuses local addresses with the default guard", async () => {
    const strict = createSafeFetcher();
    await expect(strict.fetch(`${site.origin}/`)).rejects.toBeInstanceOf(UrlBlockedError);
    expect(site.hits.filter((h) => h === "GET /to-metadata").length).toBe(1);
  });

  it("caps the body size", async () => {
    const r = await fetcher.fetch(`${site.origin}/big`, { maxBytes: 10_000 });
    expect(r.truncated).toBe(true);
    expect(r.bytes).toBe(10_000);
    expect(r.body.length).toBe(10_000);
  });

  it("does not read non-HTML bodies when a content type pattern is set", async () => {
    const r = await fetcher.fetch(`${site.origin}/image`, { contentTypePattern: /html/i });
    expect(r.skippedBody).toBe(true);
    expect(r.body).toBe("");
  });

  it("times out slow servers", async () => {
    await expect(fetcher.fetch(`${site.origin}/slow`, { timeoutMs: 300 })).rejects.toMatchObject({ code: "timeout" });
  });

  it("reports connection failures as network errors", async () => {
    const dead = await startTestSite({});
    const hostPort = dead.hostPort;
    const origin = dead.origin;
    await dead.close();
    const f = createSafeFetcher({ guard: createUrlGuard({ testAllowList: [hostPort] }) });
    const err = await f.fetch(`${origin}/`).catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect(err.code).toBe("network");
  });

  it("sends HEAD requests without reading a body", async () => {
    const r = await fetcher.fetch(`${site.origin}/`, { method: "HEAD" });
    expect(r.status).toBe(200);
    expect(r.body).toBe("");
  });
});

describe("HostRateLimiter", () => {
  it("spaces out requests to the same host only", async () => {
    const limiter = new HostRateLimiter(120);
    const start = Date.now();
    await limiter.wait("a.example");
    await limiter.wait("a.example");
    await limiter.wait("a.example");
    expect(Date.now() - start).toBeGreaterThanOrEqual(220);
    const other = Date.now();
    await limiter.wait("b.example");
    expect(Date.now() - other).toBeLessThan(80);
  });
});
