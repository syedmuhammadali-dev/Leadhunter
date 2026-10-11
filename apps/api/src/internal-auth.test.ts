import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { isUsableKey, protectInternalRoutes, secretsMatch } from "./security/internal-auth.js";

const KEY = "0123456789abcdef0123456789abcdef";

async function appWith(key: string | undefined) {
  const app = Fastify();
  protectInternalRoutes(app, key);
  app.get("/internal/ping", async () => ({ pong: true }));
  app.post("/internal/jobs", async () => ({ created: true }));
  app.get("/api/open", async () => ({ open: true }));
  return app;
}

describe("internal API key protection", () => {
  it("accepts the right key and rejects missing or wrong keys", async () => {
    const app = await appWith(KEY);
    expect((await app.inject({ method: "GET", url: "/internal/ping", headers: { "x-api-key": KEY } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/internal/ping" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/internal/ping", headers: { "x-api-key": KEY + "x" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/internal/ping", headers: { "x-api-key": "" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/internal/jobs" })).statusCode).toBe(401);
  });

  it("does not affect public routes", async () => {
    const app = await appWith(KEY);
    expect((await app.inject({ method: "GET", url: "/api/open" })).statusCode).toBe(200);
  });

  it.each([undefined, "", "change-me", "CHANGE-ME", "short", "   "])("switches the internal API off for key %j", async (key) => {
    const app = await appWith(key);
    const res = await app.inject({ method: "GET", url: "/internal/ping", headers: { "x-api-key": key ?? "x" } });
    expect(res.statusCode).toBe(503);
    expect((await app.inject({ method: "GET", url: "/api/open" })).statusCode).toBe(200);
  });

  it("compares secrets safely", () => {
    expect(secretsMatch(KEY, KEY)).toBe(true);
    expect(secretsMatch(KEY.slice(1), KEY)).toBe(false);
    expect(secretsMatch(undefined, KEY)).toBe(false);
    expect(isUsableKey(KEY)).toBe(true);
    expect(isUsableKey("change-me")).toBe(false);
  });
});
