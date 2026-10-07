import { defineConfig } from "prisma/config";

// Prisma 7 no longer loads .env automatically.
try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional (CI/production set real env vars)
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "node --env-file=.env --import tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations should use a direct (non-pooled) connection when available.
    url: process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? "",
  },
});
