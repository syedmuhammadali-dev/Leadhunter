import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { newJobSchema } from "./internal-routes.js";
import { failStaleJobs, toJobView } from "./services/job-service.js";
import { triggerResearch, type N8nConfig } from "./services/n8n-client.js";

/** How many research jobs may run at the same time. Protects target sites, n8n and the database. */
export const MAX_ACTIVE_JOBS = 2;

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const STATUS_FOR_REASON = { "not-configured": 503, unreachable: 502, "not-found": 502, rejected: 502, failed: 502, "bad-response": 502 } as const;

/** Routes used by the dashboard to start and watch research jobs. The work itself happens in n8n. */
export function registerJobRoutes(app: FastifyInstance, db: PrismaClient, n8n: N8nConfig, maxActiveJobs = MAX_ACTIVE_JOBS) {
  app.post("/api/search-jobs", async (req, reply) => {
    const parsed = newJobSchema.safeParse({ limit: 50, ...(req.body as object | null) });
    if (!parsed.success) return reply.code(400).send({ error: "Please give a country, city, category and a result limit between 1 and 500", issues: parsed.error.issues });

    await failStaleJobs(db);
    const active = await db.searchJob.count({ where: { status: { in: ["RUNNING", "QUEUED"] } } });
    if (active >= maxActiveJobs) {
      return reply.code(429).send({ error: `${active} research jobs are already running. Wait for one to finish, then try again.` });
    }

    const result = await triggerResearch(n8n, parsed.data);
    if (!result.ok) return reply.code(STATUS_FOR_REASON[result.reason]).send({ error: result.message, reason: result.reason });
    return reply.code(202).send({ jobId: result.jobId });
  });

  app.get("/api/search-jobs", async (req, reply) => {
    const q = listQuerySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "Invalid query", issues: q.error.issues });
    await failStaleJobs(db);
    const [total, jobs] = await Promise.all([
      db.searchJob.count(),
      db.searchJob.findMany({ orderBy: { createdAt: "desc" }, skip: (q.data.page - 1) * q.data.pageSize, take: q.data.pageSize }),
    ]);
    return { total, page: q.data.page, pageSize: q.data.pageSize, items: jobs.map(toJobView) };
  });

  app.get("/api/search-jobs/:id", async (req, reply) => {
    const id = z.string().min(1).max(64).safeParse((req.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: "Invalid job id" });
    await failStaleJobs(db);
    const job = await db.searchJob.findUnique({ where: { id: id.data } });
    if (!job) return reply.code(404).send({ error: "Job not found" });
    return toJobView(job);
  });
}
