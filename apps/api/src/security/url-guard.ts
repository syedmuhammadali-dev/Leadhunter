import dns from "node:dns";
import { BlockList, isIP } from "node:net";

/** Thrown when a URL or resolved address is not allowed to be fetched. */
export class UrlBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlBlockedError";
  }
}

const IPV4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, includes cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

const IPV6_BLOCKED: [string, number][] = [
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 (can embed private IPv4)
  ["64:ff9b::", 96], // NAT64 (can embed private IPv4)
  ["100::", 64], // discard-only
];

const blockList = new BlockList();
for (const [net, prefix] of IPV4_BLOCKED) blockList.addSubnet(net, prefix, "ipv4");
blockList.addAddress("::", "ipv6");
blockList.addAddress("::1", "ipv6");
for (const [net, prefix] of IPV6_BLOCKED) blockList.addSubnet(net, prefix, "ipv6");

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".lan", ".home", ".corp", ".intranet"];
const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata"]);

/** Extract the IPv4 address from an IPv4-mapped IPv6 address like ::ffff:127.0.0.1 or ::ffff:7f00:1. */
function mappedIpv4(address: string): string | null {
  const m = /^::ffff:(.+)$/i.exec(address);
  if (!m) return null;
  const rest = m[1]!;
  if (isIP(rest) === 4) return rest;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(rest);
  if (!hex) return null;
  const hi = parseInt(hex[1]!, 16);
  const lo = parseInt(hex[2]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** True if the IP must never be contacted (private, loopback, link-local, metadata, reserved...). */
export function isBlockedIp(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true; // not an IP: refuse
  if (family === 6) {
    const mapped = mappedIpv4(address);
    if (mapped) return isBlockedIp(mapped);
    // Any other ::ffff:0:0/96 form we could not parse is refused.
    if (/^::ffff:/i.test(address)) return true;
    return blockList.check(address, "ipv6");
  }
  return blockList.check(address, "ipv4");
}

export interface UrlGuardOptions {
  /** Ports that may be contacted. Default: 80 and 443. */
  allowedPorts?: number[];
  /**
   * Exact "host:port" entries that bypass the checks. FOR TESTS ONLY (local test servers).
   * Production code must never set this.
   */
  testAllowList?: string[];
}

export interface UrlGuard {
  /** Throws UrlBlockedError unless the URL is a plain public http(s) URL. Returns the parsed URL. */
  validateUrl(input: string): URL;
  /** dns.lookup replacement that refuses to resolve to blocked addresses (stops DNS rebinding). */
  lookup: typeof dns.lookup;
}

function normalizedHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function effectivePort(url: URL): number {
  return url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
}

export function createUrlGuard(options: UrlGuardOptions = {}): UrlGuard {
  const allowedPorts = new Set(options.allowedPorts ?? [80, 443]);
  const testAllow = new Set((options.testAllowList ?? []).map((s) => s.toLowerCase()));

  const isTestAllowed = (host: string, port: number) => testAllow.has(`${host}:${port}`);

  function validateUrl(input: string): URL {
    if (typeof input !== "string" || input.length === 0 || input.length > 2048) {
      throw new UrlBlockedError("URL is empty or too long");
    }
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new UrlBlockedError("URL is not valid");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new UrlBlockedError(`Protocol ${url.protocol} is not allowed`);
    }
    if (url.username || url.password) throw new UrlBlockedError("URLs with credentials are not allowed");

    const host = normalizedHost(url);
    const port = effectivePort(url);
    if (isTestAllowed(host, port)) return url;

    if (!allowedPorts.has(port)) throw new UrlBlockedError(`Port ${port} is not allowed`);
    if (BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
      throw new UrlBlockedError("Internal host names are not allowed");
    }
    if (isIP(host)) {
      if (isBlockedIp(host)) throw new UrlBlockedError("Private or reserved IP addresses are not allowed");
    } else if (!host.includes(".")) {
      throw new UrlBlockedError("Single-label host names are not allowed");
    }
    return url;
  }

  const lookup = ((hostname: string, opts: dns.LookupOptions | number, callback: (...args: unknown[]) => void) => {
    const lookupOptions: dns.LookupOptions = typeof opts === "number" ? { family: opts } : { ...opts };
    const wantsAll = lookupOptions.all === true;
    dns.lookup(hostname, { ...lookupOptions, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = addresses as dns.LookupAddress[];
      const bypass = testAllow.size > 0 && [...testAllow].some((e) => e.startsWith(`${hostname.toLowerCase()}:`));
      if (!bypass) {
        for (const a of list) {
          if (isBlockedIp(a.address)) {
            return callback(new UrlBlockedError(`${hostname} resolves to a blocked address`));
          }
        }
      }
      if (list.length === 0) return callback(new UrlBlockedError(`${hostname} did not resolve`));
      if (wantsAll) return callback(null, list);
      return callback(null, list[0]!.address, list[0]!.family);
    });
  }) as unknown as typeof dns.lookup;

  return { validateUrl, lookup };
}
