import Fastify from "fastify";
import cors from "@fastify/cors";
import type { PrismaClient } from "@prisma/client";
import { MAX_CSV_BYTES, type HealthResponse } from "@leadhunter/shared";
import { registerInternalRoutes } from "./internal-routes.js";
import { registerRoutes } from "./routes.js";
import { protectInternalRoutes } from "./security/internal-auth.js";
import type { AuditServiceDeps } from "./services/audit-service.js";

export interface AppDeps {
  pingDb: () => Promise<boolean>;
  webOrigin: string;
  /** When provided, the /api routes (providers, import, businesses) are registered. */
  db?: PrismaClient;
  /** When provided (with db), the website audit routes are registered. */
  audit?: AuditServiceDeps;
  /** Key that n8n must send as x-api-key to use /internal routes. Without a real key they stay disabled. */
  internalApiKey?: string;
  /** Cap on website audits per research job. Default 25. */
  maxAuditsPerJob?: number;
}

export async function buildApp({ pingDb, webOrigin, db, audit, internalApiKey, maxAuditsPerJob = 25 }: AppDeps) {
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

  protectInternalRoutes(app, internalApiKey);
  if (db) registerRoutes(app, db, audit);
  if (db && audit) registerInternalRoutes(app, { db, audit, maxAuditsPerJob });

  return app;
}
