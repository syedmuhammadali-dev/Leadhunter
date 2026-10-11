import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { normalizeHttpUrl, type ProviderBusiness } from "@leadhunter/shared";
import { z, ZodError } from "zod";
import { createProvider } from "./providers/registry.js";
import { auditNow, type AuditServiceDeps } from "./services/audit-service.js";
import { saveBusinesses } from "./services/importer.js";
import { completeJob, createJob, failJob, getActiveJob, JOB_STEPS, JobStateError, setStep, toJobView } from "./services/job-service.js";
import { scoreBusinesses } from "./services/scoring-service.js";

export interface InternalDeps {
  db: PrismaClient;
  audit: AuditServiceDeps;
  /** Hard cap on website audits per research job, so one job cannot audit thousands of sites. */
  maxAuditsPerJob: number;
}

/** Providers a research job may use. CSV needs an uploaded file, so it is import-only. */
export const JOB_PROVIDERS = ["mock"] as const;

const text = z.string().trim().min(1).max(100);

export const newJobSchema = z.object({
  country: text,
  city: text,
  category: text,
  limit: z.number().int().min(1).max(500),
  provider: z.enum(JOB_PROVIDERS).default("mock"),
});

const longText = z.string().trim().max(300);
const httpUrl = z
  .string()
  .max(2048)
  .refine((v) => normalizeHttpUrl(v) !== null, "must be an http(s) URL")
  .transform((v) => normalizeHttpUrl(v) as string);

const businessSchema = z.object({
  name: longText.min(1),
  category: longText.min(1),
  country: longText.min(1),
  city: longText.min(1),
  address: longText.optional(),
  website: httpUrl.optional(),
  phone: longText.optional(),
  email: z.email().optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().min(0).optional(),
  facebook: httpUrl.optional(),
  instagram: httpUrl.optional(),
  linkedin: httpUrl.optional(),
  sourceId: longText.optional(),
  sourceUrl: httpUrl.optional(),
});

const saveBodySchema = z.object({ businesses: z.array(businessSchema).max(500) });
const auditBodySchema = z.object({ businessId: z.string().min(1).max(64) });
const progressBodySchema = z.object({ step: z.enum(JOB_STEPS) });
const failBodySchema = z.object({ message: z.string().max(500).default("The research workflow reported an error") });
const idParam = z.string().min(1).max(64);

/**
 * Routes called by the n8n "Lead Research" workflow. All of them require the x-api-key header
 * (see security/internal-auth.ts). They only research and analyse; nothing here contacts a business.
 */
