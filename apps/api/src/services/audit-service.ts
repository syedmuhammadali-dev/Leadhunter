import type { ContactType, Prisma, PrismaClient } from "@prisma/client";
import { runAudit } from "../analyzer/audit-runner.js";
import type { PerformanceProvider } from "../analyzer/performance.js";
import type { TaskQueue } from "../analyzer/queue.js";
import type { SafeFetcher } from "../security/safe-fetch.js";

export interface AuditServiceDeps {
  db: PrismaClient;
  fetcher: SafeFetcher;
  queue: TaskQueue;
  performance: PerformanceProvider | null;
}

export type StartAuditResult =
  | { ok: true; auditId: string; reused: boolean }
  | { ok: false; reason: "not-found" | "no-website" | "queue-full" };

/** An audit stuck in PENDING/RUNNING longer than this is considered dead and may be restarted. */
const STALE_AFTER_MS = 5 * 60 * 1000;

const SOCIAL_TYPE: Record<string, ContactType> = {
  facebook: "FACEBOOK",
  instagram: "INSTAGRAM",
  linkedin: "LINKEDIN",
  twitter: "TWITTER",
  youtube: "YOUTUBE",
  tiktok: "OTHER",
};

/**
 * Create an audit row and run the audit in the background through the shared queue.
 * Returns immediately with the audit id; poll the audit to see progress.
 */
export async function startAudit(deps: AuditServiceDeps, businessId: string): Promise<StartAuditResult> {
  const { db, queue } = deps;
  const business = await db.business.findUnique({ where: { id: businessId }, select: { id: true, website: true } });
  if (!business) return { ok: false, reason: "not-found" };
  if (!business.website) return { ok: false, reason: "no-website" };

  const active = await db.websiteAudit.findFirst({
    where: { businessId, status: { in: ["PENDING", "RUNNING"] }, createdAt: { gt: new Date(Date.now() - STALE_AFTER_MS) } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (active) return { ok: true, auditId: active.id, reused: true };

  if (queue.isFull) return { ok: false, reason: "queue-full" };

  const audit = await db.websiteAudit.create({ data: { businessId, url: business.website, status: "PENDING" }, select: { id: true } });
  void queue
    .run(() => executeAudit(deps, audit.id, businessId, business.website!))
    .catch(async (e: unknown) => {
      await db.websiteAudit
        .update({ where: { id: audit.id }, data: { status: "FAILED", errorMessage: e instanceof Error ? e.message : "Audit failed", finishedAt: new Date() } })
        .catch(() => undefined);
    });
  return { ok: true, auditId: audit.id, reused: false };
}

async function executeAudit(deps: AuditServiceDeps, auditId: string, businessId: string, url: string): Promise<void> {
  const { db } = deps;
  await db.websiteAudit.update({ where: { id: auditId }, data: { status: "RUNNING", startedAt: new Date() } });
  const outcome = await runAudit(url, { fetcher: deps.fetcher, performance: deps.performance });

  if (outcome.kind === "skipped") {
    await db.websiteAudit.update({ where: { id: auditId }, data: { status: "SKIPPED", errorMessage: outcome.message, finishedAt: new Date() } });
    return;
  }

  if (outcome.kind === "failed") {
    const unreachable = outcome.code === "network" || outcome.code === "timeout" || outcome.code === "too-many-redirects";
    await db.$transaction([
      db.websiteAudit.update({ where: { id: auditId }, data: { status: "FAILED", errorMessage: outcome.message, finishedAt: new Date() } }),
      db.business.update({ where: { id: businessId }, data: { websiteStatus: unreachable ? "UNREACHABLE" : "ERROR" } }),
    ]);
    return;
  }

  const { observation: o, result, signals } = outcome;
  const contacts: { type: ContactType; value: string }[] = [
    ...signals.phones.map((value) => ({ type: "PHONE" as const, value })),
    ...signals.emails.map((value) => ({ type: "EMAIL" as const, value })),
    ...signals.whatsappLinks.map((value) => ({ type: "WHATSAPP" as const, value })),
    ...signals.socialLinks.map((s) => ({ type: SOCIAL_TYPE[s.platform] ?? ("OTHER" as const), value: s.url })),
    ...(signals.contactPageUrl ? [{ type: "CONTACT_FORM" as const, value: signals.contactPageUrl }] : []),
  ].filter((c) => c.value.length <= 300);

  await db.$transaction([
    db.websiteAudit.update({
      where: { id: auditId },
      data: {
        status: "COMPLETED",
        httpStatus: o.httpStatus,
        finalUrl: o.finalUrl,
        usesHttps: o.usesHttps,
        redirectCount: o.redirectCount,
        title: o.page?.title ?? null,
        metaDescription: o.page?.metaDescription ?? null,
        hasViewport: o.page?.hasViewport ?? null,
        canonicalUrl: o.page?.canonicalUrl ?? null,
        hasRobotsTxt: o.robotsTxtFound,
        hasSitemap: o.sitemapFound,
        websiteScore: result.score,
        scoreBreakdown: result.breakdown as unknown as Prisma.InputJsonValue,
        signals: signals as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    }),
    db.auditIssue.createMany({
      data: result.issues.map((i) => ({
        auditId,
        type: i.type,
        severity: i.severity,
        title: i.title,
        explanation: i.explanation,
        evidence: i.evidence,
        pointsDeducted: i.pointsDeducted,
      })),
    }),
    db.business.update({ where: { id: businessId }, data: { websiteStatus: o.httpStatus >= 400 ? "ERROR" : "ACTIVE" } }),
    db.contactMethod.createMany({
      data: contacts.map((c) => ({ businessId, type: c.type, value: c.value, source: "website-audit" })),
      skipDuplicates: true,
    }),
  ]);
}
