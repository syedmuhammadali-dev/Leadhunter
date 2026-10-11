import Fastify from "fastify";
import cors from "@fastify/cors";
import type { PrismaClient } from "@prisma/client";
import { MAX_CSV_BYTES, type HealthResponse } from "@leadhunter/shared";
import { registerRoutes } from "./routes.js";
import type { AuditServiceDeps } from "./services/audit-service.js";

export interface AppDeps {
  pingDb: () => Promise<boolean>;
  webOrigin: string;
  /** When provided, the /api routes (providers, import, businesses) are registered. */
  db?: PrismaClient;
  /** When provided (with db), the website audit routes are registered. */
  audit?: AuditServiceDeps;
}

export async function buildApp({ pingDb, webOrigin, db, audit }: AppDeps) {
  // JSON overhead on top of the CSV text: allow a little more than the CSV limit.
  const app = Fastify({ logger: false, bodyLimit: MAX_CSV_BYTES + 64 * 1024 });
  await app.register(cors, { origin: webOrigin });

  app.get("/health", async (): Promise<HealthResponse> => {
    const dbUp = await pingDb();
    return {
      status: dbUp ? "ok" : "degraded",
      service: "leadhunter-api",
      database: dbUp ? "up" : "down",
      time: new Date().toISOString(),
    };
  });

  if (db) registerRoutes(app, db, audit);

  return app;
}
