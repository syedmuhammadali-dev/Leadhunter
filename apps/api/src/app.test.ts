import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("GET /health", () => {
  it("returns ok when the database is up", async () => {
    const app = await buildApp({ pingDb: async () => true, webOrigin: "http://localhost:3000" });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", database: "up", service: "leadhunter-api" });
  });

  it("returns degraded when the database is down", async () => {
    const app = await buildApp({ pingDb: async () => false, webOrigin: "http://localhost:3000" });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toMatchObject({ status: "degraded", database: "down" });
  });
});
