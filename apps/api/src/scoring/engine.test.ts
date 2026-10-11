import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildScoringConfig, DEFAULT_SCORING_CONFIG, loadScoringConfig } from "./config.js";
import { maximumScore, priorityFor, scoreLead, type ScoringInput } from "./engine.js";

const config = buildScoringConfig();

const site = (issueTypes: string[], reviewCount: number | null = 0): ScoringInput => ({
  hasWebsite: true,
  websiteStatus: "ACTIVE",
  reviewCount,
  audit: { status: "COMPLETED", issueTypes },
});

const noSite = (reviewCount: number | null = 0): ScoringInput => ({ hasWebsite: false, websiteStatus: "NO_WEBSITE", reviewCount, audit: null });

describe("scoring config", () => {
  it("has a stable short version and a computed maximum", () => {
    expect(config.version).toMatch(/^[0-9a-f]{8}$/);
    expect(buildScoringConfig().version).toBe(config.version);
    // 3+2+2+2+2+2+2 website signals + 2 for the top presence tier
    expect(maximumScore(config)).toBe(17);
  });

  it("changes version and score when weights are overridden, keeping other defaults", () => {
    const custom = buildScoringConfig({ signals: { noWebsite: { weight: 9 } } });
    expect(custom.version).not.toBe(config.version);
    expect(custom.signals.noWebsite).toEqual({ label: "No website found", weight: 9 });
    expect(custom.signals.noCta.weight).toBe(2);
    expect(scoreLead(noSite(), custom).score).toBe(9);
    expect(scoreLead(noSite(), config).score).toBe(5);
  });

  it.each([
    [{ signals: { noWebsite: { weight: 99 } } }],
    [{ signals: { noWebsite: { weight: -1 } } }],
    [{ signals: { noCta: { issueTypes: [] } } }],
    [{ thresholds: { high: 3, medium: 3 } }],
    [{ presence: [{ minReviews: 0, weight: 1, label: "x" }] }],
    ["nope"],
  ])("rejects an invalid override %#", (override) => {
    expect(() => buildScoringConfig(override)).toThrow();
  });

  it("loads an override file from SCORING_CONFIG_PATH and fails loudly on bad files", () => {
    const dir = mkdtempSync(join(tmpdir(), "lh-scoring-"));
    try {
      const good = join(dir, "good.json");
      writeFileSync(good, JSON.stringify({ thresholds: { high: 8, medium: 4 } }));
      expect(loadScoringConfig({ SCORING_CONFIG_PATH: good }).thresholds).toEqual({ high: 8, medium: 4 });
      expect(loadScoringConfig({}).version).toBe(config.version);

      const bad = join(dir, "bad.json");
      writeFileSync(bad, "{ not json");
      expect(() => loadScoringConfig({ SCORING_CONFIG_PATH: bad })).toThrow(/not valid JSON/);
      expect(() => loadScoringConfig({ SCORING_CONFIG_PATH: join(dir, "missing.json") })).toThrow(/Cannot read/);
      const wrong = join(dir, "wrong.json");
      writeFileSync(wrong, JSON.stringify({ thresholds: { high: 1, medium: 5 } }));
      expect(() => loadScoringConfig({ SCORING_CONFIG_PATH: wrong })).toThrow(/Invalid scoring config/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scoreLead: no website", () => {
  it("adds only the no-website signal and explains it", () => {
    const r = scoreLead(noSite(), config);
    expect(r).toMatchObject({ score: 5, maximumScore: 17, priority: "MEDIUM", reasons: ["No website found (+5)"], notes: [] });
    expect(r.signals.find((s) => s.signal === "noWebsite")).toMatchObject({ matched: true, evaluated: true, weight: 5 });
    expect(r.configVersion).toBe(config.version);
  });

  it("combines with public presence and crosses the high threshold", () => {
    expect(scoreLead(noSite(99), config).score).toBe(5);
    expect(scoreLead(noSite(100), config)).toMatchObject({ score: 6, priority: "HIGH" });
    expect(scoreLead(noSite(500), config)).toMatchObject({ score: 7, priority: "HIGH" });
    expect(scoreLead(noSite(500), config).reasons).toEqual(["No website found (+5)", "Strong public presence: 500 reviews (+2)"]);
  });
});

describe("scoreLead: website with a completed audit", () => {
  it("scores 0 and LOW when nothing is wrong", () => {
    expect(scoreLead(site([]), config)).toMatchObject({ score: 0, priority: "LOW", reasons: [] });
  });

  it.each([
    ["mobileProblems", "missing-viewport", 3],
    ["mobileProblems", "viewport-not-responsive", 3],
    ["contactProblems", "no-contact-info", 2],
    ["contactProblems", "no-contact-page-or-form", 2],
    ["noCta", "no-cta", 2],
    ["noWhatsapp", "no-whatsapp", 2],
    ["missingSeo", "missing-title", 2],
    ["missingSeo", "missing-meta-description", 2],
    ["missingSeo", "missing-canonical", 2],
    ["brokenLinks", "broken-links", 2],
    ["poorPerformance", "slow-performance", 2],
    ["poorPerformance", "large-images", 2],
  ])("%s fires on audit issue %s (+%i)", (signal, issue, weight) => {
    const r = scoreLead(site([issue as string]), config);
    expect(r.score).toBe(weight);
    expect(r.signals.find((s) => s.signal === signal)).toMatchObject({ matched: true, weight });
  });

  it("counts each signal once even if several of its issue types appear", () => {
    expect(scoreLead(site(["missing-title", "missing-meta-description", "missing-canonical"]), config).score).toBe(2);
    expect(scoreLead(site(["missing-viewport", "viewport-not-responsive"]), config).score).toBe(3);
  });

  it("ignores audit issues that are not scoring signals", () => {
    expect(scoreLead(site(["no-https", "no-sitemap", "heading-structure"]), config).score).toBe(0);
  });

  it("reaches the maximum when everything is wrong and the business has many reviews", () => {
    const all = ["missing-viewport", "no-contact-info", "no-cta", "no-whatsapp", "missing-title", "broken-links", "slow-performance"];
    const r = scoreLead(site(all, 1000), config);
    expect(r.score).toBe(r.maximumScore);
    expect(r.priority).toBe("HIGH");
    expect(r.reasons).toHaveLength(8);
  });
});

describe("scoreLead: website that cannot be scored from an audit", () => {
  it("does not penalize a website that has not been audited, and says so", () => {
    const r = scoreLead({ hasWebsite: true, websiteStatus: "UNKNOWN", reviewCount: 10, audit: null }, config);
    expect(r.score).toBe(0);
    expect(r.notes[0]).toMatch(/not been audited/);
    const unevaluated = r.signals.filter((s) => !s.evaluated).map((s) => s.signal);
    expect(unevaluated).toContain("mobileProblems");
    expect(unevaluated).not.toContain("noWebsite");
  });

  it("adds the unreachable signal when the website could not be reached", () => {
    const r = scoreLead({ hasWebsite: true, websiteStatus: "UNREACHABLE", reviewCount: 0, audit: { status: "FAILED", issueTypes: [] } }, config);
    expect(r).toMatchObject({ score: 3, reasons: ["Website could not be reached (+3)"] });
    expect(r.notes[0]).toMatch(/could not be reached/);
  });

  it.each([
    ["SKIPPED", /skipped/],
    ["FAILED", /failed/],
    ["RUNNING", /in progress/],
    ["PENDING", /in progress/],
  ] as const)("explains a %s audit without adding points", (status, pattern) => {
    const r = scoreLead({ hasWebsite: true, websiteStatus: "ERROR", reviewCount: 0, audit: { status, issueTypes: ["no-cta"] } }, config);
    expect(r.score).toBe(0);
    expect(r.notes[0]).toMatch(pattern);
  });
});

describe("priorities and wording", () => {
  it("maps scores to priorities at the configured thresholds", () => {
    expect([0, 2, 3, 5, 6, 17].map((n) => priorityFor(n, config))).toEqual(["LOW", "LOW", "MEDIUM", "MEDIUM", "HIGH", "HIGH"]);
    const strict = buildScoringConfig({ thresholds: { high: 10, medium: 5 } });
    expect(priorityFor(9, strict)).toBe("MEDIUM");
  });

  it("never uses buying-intent language in labels, reasons or notes", () => {
    const forbidden = /guarantee|likely buyer|will buy|definitely|needs? a (new )?website|hot lead|ready to buy/i;
    const everything = [
      ...Object.values(DEFAULT_SCORING_CONFIG.signals).map((s) => s.label),
      ...DEFAULT_SCORING_CONFIG.presence.map((p) => p.label),
      ...scoreLead(noSite(900), config).reasons,
      ...scoreLead({ hasWebsite: true, websiteStatus: "UNKNOWN", reviewCount: 0, audit: null }, config).notes,
    ];
    for (const text of everything) expect(text).not.toMatch(forbidden);
  });

  it("leaves zero-weight signals out of the reasons", () => {
    const custom = buildScoringConfig({ signals: { noWebsite: { weight: 0 } } });
    expect(scoreLead(noSite(), custom)).toMatchObject({ score: 0, reasons: [] });
  });
});
