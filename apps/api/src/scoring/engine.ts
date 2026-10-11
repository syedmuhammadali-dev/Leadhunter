import type { ScoringConfig } from "./config.js";

export type Priority = "HIGH" | "MEDIUM" | "LOW";

/** Observable facts about a business. Nothing here is a prediction. */
export interface ScoringInput {
  hasWebsite: boolean;
  websiteStatus: "NO_WEBSITE" | "ACTIVE" | "UNREACHABLE" | "ERROR" | "UNKNOWN";
  reviewCount: number | null;
  /** Latest audit, if any. */
  audit: { status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED"; issueTypes: string[] } | null;
}

export interface SignalResult {
  signal: string;
  label: string;
  weight: number;
  /** Whether the signal applies to this business. */
  matched: boolean;
  /** False when the signal could not be checked (for example, the website has not been audited yet). */
  evaluated: boolean;
}

export interface ScoreResult {
  score: number;
  maximumScore: number;
  priority: Priority;
  /** Human-readable reasons for the matched signals, e.g. "No website found (+5)". */
  reasons: string[];
  /** Every signal considered, matched or not, so the score can be fully explained. */
  signals: SignalResult[];
  /** Plain-language caveats such as "Website has not been audited yet". */
  notes: string[];
  configVersion: string;
}

const WEBSITE_SIGNALS = ["mobileProblems", "contactProblems", "noCta", "noWhatsapp", "missingSeo", "brokenLinks", "poorPerformance"] as const;

/** Highest score a business could reach under this config (website path vs. no-website path). */
export function maximumScore(config: ScoringConfig): number {
  const presence = Math.max(0, ...config.presence.map((p) => p.weight));
  const s = config.signals;
  const websitePath = WEBSITE_SIGNALS.reduce((sum, k) => sum + s[k].weight, 0);
  return Math.max(s.noWebsite.weight, s.websiteUnreachable.weight, websitePath) + presence;
}

export function priorityFor(score: number, config: ScoringConfig): Priority {
  if (score >= config.thresholds.high) return "HIGH";
  if (score >= config.thresholds.medium) return "MEDIUM";
  return "LOW";
}

/**
 * Compute the research-priority score. It ranks which businesses are worth looking at first,
 * based only on observable signals. It does not predict that anyone needs or will buy anything.
 */
export function scoreLead(input: ScoringInput, config: ScoringConfig): ScoreResult {
  const signals: SignalResult[] = [];
  const notes: string[] = [];
  const add = (signal: string, label: string, weight: number, matched: boolean, evaluated = true) =>
    signals.push({ signal, label, weight, matched, evaluated });

  const s = config.signals;
  const audit = input.audit;

  if (!input.hasWebsite) {
    add("noWebsite", s.noWebsite.label, s.noWebsite.weight, true);
  } else {
    add("noWebsite", s.noWebsite.label, s.noWebsite.weight, false);
    const unreachable = input.websiteStatus === "UNREACHABLE";
    add("websiteUnreachable", s.websiteUnreachable.label, s.websiteUnreachable.weight, unreachable);

    if (audit?.status === "COMPLETED") {
      const types = new Set(audit.issueTypes);
      for (const key of WEBSITE_SIGNALS) {
        const sig = s[key];
        add(key, sig.label, sig.weight, sig.issueTypes.some((t) => types.has(t)));
      }
    } else {
      for (const key of WEBSITE_SIGNALS) add(key, s[key].label, s[key].weight, false, false);
      if (unreachable) notes.push("The website could not be reached, so its content could not be checked.");
      else if (!audit) notes.push("The website has not been audited yet, so website signals are not counted.");
      else if (audit.status === "SKIPPED") notes.push("The website audit was skipped (robots.txt does not allow automated access), so website signals are not counted.");
      else if (audit.status === "FAILED") notes.push("The last website audit failed, so website signals are not counted.");
      else notes.push("A website audit is in progress, so website signals are not counted yet.");
    }
  }

  const reviews = input.reviewCount ?? 0;
  const tier = [...config.presence].filter((p) => reviews >= p.minReviews).sort((a, b) => b.minReviews - a.minReviews)[0];
  if (tier) add("presence", `${tier.label}: ${reviews} reviews`, tier.weight, true);

  const matched = signals.filter((x) => x.matched && x.weight > 0);
  const score = matched.reduce((sum, x) => sum + x.weight, 0);
  return {
    score,
    maximumScore: maximumScore(config),
    priority: priorityFor(score, config),
    reasons: matched.map((x) => `${x.label} (+${x.weight})`),
    signals,
    notes,
    configVersion: config.version,
  };
}
