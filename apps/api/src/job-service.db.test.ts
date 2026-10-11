import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { completeJob, createJob, failJob, failStaleJobs, getActiveJob, JobStateError, progressOf, setStep, toJobView } from "./services/job-service.js";

try {
  process.loadEnvFile("../../.env");
} catch {
  // no .env: DB tests are skipped below
}

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
const COUNTRY = "ZZ-Jobs";

describe("progressOf", () => {
  const base = { status: "RUNNING" as const, step: null as string | null, auditsPlanned: 0, auditsCompleted: 0, auditsFailed: 0 };
  it("moves forward through the steps", () => {
    expect(progressOf({ ...base, status: "QUEUED" })).toBe(0);
    expect(progressOf({ ...base, step: "searching" })).toBe(5);
    expect(progressOf({ ...base, step: "saving" })).toBe(20);
    expect(progressOf({ ...base, step: "auditing" })).toBe(90);
    expect(progressOf({ ...base, step: "scoring" })).toBe(95);
    expect(progressOf({ ...base, status: "COMPLETED", step: "done" })).toBe(100);
  });

  it("follows audit progress between 25 and 90 and never exceeds it", () => {
    const at = (done: number, failed = 0) => progressOf({ ...base, step: "auditing", auditsPlanned: 10, auditsCompleted: done, auditsFailed: failed });
    expect(at(0)).toBe(25);
    expect(at(5)).toBe(58);
    expect(at(8, 2)).toBe(90);
    expect(at(20)).toBe(90);
  });
});

describe.skipIf(!url)("job service (Neon)", () => {
  let db: PrismaClient;
  const clean = async () => {
    await db.business.deleteMany({ where: { location: { country: COUNTRY } } });
    await db.searchJob.deleteMany({ where: { country: COUNTRY } });
  };

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    await clean();
  });
  afterAll(async () => {
    await clean();
    await db.$disconnect();
  });

  const newJob = () => createJob(db, { country: COUNTRY, city: "Nowhere", category: "Test", maxResults: 10, provider: "mock" });

  it("creates a running job and walks through the steps", async () => {
    const job = await newJob();
    expect(job).toMatchObject({ status: "RUNNING", step: "searching" });
    expect(job.startedAt).toBeTruthy();
    expect((await setStep(db, job.id, "saving")).step).toBe("saving");
    expect(toJobView(await setStep(db, job.id, "auditing"))).toMatchObject({ step: "auditing", progress: 90 });
  });

  it("completes a job and counts the high priority leads found by that job only", async () => {
    const job = await newJob();
    const mk = async (name: string, priority: "HIGH" | "LOW", linked: boolean) =>
      db.business.create({
        data: {
          name, normalizedName: name, category: "Test", source: "test", dedupeKey: `${name}|${Date.now()}`,
          location: { create: { country: COUNTRY, city: "Nowhere" } },
          lead: { create: { score: 7, priority } },
          ...(linked ? { searchResults: { create: { jobId: job.id } } } : {}),
        },
      });
    await mk("job high linked", "HIGH", true);
    await mk("job low linked", "LOW", true);
    await mk("job high unlinked", "HIGH", false);

    const done = await completeJob(db, job.id);
    expect(done).toMatchObject({ status: "COMPLETED", step: "done", highPriorityCount: 1 });
    expect(done.completedAt).toBeTruthy();
    expect(toJobView(done).progress).toBe(100);
  });

  it("rejects changes to finished jobs and unknown jobs", async () => {
    const job = await newJob();
    await failJob(db, job.id, "provider exploded");
    const failed = await db.searchJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed).toMatchObject({ status: "FAILED", errorMessage: "provider exploded" });
    await expect(setStep(db, job.id, "scoring")).rejects.toMatchObject({ code: "not-active" });
    await expect(completeJob(db, job.id)).rejects.toBeInstanceOf(JobStateError);
    await expect(getActiveJob(db, "missing-id")).rejects.toMatchObject({ code: "not-found" });
  });

  it("fails jobs that have been running too long", async () => {
    const old = await newJob();
    await db.searchJob.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
    const fresh = await newJob();
    expect(await failStaleJobs(db)).toBeGreaterThanOrEqual(1);
    expect((await db.searchJob.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("FAILED");
    expect((await db.searchJob.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("RUNNING");
  });
});
