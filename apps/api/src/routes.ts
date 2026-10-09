import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { MAX_CSV_BYTES, searchBusinessesParamsSchema } from "@leadhunter/shared";
import { z } from "zod";
import { CsvProvider } from "./providers/csv.js";
import { PROVIDER_INFO, createProvider } from "./providers/registry.js";
import { importCsv, saveBusinesses } from "./services/importer.js";

const importBodySchema = z.object({ csvText: z.string().min(1).max(MAX_CSV_BYTES) });

const searchBodySchema = searchBusinessesParamsSchema.extend({
  provider: z.enum(["mock", "csv"]).default("mock"),
  csvText: z.string().max(MAX_CSV_BYTES).optional(),
  /** Save the results into the database (duplicates are skipped). */
  save: z.boolean().default(false),
});

const listQuerySchema = z.object({
  source: z.string().max(50).optional(),
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function registerRoutes(app: FastifyInstance, db: PrismaClient) {
  app.get("/api/providers", async () => PROVIDER_INFO);

  app.post("/api/import/csv", async (req, reply) => {
    const body = importBodySchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Body must be { csvText: string } (max 5 MB)", issues: body.error.issues });
    const report = await importCsv(db, body.data.csvText);
    return reply.code(report.fileErrors.length > 0 ? 400 : 200).send(report);
  });

  app.post("/api/search", async (req, reply) => {
    const body = searchBodySchema.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "Invalid search request", issues: body.error.issues });
    const { provider: name, csvText, save, ...params } = body.data;
    if (name === "csv" && !csvText) return reply.code(400).send({ error: "csvText is required for the csv provider" });

    const provider = createProvider(name, { csvText });
    if (provider instanceof CsvProvider && provider.fileErrors.length > 0) {
      return reply.code(400).send({ error: provider.fileErrors.join("; ") });
    }
    const businesses = await provider.searchBusinesses(params);
    const saved = save ? await saveBusinesses(db, businesses.map((business) => ({ business })), provider.name) : undefined;
    return { provider: provider.name, count: businesses.length, businesses, saved };
  });

  app.get("/api/businesses", async (req, reply) => {
    const query = listQuerySchema.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid query", issues: query.error.issues });
    const { source, q, page, pageSize } = query.data;
    const where = {
      ...(source ? { source } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { category: { contains: q, mode: "insensitive" as const } }] } : {}),
    };
    const [total, items] = await Promise.all([
      db.business.count({ where }),
      db.business.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { location: true },
      }),
    ]);
    return { total, page, pageSize, items };
  });
}
