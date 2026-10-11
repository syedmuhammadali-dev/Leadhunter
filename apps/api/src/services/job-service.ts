import type { PrismaClient, SearchJob } from "@prisma/client";

export const JOB_STEPS = ["searching", "saving", "auditing", "scoring", "done"] as const;
export type JobStep = (typeof JOB_STEPS)[number];

/** A running job that has not finished after this long is treated as dead (for example n8n was stopped). */
export const JOB_STALE_AFTER_MS = 60 * 60 * 1000;

export class JobStateError extends Error {
  constructor(
    message: string,
    readonly code: "not-found" | "not-active",
  ) {
    super(message);
    this.name = "JobStateError";
  }
}

export interface NewJob {
  country: string;
  city: string;
  category: string;
  maxResults: number;
  provider: string;
}

/** Percentage shown on the progress bar, derived from the step and audit counters. */
export function progressOf(job: Pick<SearchJob, "status" | "step" | "auditsPlanned" | "auditsCompleted" | "auditsFailed">): number {
  if (job.status === "COMPLETED") return 100;
  switch (job.step) {
    case "searching":
      return 5;
    case "saving":
      return 20;
    case "auditing": {
      if (job.auditsPlanned <= 0) return 90;
      const done = Math.min(job.auditsPlanned, job.auditsCompleted + job.auditsFailed);
      return Math.round(25 + 65 * (done / job.auditsPlanned));
    }
    case "scoring":
      return 95;
    case "done":
      return 100;
    default:
      return job.status === "QUEUED" ? 0 : 2;
  }
}

export function toJobView(job: SearchJob) {
  return {
    id: job.id,
    country: job.country,
    city: job.city,
    category: job.category,
    maxResults: job.maxResults,
    provider: job.provider,
    status: job.status,
    step: job.step,
    businessesFound: job.businessesFound,
    websitesFound: job.websitesFound,
    duplicatesSkipped: job.duplicatesSkipped,
    auditsPlanned: job.auditsPlanned,
    auditsCompleted: job.auditsCompleted,
    auditsFailed: job.auditsFailed,
    highPriorityCount: job.highPriorityCount,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    progress: progressOf(job),
  };
}

export type JobView = ReturnType<typeof toJobView>;

export async function createJob(db: PrismaClient, input: NewJob): Promise<SearchJob> {
  return db.searchJob.create({ data: { ...input, status: "RUNNING", step: "searching", startedAt: new Date() } });
}

/** Load a job that is still being worked on. Finished, failed or cancelled jobs cannot be changed any more. */
export async function getActiveJob(db: PrismaClient, id: string): Promise<SearchJob> {
  const job = await db.searchJob.findUnique({ where: { id } });
  if (!job) throw new JobStateError("Job not found", "not-found");
  if (job.status !== "RUNNING" && job.status !== "QUEUED") throw new JobStateError(`Job is ${job.status.toLowerCase()}`, "not-active");
  return job;
}

export async function setStep(db: PrismaClient, id: string, step: JobStep): Promise<SearchJob> {
  await getActiveJob(db, id);
  return db.searchJob.update({ where: { id }, data: { step, status: "RUNNING" } });
}

export async function completeJob(db: PrismaClient, id: string): Promise<SearchJob> {
  await getActiveJob(db, id);
  const highPriorityCount = await db.lead.count({ where: { priority: "HIGH", business: { searchResults: { some: { jobId: id } } } } });
  return db.searchJob.update({ where: { id }, data: { status: "COMPLETED", step: "done", highPriorityCount, completedAt: new Date(), errorMessage: null } });
}

export async function failJob(db: PrismaClient, id: string, message: string): Promise<SearchJob> {
  await getActiveJob(db, id);
  return db.searchJob.update({ where: { id }, data: { status: "FAILED", errorMessage: message.slice(0, 500), completedAt: new Date() } });
}

/** Mark jobs that have been running for too long as failed, so the dashboard never shows them as "Searching" forever. */
export async function failStaleJobs(db: PrismaClient, now = Date.now()): Promise<number> {
  const r = await db.searchJob.updateMany({
    where: { status: { in: ["RUNNING", "QUEUED"] }, createdAt: { lt: new Date(now - JOB_STALE_AFTER_MS) } },
    data: { status: "FAILED", errorMessage: "The research job did not finish. Check that n8n is running and try again.", completedAt: new Date(now) },
  });
  return r.count;
}
