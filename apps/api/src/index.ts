import { createPerformanceProvider } from "./analyzer/performance.js";
import { TaskQueue } from "./analyzer/queue.js";
import { buildApp } from "./app.js";
import { getDb, pingDb } from "./db.js";
import { createSafeFetcher, HostRateLimiter } from "./security/safe-fetch.js";

const port = Number(process.env.API_PORT ?? 4000);
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

const db = getDb();
const audit = {
  db,
  // Strict SSRF guard (no test allow-list) and at least this long between requests to the same site.
  fetcher: createSafeFetcher({ limiter: new HostRateLimiter(intFromEnv("AUDIT_HOST_DELAY_MS", 1500, 0, 60_000)) }),
  queue: new TaskQueue(intFromEnv("AUDIT_CONCURRENCY", 2, 1, 5), 100),
  performance: createPerformanceProvider(),
};

const app = await buildApp({ pingDb, webOrigin, db, audit });
await app.listen({ port, host: "127.0.0.1" });
console.log(`LeadHunter API listening on http://127.0.0.1:${port}`);
