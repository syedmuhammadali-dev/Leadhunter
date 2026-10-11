import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

/** Values that must never be accepted as a real key (they are the placeholders from .env.example). */
const PLACEHOLDERS = new Set(["", "change-me", "changeme", "your-key-here"]);
const MIN_KEY_LENGTH = 16;

export function isUsableKey(key: string | undefined): key is string {
  return !!key && !PLACEHOLDERS.has(key.trim().toLowerCase()) && key.length >= MIN_KEY_LENGTH;
}

/** Constant-time comparison that does not leak the length of the secret. */
export function secretsMatch(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Protect every /internal route with the x-api-key header. If no real key is configured the internal API
 * is switched off (503) instead of being left open.
 */
export function protectInternalRoutes(app: FastifyInstance, apiKey: string | undefined): void {
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/internal/")) return;
    if (!isUsableKey(apiKey)) {
      return reply.code(503).send({ error: "Internal API is disabled: set INTERNAL_API_KEY (at least 16 characters) in .env" });
    }
    const header = req.headers["x-api-key"];
    if (!secretsMatch(Array.isArray(header) ? header[0] : header, apiKey)) {
      return reply.code(401).send({ error: "Invalid or missing x-api-key" });
    }
  });
}
