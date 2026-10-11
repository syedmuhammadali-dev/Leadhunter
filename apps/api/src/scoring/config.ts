import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";

const weight = z.number().int().min(0).max(20);

const signalSchema = z.object({
  label: z.string().min(1).max(100),
  weight,
});

/** A website signal fires when the latest completed audit contains any of these issue types. */
const auditSignalSchema = signalSchema.extend({
  issueTypes: z.array(z.string().min(1).max(60)).min(1).max(20),
});

export const scoringConfigSchema = z.object({
  thresholds: z
    .object({
      /** Score at or above this is High Priority. */
      high: z.number().int().min(1).max(100),
      /** Score at or above this (and below high) is Medium Priority. */
      medium: z.number().int().min(0).max(100),
    })
    .refine((t) => t.high > t.medium, { message: "thresholds.high must be greater than thresholds.medium" }),
  signals: z.object({
    noWebsite: signalSchema,
    websiteUnreachable: signalSchema,
    mobileProblems: auditSignalSchema,
    contactProblems: auditSignalSchema,
    noCta: auditSignalSchema,
    noWhatsapp: auditSignalSchema,
    missingSeo: auditSignalSchema,
    brokenLinks: auditSignalSchema,
    poorPerformance: auditSignalSchema,
  }),
  /** Public presence tiers by review count. The highest tier the business reaches applies. */
  presence: z.array(z.object({ minReviews: z.number().int().min(1), weight, label: z.string().min(1).max(100) })).max(10),
});

export type ScoringConfigInput = z.infer<typeof scoringConfigSchema>;
export type ScoringConfig = ScoringConfigInput & {
  /** Short hash of the weights. Stored with every score so old scores can be traced to the rules used. */
  version: string;
};

export const DEFAULT_SCORING_CONFIG: ScoringConfigInput = {
  thresholds: { high: 6, medium: 3 },
  signals: {
    noWebsite: { label: "No website found", weight: 5 },
    websiteUnreachable: { label: "Website could not be reached", weight: 3 },
    mobileProblems: { label: "Website has major mobile problems", weight: 3, issueTypes: ["missing-viewport", "viewport-not-responsive"] },
    contactProblems: { label: "Important contact problems", weight: 2, issueTypes: ["no-contact-info", "no-contact-page-or-form"] },
    noCta: { label: "No clear call to action", weight: 2, issueTypes: ["no-cta"] },
    noWhatsapp: { label: "No WhatsApp/contact option", weight: 2, issueTypes: ["no-whatsapp"] },
    missingSeo: { label: "Missing basic SEO elements", weight: 2, issueTypes: ["missing-title", "missing-meta-description", "missing-canonical"] },
    brokenLinks: { label: "Broken links", weight: 2, issueTypes: ["broken-links"] },
    poorPerformance: { label: "Poor performance", weight: 2, issueTypes: ["slow-performance", "large-images"] },
  },
  presence: [
    { minReviews: 100, weight: 1, label: "Solid public presence" },
    { minReviews: 500, weight: 2, label: "Strong public presence" },
  ],
};

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Merge a partial override onto the defaults. Arrays and primitives replace; objects merge. */
function merge(base: Json, override: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = isObject(v) && isObject(base[k]) ? merge(base[k] as Json, v) : v;
  }
  return out;
}

export function withVersion(input: ScoringConfigInput): ScoringConfig {
  const version = createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 8);
  return { ...input, version };
}

/** Validate a (possibly partial) override on top of the defaults. Throws a readable error if invalid. */
export function buildScoringConfig(override: unknown = {}): ScoringConfig {
  if (!isObject(override)) throw new Error("Scoring config must be a JSON object");
  const parsed = scoringConfigSchema.safeParse(merge(DEFAULT_SCORING_CONFIG as unknown as Json, override));
  if (!parsed.success) {
    throw new Error(`Invalid scoring config: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return withVersion(parsed.data);
}

/**
 * Load the active config: the defaults, plus an optional JSON override file named by SCORING_CONFIG_PATH.
 * A bad override fails loudly instead of silently scoring with the wrong weights.
 */
export function loadScoringConfig(env: Record<string, string | undefined> = process.env): ScoringConfig {
  const path = env.SCORING_CONFIG_PATH;
  if (!path) return buildScoringConfig();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Cannot read SCORING_CONFIG_PATH: ${path}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`SCORING_CONFIG_PATH is not valid JSON: ${path}`);
  }
  return buildScoringConfig(json);
}

let active: ScoringConfig | undefined;

export function getScoringConfig(): ScoringConfig {
  active ??= loadScoringConfig();
  return active;
}

/** For tests: replace (or reset with undefined) the cached active config. */
export function setScoringConfig(config: ScoringConfig | undefined): void {
  active = config;
}
