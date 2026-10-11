import type { Prisma, PrismaClient } from "@prisma/client";
import { getScoringConfig, type ScoringConfig } from "../scoring/config.js";
import { scoreLead, type ScoreResult, type ScoringInput } from "../scoring/engine.js";

const CHUNK = 200;
const TERMINAL = new Set(["COMPLETED", "FAILED", "SKIPPED"]);

export interface ScoreRunSummary {
  scored: number;
  /** Businesses whose stored score actually changed (a new LeadScore history row was written). */
  changed: number;
  configVersion: string;
}

type AuditRow = { status: ScoringInput["audit"] extends infer A ? (A extends { status: infer S } ? S : never) : never; issues: { type: string }[] };

/** The audit that should drive the score: the newest finished one, else the newest in-progress one. */
function pickAudit(audits: AuditRow[]): ScoringInput["audit"] {
  const chosen = audits.find((a) => TERMINAL.has(a.status)) ?? audits[0];
  return chosen ? { status: chosen.status, issueTypes: chosen.issues.map((i) => i.type) } : null;
}

const asJson = (value: unknown) => value as unknown as Prisma.InputJsonValue;

/** Prisma error codes meaning "a lead was deleted while we were scoring it". */
const VANISHED = new Set(["P2003", "P2025"]);
const isVanished = (e: unknown) => typeof e === "object" && e !== null && VANISHED.has((e as { code?: string }).code ?? "");

/**
 * Write a chunk of scores atomically. If a lead was deleted mid-run (another request removed the business),
 * fall back to row-by-row writes and skip the vanished ones instead of failing the whole run.
 */
async function writeScores(db: PrismaClient, scores: Prisma.LeadScoreCreateManyInput[], updates: Prisma.PrismaPromise<unknown>[]): Promise<void> {
  try {
    await db.$transaction([db.leadScore.createMany({ data: scores }), ...updates]);
  } catch (e) {
    if (!isVanished(e)) throw e;
    for (const score of scores) {
      try {
        await db.$transaction([
          db.leadScore.create({ data: score }),
          db.lead.updateMany({
            where: { id: score.leadId },
            data: { score: score.score, maximumScore: score.maximumScore, priority: score.priority, scoredAt: new Date() },
          }),
        ]);
      } catch (inner) {
        if (!isVanished(inner)) throw inner;
      }
    }
  }
}

/**
 * Score businesses and store the result: a LeadScore history row (only when something changed)
 * plus a copy on the Lead for fast filtering and sorting. Safe to call repeatedly.
 */
export async function scoreBusinesses(db: PrismaClient, businessIds: string[], config: ScoringConfig = getScoringConfig()): Promise<ScoreRunSummary> {
  let scored = 0;
  let changed = 0;
  const ids = [...new Set(businessIds)];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const select = {
      id: true,
      website: true,
      websiteStatus: true,
      reviewCount: true,
      lead: { select: { id: true } },
      audits: { orderBy: { createdAt: "desc" as const }, take: 5, select: { status: true, issues: { select: { type: true } } } },
    };
    let rows = await db.business.findMany({ where: { id: { in: chunk } }, select });

    const leadless = rows.filter((r) => !r.lead);
    if (leadless.length > 0) {
      await db.lead.createMany({ data: leadless.map((r) => ({ businessId: r.id })), skipDuplicates: true });
      rows = await db.business.findMany({ where: { id: { in: chunk } }, select });
    }

    const leadIds = rows.map((r) => r.lead!.id);
    const previous = await db.leadScore.findMany({
      where: { leadId: { in: leadIds } },
      orderBy: { calculatedAt: "desc" },
      distinct: ["leadId"],
      select: { leadId: true, score: true, priority: true, configVersion: true, reasons: true },
    });
    const prevByLead = new Map(previous.map((p) => [p.leadId, p]));

    const newScores: Prisma.LeadScoreCreateManyInput[] = [];
    const leadUpdates: Prisma.PrismaPromise<unknown>[] = [];
    for (const row of rows) {
      const result: ScoreResult = scoreLead(
        { hasWebsite: !!row.website, websiteStatus: row.websiteStatus, reviewCount: row.reviewCount, audit: pickAudit(row.audits as AuditRow[]) },
        config,
      );
      scored++;
      const leadId = row.lead!.id;
      const prev = prevByLead.get(leadId);
      const same =
        prev &&
        prev.score === result.score &&
        prev.priority === result.priority &&
        prev.configVersion === result.configVersion &&
        JSON.stringify(prev.reasons) === JSON.stringify(result.reasons);
      if (same) continue;
      changed++;
      newScores.push({
        leadId,
        score: result.score,
        maximumScore: result.maximumScore,
        priority: result.priority,
        reasons: asJson(result.reasons),
        signals: asJson({ signals: result.signals, notes: result.notes }),
        configVersion: result.configVersion,
      });
      leadUpdates.push(
        db.lead.updateMany({
          where: { id: leadId },
          data: { score: result.score, maximumScore: result.maximumScore, priority: result.priority, scoredAt: new Date() },
        }),
      );
    }

    if (newScores.length > 0) await writeScores(db, newScores, leadUpdates);
  }
  return { scored, changed, configVersion: config.version };
}

/** Score every business in the database (used after changing the scoring config). */
export async function recalculateAll(db: PrismaClient, config: ScoringConfig = getScoringConfig()): Promise<ScoreRunSummary> {
  const total: ScoreRunSummary = { scored: 0, changed: 0, configVersion: config.version };
  let cursor: string | undefined;
  for (;;) {
    const page = await db.business.findMany({ select: { id: true }, orderBy: { id: "asc" }, take: 1000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (page.length === 0) break;
    const r = await scoreBusinesses(db, page.map((b) => b.id), config);
    total.scored += r.scored;
    total.changed += r.changed;
    cursor = page[page.length - 1]!.id;
  }
  return total;
}
