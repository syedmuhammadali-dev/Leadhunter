import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { MAX_CSV_BYTES, searchBusinessesParamsSchema } from "@leadhunter/shared";
import { z } from "zod";
import { CsvProvider } from "./providers/csv.js";
import { PROVIDER_INFO, createProvider } from "./providers/registry.js";
import { startAudit, type AuditServiceDeps } from "./services/audit-service.js";
import { importCsv, saveBusinesses } from "./services/importer.js";

/** Upper bound for one batch request, so a single call cannot queue thousands of audits. */
export const MAX_BATCH_AUDITS = 25;

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

const idSchema = z.string().min(1).max(64);

/** Include only the most recent audit's summary when listing businesses. */
const LATEST_AUDIT = {
  orderBy: { createdAt: "desc" as const },
  take: 1,
  select: { id: true, status: true, websiteScore: true, finishedAt: true, errorMessage: true },
};
const batchBodySchema = z.object({ businessIds: z.array(idSchema).min(1).max(MAX_BATCH_AUDITS) });

export function registerRoutes(app: FastifyInstance, db: PrismaClient, audit?: AuditServiceDeps) {
  if (audit) registerAuditRoutes(app, db, audit);

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
        include: { location: true, audits: LATEST_AUDIT },
      }),
    ]);
    return { total, page, pageSize, items };
  });

  app.get("/api/businesses/:id", async (req, reply) => {
    const id = idSchema.safeParse((req.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: "Invalid business id" });
    const found = await db.business.findUnique({ where: { id: id.data }, include: { location: true, audits: LATEST_AUDIT } });
    if (!found) return reply.code(404).send({ error: "Business not found" });
    return found;
  });
}

const REASON_STATUS = { "not-found": 404, "no-website": 400, "queue-full": 429 } as const;
const REASON_MESSAGE = {
  "not-found": "Business not found",
  "no-website": "This business has no website to audit",
  "queue-full": "Too many audits are waiting. Try again in a minute",
} as const;

function registerAuditRoutes(app: FastifyInstance, db: PrismaClient, audit: AuditServiceDeps) {
  const auditInclude = { issues: { orderBy: [{ pointsDeducted: "desc" as const }, { detectedAt: "asc" as const }] } };

  app.post("/api/businesses/:id/audit", async (req, reply) => {
    const id = idSchema.safeParse((req.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: "Invalid business id" });
    const result = await startAudit(audit, id.data);
    if (!result.ok) return reply.code(REASON_STATUS[result.reason]).send({ error: REASON_MESSAGE[result.reason] });
    return reply.code(202).send({ auditId: result.auditId, reused: result.reused });
  });

  app.post("/api/audits/batch", async (req, reply) => {
    const body = batchBodySchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: `Send { businessIds: string[] } with 1 to ${MAX_BATCH_AUDITS} ids`, issues: body.error.issues });
    const started: { businessId: string; auditId: string }[] = [];
    const skipped: { businessId: string; reason: string }[] = [];
    for (const businessId of new Set(body.data.businessIds)) {
      const r = await startAudit(audit, businessId);
      if (r.ok) started.push({ businessId, auditId: r.auditId });
      else skipped.push({ businessId, reason: REASON_MESSAGE[r.reason] });
    }
    return reply.code(202).send({ started, skipped });
  });

  app.get("/api/audits/:id", async (req, reply) => {
    const id = idSchema.safeParse((req.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: "Invalid audit id" });
    const found = await db.websiteAudit.findUnique({ where: { id: id.data }, include: { ...auditInclude, business: { select: { id: true, name: true, website: true } } } });
    if (!found) return reply.code(404).send({ error: "Audit not found" });
    return found;
  });

  app.get("/api/businesses/:id/audits", async (req, reply) => {
    const id = idSchema.safeParse((req.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: "Invalid business id" });
    return db.websiteAudit.findMany({ where: { businessId: id.data }, orderBy: { createdAt: "desc" }, take: 5, include: auditInclude });
  });
}
