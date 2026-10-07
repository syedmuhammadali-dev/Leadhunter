import Fastify from "fastify";
import cors from "@fastify/cors";
import type { HealthResponse } from "@leadhunter/shared";

export interface AppDeps {
  pingDb: () => Promise<boolean>;
  webOrigin: string;
}

export async function buildApp({ pingDb, webOrigin }: AppDeps) {
  const app = Fastify({ logger: false });
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

  return app;
}
