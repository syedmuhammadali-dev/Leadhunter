import type { FastifyInstance } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

export const QUICK_FILTERS = ["has-website", "no-website", "problems", "high", "medium", "low"] as const;
export const SORT_KEYS = ["score", "name", "rating", "reviews", "websiteScore"] as const;

const listQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  filter: z.enum(QUICK_FILTERS).or(z.literal("")).default(""),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  status: z
    .enum(["NEW", "RESEARCHED", "CONTACTED", "REPLIED", "INTERESTED", "MEETING", "PROPOSAL", "WON", "LOST", "FOLLOW_UP"])
    .optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  maxScore: z.coerce.number().int().min(0).max(100).optional(),
  country: z.string().trim().max(100).default(""),
  city: z.string().trim().max(100).default(""),
  category: z.string().trim().max(100).default(""),
  sort: z.enum(SORT_KEYS).default("score"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  /** Cap the result set ("Maximum Results" on the search form). 0 = no cap. */
  limit: z.coerce.number().int().min(0).max(1000).default(0),
});

type ListQuery = z.infer<typeof listQuerySchema>;

const leadInclude = {
  business: {
    include: {
      location: true,
      audits: {
        orderBy: { createdAt: "desc" as const },
        take: 5,
        select: {
          id: true,
          status: true,
          websiteScore: true,
          issues: { orderBy: { pointsDeducted: "desc" as const }, take: 2, select: { title: true } },
        },
      },
    },
  },
} satisfies Prisma.LeadInclude;

type LeadRow = Prisma.LeadGetPayload<{ include: typeof leadInclude }>;

/** The newest finished audit, else the newest one in progress. */
function currentAudit(audits: LeadRow["business"]["audits"]) {
  return audits.find((a) => ["COMPLETED", "FAILED", "SKIPPED"].includes(a.status)) ?? audits[0] ?? null;
}

function problemsOf(row: LeadRow): string[] {
  const b = row.business;
  if (!b.website) return ["No website"];
  if (b.websiteStatus === "UNREACHABLE") return ["Website unreachable"];
  const audit = currentAudit(b.audits);
  return audit?.status === "COMPLETED" ? audit.issues.map((i) => i.title) : [];
}

function toListItem(row: LeadRow) {
  const b = row.business;
  return {
    id: row.id,
    businessId: b.id,
    name: b.name,
    category: b.category,
    country: b.location?.country ?? "",
    city: b.location?.city ?? "",
    address: b.location?.address ?? null,
    website: b.website,
    phone: b.phone,
    rating: b.rating,
    reviewCount: b.reviewCount,
    websiteStatus: b.websiteStatus,
    websiteScore: b.websiteScore,
    auditStatus: currentAudit(b.audits)?.status ?? null,
    score: row.score,
    maximumScore: row.maximumScore,
    priority: row.priority,
    status: row.status,
    problems: problemsOf(row),
    source: b.source,
    scoredAt: row.scoredAt,
    lastAuditedAt: b.lastAuditedAt,
  };
}

