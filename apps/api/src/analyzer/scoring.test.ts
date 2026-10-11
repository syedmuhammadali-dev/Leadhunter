import { describe, expect, it } from "vitest";
import type { PageSignals } from "./html-analyzer.js";
import { AUDIT_RULES, scoreAudit, type AuditObservation, type RuleId } from "./scoring.js";

const goodPage = (): PageSignals => ({
  title: "Acme", metaDescription: "desc", hasViewport: true, viewportResponsive: true, canonicalUrl: "https://a.example/",
  lang: "en", headingCount: 3, h1Count: 1, headingLevelSkipped: false, hasNav: true,
  images: { total: 4, missingAlt: 0, sampleUrls: [] }, internalLinks: [], externalLinkCount: 2,
  phones: ["+1 555 0100"], emails: ["a@a.example"], whatsappLinks: ["https://wa.me/1"], contactPageUrl: "https://a.example/contact",
  hasContactForm: true, mapsLink: "https://www.google.com/maps/x", socialLinks: [{ platform: "facebook", url: "https://facebook.com/a" }],
  bookingLink: "https://a.example/book", hasServicesInfo: true, hasPricing: true, ctaTexts: ["Book now"],
  accessibility: { unlabeledInputs: 0, emptyLinks: 0 }, textLength: 1500,
});

const perfect = (): AuditObservation => ({
  requestedUrl: "https://a.example/", finalUrl: "https://a.example/", httpStatus: 200, usesHttps: true, redirectCount: 0,
  page: goodPage(), robotsTxtFound: true, sitemapFound: true, brokenLinks: [], linksChecked: 5, largeImages: [], imagesChecked: 4,
  performance: { provider: "pagespeed", score: 95 },
});

describe("scoreAudit", () => {
  it("gives a perfect site 100 with no issues", () => {
    const r = scoreAudit(perfect());
    expect(r).toMatchObject({ score: 100, issues: [], breakdown: [] });
  });

  const cases: [RuleId, (o: AuditObservation) => void][] = [
    ["http-error", (o) => { o.httpStatus = 503; }],
    ["no-https", (o) => { o.usesHttps = false; }],
    ["many-redirects", (o) => { o.redirectCount = 4; }],
    ["missing-title", (o) => { o.page!.title = null; }],
    ["missing-meta-description", (o) => { o.page!.metaDescription = null; }],
    ["missing-viewport", (o) => { o.page!.hasViewport = false; o.page!.viewportResponsive = false; }],
    ["viewport-not-responsive", (o) => { o.page!.viewportResponsive = false; }],
    ["missing-canonical", (o) => { o.page!.canonicalUrl = null; }],
    ["no-robots-txt", (o) => { o.robotsTxtFound = false; }],
    ["no-sitemap", (o) => { o.sitemapFound = false; }],
    ["no-contact-info", (o) => { Object.assign(o.page!, { phones: [], emails: [], whatsappLinks: [] }); }],
    ["no-contact-page-or-form", (o) => { Object.assign(o.page!, { contactPageUrl: null, hasContactForm: false }); }],
    ["no-whatsapp", (o) => { o.page!.whatsappLinks = []; }],
    ["no-maps-link", (o) => { o.page!.mapsLink = null; }],
    ["no-social-links", (o) => { o.page!.socialLinks = []; }],
    ["no-booking-link", (o) => { o.page!.bookingLink = null; }],
    ["no-services-info", (o) => { o.page!.hasServicesInfo = false; }],
    ["no-cta", (o) => { o.page!.ctaTexts = []; }],
    ["no-navigation", (o) => { o.page!.hasNav = false; }],
    ["heading-structure", (o) => { o.page!.h1Count = 2; }],
    ["missing-lang", (o) => { o.page!.lang = null; }],
    ["unlabeled-inputs", (o) => { o.page!.accessibility.unlabeledInputs = 2; }],
    ["empty-links", (o) => { o.page!.accessibility.emptyLinks = 1; }],
    ["thin-content", (o) => { o.page!.textLength = 50; }],
    ["large-images", (o) => { o.largeImages = [{ url: "https://a.example/h.jpg", bytes: 3_000_000 }]; }],
    ["slow-performance", (o) => { o.performance = { provider: "pagespeed", score: 30 }; }],
    ["mediocre-performance", (o) => { o.performance = { provider: "pagespeed", score: 60 }; }],
  ];

  it.each(cases)("deducts the configured points for %s", (rule, mutate) => {
    const obs = perfect();
    mutate(obs);
    const r = scoreAudit(obs);
    const issue = r.issues.find((i) => i.type === rule);
    expect(issue, `expected issue ${rule}`).toBeDefined();
    expect(issue!.pointsDeducted).toBe(AUDIT_RULES[rule].points);
    expect(issue!.severity).toBe(AUDIT_RULES[rule].severity);
    expect(issue!.title.length).toBeGreaterThan(5);
    expect(issue!.explanation.length).toBeGreaterThan(10);
    expect(r.score).toBe(100 - r.issues.reduce((s, i) => s + i.pointsDeducted, 0));
    expect(r.breakdown).toContainEqual({ rule, points: -AUDIT_RULES[rule].points, reason: issue!.title });
  });

  it("caps broken-link points and scales alt-text points by how many images are affected", () => {
    const a = perfect();
    a.brokenLinks = Array.from({ length: 6 }, (_, i) => ({ url: `https://a.example/${i}`, status: 404 }));
    const broken = scoreAudit(a).issues.find((i) => i.type === "broken-links")!;
    expect(broken.pointsDeducted).toBe(9);
    expect(broken.evidence).toContain("404");

    const b = perfect();
    b.page!.images = { total: 10, missingAlt: 1, sampleUrls: [] };
    expect(scoreAudit(b).issues.find((i) => i.type === "images-missing-alt")!.pointsDeducted).toBe(1);
    b.page!.images = { total: 10, missingAlt: 10, sampleUrls: [] };
    expect(scoreAudit(b).issues.find((i) => i.type === "images-missing-alt")!.pointsDeducted).toBe(5);
  });

  it("never goes below 0 and explains every deduction", () => {
    const terrible = perfect();
    terrible.httpStatus = 500;
    terrible.usesHttps = false;
    terrible.page = { ...goodPage(), title: null, metaDescription: null, hasViewport: false, viewportResponsive: false, phones: [], emails: [], whatsappLinks: [], ctaTexts: [], hasNav: false, hasServicesInfo: false, textLength: 10 };
    terrible.robotsTxtFound = false;
    terrible.sitemapFound = false;
    const r = scoreAudit(terrible);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.breakdown.length).toBe(r.issues.length);
    expect(new Set(r.issues.map((i) => i.type)).size).toBe(r.issues.length);
  });

  it("flags non-HTML responses and skips page rules", () => {
    const o = perfect();
    o.page = null;
    const r = scoreAudit(o);
    expect(r.issues.map((i) => i.type)).toEqual(["not-html"]);
  });

  it("does not add not-html on top of an HTTP error", () => {
    const o = perfect();
    o.page = null;
    o.httpStatus = 404;
    expect(scoreAudit(o).issues.map((i) => i.type)).toEqual(["http-error"]);
  });
});