export function registerInternalRoutes(app: FastifyInstance, deps: InternalDeps): void {
  const { db } = deps;

  void app.register(async (scope) => {
    scope.setErrorHandler((err, _req, reply) => {
      if (err instanceof JobStateError) return reply.code(err.code === "not-found" ? 404 : 409).send({ error: err.message });
      if (err instanceof ZodError) return reply.code(400).send({ error: "Invalid request body", issues: err.issues });
      const known = err as { statusCode?: number; message?: string };
      if (known.statusCode && known.statusCode >= 400 && known.statusCode < 500) return reply.code(known.statusCode).send({ error: known.message ?? "Bad request" });
      console.error("Internal route failed:", err);
      return reply.code(500).send({ error: "Internal error" });
    });

    const jobId = (req: { params: unknown }) => idParam.parse((req.params as { id?: string }).id);

    // Create the SearchJob (workflow step "Create SearchJob").
    scope.post("/internal/jobs", async (req, reply) => {
      const input = newJobSchema.parse(req.body);
      const job = await createJob(db, { country: input.country, city: input.city, category: input.category, maxResults: input.limit, provider: input.provider });
      return reply.code(201).send({ jobId: job.id });
    });

    scope.get("/internal/jobs/:id", async (req) => {
      const job = await db.searchJob.findUnique({ where: { id: jobId(req) } });
      if (!job) throw new JobStateError("Job not found", "not-found");
      return toJobView(job);
    });

    // Ask the configured provider for businesses (does not save anything).
    scope.post("/internal/jobs/:id/search", async (req) => {
      const job = await getActiveJob(db, jobId(req));
      await setStep(db, job.id, "searching");
      const provider = createProvider(job.provider as (typeof JOB_PROVIDERS)[number]);
      const businesses = await provider.searchBusinesses({ country: job.country, city: job.city, category: job.category, limit: job.maxResults });
      return { count: businesses.length, businesses };
    });

    // De-duplicate and save, link everything to the job, and decide which websites to audit.
    scope.post("/internal/jobs/:id/save", async (req) => {
      const job = await getActiveJob(db, jobId(req));
      const { businesses } = saveBodySchema.parse(req.body);
      await setStep(db, job.id, "saving");
      const items = businesses.map((business) => ({ business: business as ProviderBusiness }));
      const saved = await saveBusinesses(db, items, job.provider);

      await db.searchResult.createMany({ data: saved.linkedIds.map((businessId, i) => ({ jobId: job.id, businessId, rank: i + 1 })), skipDuplicates: true });

      const withWebsite = await db.business.count({ where: { id: { in: saved.linkedIds }, website: { not: null } } });
      const needAudit = await db.business.findMany({
        where: { id: { in: saved.linkedIds }, website: { not: null }, audits: { none: { status: "COMPLETED" } } },
        select: { id: true },
      });
      const order = new Map(saved.linkedIds.map((id, i) => [id, i]));
      const sorted = needAudit.map((b) => b.id).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      const toAudit = sorted.slice(0, deps.maxAuditsPerJob);

      await db.searchJob.update({
        where: { id: job.id },
        data: { businessesFound: saved.linkedIds.length, websitesFound: withWebsite, duplicatesSkipped: saved.duplicates.length, auditsPlanned: toAudit.length, step: toAudit.length > 0 ? "auditing" : "scoring" },
      });
      return {
        found: saved.linkedIds.length,
        inserted: saved.inserted,
        duplicatesSkipped: saved.duplicates.length,
        websitesFound: withWebsite,
        auditsPlanned: toAudit.length,
        auditsLeftOutByLimit: sorted.length - toAudit.length,
        toAudit,
      };
    });

    // Audit one business of this job and wait for the result (the workflow calls this one site at a time).
    scope.post("/internal/jobs/:id/audit", async (req, reply) => {
      const job = await getActiveJob(db, jobId(req));
      const { businessId } = auditBodySchema.parse(req.body);
      const linked = await db.searchResult.findUnique({ where: { jobId_businessId: { jobId: job.id, businessId } }, select: { id: true } });
      if (!linked) return reply.code(404).send({ error: "That business does not belong to this job" });

      const result = await auditNow(deps.audit, businessId);
      if (!result.ok) {
        await db.searchJob.update({ where: { id: job.id }, data: { auditsFailed: { increment: 1 } } });
        return reply.send({ businessId, status: "FAILED", websiteScore: null, errorMessage: result.reason });
      }
      const ok = result.audit.status === "COMPLETED" || result.audit.status === "SKIPPED";
      await db.searchJob.update({ where: { id: job.id }, data: ok ? { auditsCompleted: { increment: 1 } } : { auditsFailed: { increment: 1 } } });
      return { businessId, status: result.audit.status, websiteScore: result.audit.websiteScore, errorMessage: result.audit.errorMessage };
    });

    scope.post("/internal/jobs/:id/score", async (req) => {
      const job = await getActiveJob(db, jobId(req));
      await setStep(db, job.id, "scoring");
      const links = await db.searchResult.findMany({ where: { jobId: job.id }, select: { businessId: true } });
      return scoreBusinesses(db, links.map((l) => l.businessId));
    });

    scope.post("/internal/jobs/:id/progress", async (req) => {
      const { step } = progressBodySchema.parse(req.body);
      return toJobView(await setStep(db, jobId(req), step));
    });

    // Final statistics (workflow step "Return final statistics").
    scope.post("/internal/jobs/:id/complete", async (req) => toJobView(await completeJob(db, jobId(req))));

    scope.post("/internal/jobs/:id/fail", async (req) => {
      const { message } = failBodySchema.parse(req.body ?? {});
      return toJobView(await failJob(db, jobId(req), message));
    });
  });
}