function buildWhere(q: ListQuery): Prisma.LeadWhereInput {
  const business: Prisma.BusinessWhereInput[] = [];
  const insensitive = "insensitive" as const;
  if (q.q) {
    business.push({
      OR: [
        { name: { contains: q.q, mode: insensitive } },
        { category: { contains: q.q, mode: insensitive } },
        { location: { is: { city: { contains: q.q, mode: insensitive } } } },
      ],
    });
  }
  if (q.country) business.push({ location: { is: { country: { equals: q.country, mode: insensitive } } } });
  if (q.city) business.push({ location: { is: { city: { contains: q.city, mode: insensitive } } } });
  if (q.category) business.push({ category: { contains: q.category, mode: insensitive } });

  let priority = q.priority;
  switch (q.filter) {
    case "has-website":
      business.push({ website: { not: null } });
      break;
    case "no-website":
      business.push({ website: null });
      break;
    case "problems":
      business.push({ website: { not: null } }, { OR: [{ websiteStatus: { in: ["UNREACHABLE", "ERROR"] } }, { websiteScore: { lt: 100 } }] });
      break;
    case "high":
      priority = "HIGH";
      break;
    case "medium":
      priority = "MEDIUM";
      break;
    case "low":
      priority = "LOW";
      break;
  }

  const score: Prisma.IntNullableFilter = {};
  if (q.minScore !== undefined) score.gte = q.minScore;
  if (q.maxScore !== undefined) score.lte = q.maxScore;

  return {
    ...(business.length ? { business: { AND: business } } : {}),
    ...(priority ? { priority } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(Object.keys(score).length ? { score } : {}),
  };
}

function buildOrderBy(q: ListQuery): Prisma.LeadOrderByWithRelationInput[] {
  const nullsLast = { sort: q.dir, nulls: "last" as const };
  const primary: Prisma.LeadOrderByWithRelationInput =
    q.sort === "name"
      ? { business: { name: q.dir } }
      : q.sort === "rating"
        ? { business: { rating: nullsLast } }
        : q.sort === "reviews"
          ? { business: { reviewCount: nullsLast } }
          : q.sort === "websiteScore"
            ? { business: { websiteScore: nullsLast } }
            : { score: nullsLast };
  // Stable tie-breakers so pages never repeat or skip rows.
  return [primary, { business: { name: "asc" } }, { id: "asc" }];
}

export function registerLeadRoutes(app: FastifyInstance, db: PrismaClient) {
  app.get("/api/leads", async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query", issues: parsed.error.issues });
    const q = parsed.data;
    const where = buildWhere(q);

    const matching = await db.lead.count({ where });
    const total = q.limit > 0 ? Math.min(matching, q.limit) : matching;
    const pages = Math.max(1, Math.ceil(total / q.pageSize));
    const page = Math.min(q.page, pages);
    const skip = (page - 1) * q.pageSize;
    const take = Math.max(0, Math.min(q.pageSize, total - skip));

    const rows = take === 0 ? [] : await db.lead.findMany({ where, orderBy: buildOrderBy(q), skip, take, include: leadInclude });
    return { total, page, pages, pageSize: q.pageSize, items: rows.map(toListItem) };
  });

  app.get("/api/leads/stats", async () => {
    const [total, grouped, noWebsite, avg, top] = await Promise.all([
      db.lead.count(),
      db.lead.groupBy({ by: ["priority"], _count: { _all: true } }),
      db.lead.count({ where: { business: { website: null } } }),
      db.lead.aggregate({ _avg: { score: true }, where: { score: { not: null } } }),
      db.lead.findMany({ where: { priority: "HIGH" }, orderBy: buildOrderBy(listQuerySchema.parse({})), take: 5, include: leadInclude }),
    ]);
    const count = (p: "HIGH" | "MEDIUM" | "LOW" | null) => grouped.find((g) => g.priority === p)?._count._all ?? 0;
    return {
      total,
      byPriority: { HIGH: count("HIGH"), MEDIUM: count("MEDIUM"), LOW: count("LOW"), unscored: count(null) },
      noWebsite,
      averageScore: avg._avg.score === null ? null : Math.round(avg._avg.score * 10) / 10,
      topLeads: top.map(toListItem),
    };
  });

  app.get("/api/leads/:id", async (req, reply) => {
    const id = z.string().min(1).max(64).safeParse((req.params as { id?: string }).id);
    if (!id.success) return reply.code(400).send({ error: "Invalid lead id" });
    const lead = await db.lead.findUnique({
      where: { id: id.data },
      include: {
        ...leadInclude,
        scores: { orderBy: { calculatedAt: "desc" }, take: 5 },
        business: { include: { ...leadInclude.business.include, contactMethods: { orderBy: { type: "asc" } } } },
      },
    });
    if (!lead) return reply.code(404).send({ error: "Lead not found" });
    const latest = lead.scores[0] ?? null;
    return {
      ...toListItem(lead),
      email: lead.business.publicEmail,
      sourceUrl: lead.business.sourceUrl,
      notes: lead.notes,
      tags: lead.tags,
      contactMethods: lead.business.contactMethods.map((c) => ({ type: c.type, value: c.value, source: c.source })),
      latestScore: latest
        ? {
            score: latest.score,
            maximumScore: latest.maximumScore,
            priority: latest.priority,
            reasons: latest.reasons as string[],
            details: latest.signals as { signals: unknown[]; notes: string[] },
            configVersion: latest.configVersion,
            calculatedAt: latest.calculatedAt,
          }
        : null,
      scoreHistory: lead.scores.map((s) => ({ score: s.score, priority: s.priority, configVersion: s.configVersion, calculatedAt: s.calculatedAt })),
    };
  });
}
