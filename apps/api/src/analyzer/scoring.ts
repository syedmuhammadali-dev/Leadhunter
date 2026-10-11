import type { PageSignals } from "./html-analyzer.js";

export type Severity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Everything the audit observed about one website. Scoring only reads this. */
export interface AuditObservation {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  usesHttps: boolean;
  redirectCount: number;
  /** null when the response was not HTML or could not be parsed. */
  page: PageSignals | null;
  robotsTxtFound: boolean;
  sitemapFound: boolean;
  brokenLinks: { url: string; status: number }[];
  linksChecked: number;
  largeImages: { url: string; bytes: number }[];
  imagesChecked: number;
  /** Optional PageSpeed-style score 0-100 from a pluggable provider. */
  performance: { provider: string; score: number } | null;
}

export interface IssueDraft {
  type: string;
  severity: Severity;
  title: string;
  explanation: string;
  evidence?: string;
  pointsDeducted: number;
}

export interface BreakdownEntry {
  rule: string;
  points: number;
  reason: string;
}

export interface AuditScore {
  /** 0-100. Starts at 100 and loses the points of every issue. */
  score: number;
  issues: IssueDraft[];
  breakdown: BreakdownEntry[];
}

/** Severity and points per rule. Change numbers here to retune scoring; nothing else is hardcoded. */
export const AUDIT_RULES = {
  "http-error": { severity: "CRITICAL", points: 40 },
  "not-html": { severity: "HIGH", points: 25 },
  "no-https": { severity: "HIGH", points: 15 },
  "many-redirects": { severity: "LOW", points: 3 },
  "missing-title": { severity: "HIGH", points: 8 },
  "missing-meta-description": { severity: "MEDIUM", points: 6 },
  "missing-viewport": { severity: "HIGH", points: 12 },
  "viewport-not-responsive": { severity: "MEDIUM", points: 6 },
  "missing-canonical": { severity: "LOW", points: 2 },
  "no-robots-txt": { severity: "LOW", points: 2 },
  "no-sitemap": { severity: "LOW", points: 2 },
  "broken-links": { severity: "MEDIUM", points: 3, max: 9 },
  "no-contact-info": { severity: "HIGH", points: 10 },
  "no-contact-page-or-form": { severity: "MEDIUM", points: 5 },
  "no-whatsapp": { severity: "LOW", points: 3 },
  "no-maps-link": { severity: "LOW", points: 2 },
  "no-social-links": { severity: "LOW", points: 2 },
  "no-booking-link": { severity: "LOW", points: 2 },
  "no-services-info": { severity: "MEDIUM", points: 5 },
  "no-cta": { severity: "MEDIUM", points: 8 },
  "no-navigation": { severity: "MEDIUM", points: 4 },
  "heading-structure": { severity: "LOW", points: 3 },
  "images-missing-alt": { severity: "LOW", points: 5 },
  "large-images": { severity: "MEDIUM", points: 5 },
  "missing-lang": { severity: "LOW", points: 2 },
  "unlabeled-inputs": { severity: "LOW", points: 2 },
  "empty-links": { severity: "LOW", points: 2 },
  "thin-content": { severity: "MEDIUM", points: 5 },
  "slow-performance": { severity: "MEDIUM", points: 8 },
  "mediocre-performance": { severity: "LOW", points: 4 },
} as const satisfies Record<string, { severity: Severity; points: number; max?: number }>;

export type RuleId = keyof typeof AUDIT_RULES;

export const LARGE_IMAGE_BYTES = 500 * 1024;

function issue(rule: RuleId, title: string, explanation: string, evidence?: string, points?: number): IssueDraft {
  const cfg = AUDIT_RULES[rule];
  return { type: rule, severity: cfg.severity, title, explanation, evidence, pointsDeducted: points ?? cfg.points };
}

export function scoreAudit(obs: AuditObservation): AuditScore {
  const issues: IssueDraft[] = [];
  const add = (i: IssueDraft | null) => {
    if (i) issues.push(i);
  };

  if (obs.httpStatus >= 400) {
    add(issue("http-error", `Homepage returned HTTP ${obs.httpStatus}`, "The homepage did not load successfully, so visitors and search engines may not be able to use it.", `HTTP ${obs.httpStatus} at ${obs.finalUrl}`));
  }
  if (!obs.usesHttps) {
    add(issue("no-https", "Site is not served over HTTPS", "The homepage loads over plain HTTP. Browsers may warn visitors and search engines favour HTTPS.", obs.finalUrl));
  }
  if (obs.redirectCount >= 4) {
    add(issue("many-redirects", "Many redirects before the homepage loads", "Long redirect chains slow the first visit down.", `${obs.redirectCount} redirects`));
  }

  const p = obs.page;
  if (!p) {
    if (obs.httpStatus < 400) add(issue("not-html", "Homepage is not an HTML page", "The URL did not return an HTML document, so the page could not be analysed.", obs.finalUrl));
  } else {
    if (!p.title) add(issue("missing-title", "Missing page title", "The page has no <title>. It is the main headline shown in search results and browser tabs."));
    if (!p.metaDescription) add(issue("missing-meta-description", "Missing meta description", "No meta description was found, so search engines pick their own snippet."));
    if (!p.hasViewport) {
      add(issue("missing-viewport", "No mobile viewport tag", "Without a viewport meta tag the page may not display properly on phones."));
    } else if (!p.viewportResponsive) {
      add(issue("viewport-not-responsive", "Viewport tag is not responsive", "The viewport tag does not use width=device-width, so layout may not adapt to phones."));
    }
    if (!p.canonicalUrl) add(issue("missing-canonical", "No canonical link", "A canonical URL helps search engines avoid duplicate pages."));

    if (p.phones.length === 0 && p.emails.length === 0 && p.whatsappLinks.length === 0) {
      add(issue("no-contact-info", "No phone, email or WhatsApp found on the homepage", "Visitors cannot quickly see how to reach the business."));
    }
    if (!p.contactPageUrl && !p.hasContactForm) {
      add(issue("no-contact-page-or-form", "No contact page or contact form found", "No link to a contact page and no contact form were detected."));
    }
    if (p.whatsappLinks.length === 0) add(issue("no-whatsapp", "No WhatsApp link", "No WhatsApp link or chat button was detected."));
    if (!p.mapsLink) add(issue("no-maps-link", "No Google Maps link", "No map link or map embed was detected, which makes finding the location harder."));
    if (p.socialLinks.length === 0) add(issue("no-social-links", "No social media links", "No links to the business's social profiles were found."));
    if (!p.bookingLink) add(issue("no-booking-link", "No booking or ordering link", "No booking, reservation or ordering link was detected."));
    if (!p.hasServicesInfo) add(issue("no-services-info", "No clear services or menu information", "The homepage does not clearly point to services, products or a menu."));
    if (p.ctaTexts.length === 0) add(issue("no-cta", "No clear call to action", "No button or link such as Book, Call, Contact or Order was detected."));
    if (!p.hasNav) add(issue("no-navigation", "No obvious navigation menu", "No navigation with several links was detected."));
    if (p.h1Count !== 1 || p.headingLevelSkipped) {
      add(issue("heading-structure", "Heading structure could be clearer", "A page should normally have exactly one H1, and heading levels should not skip.", `${p.h1Count} H1 heading(s)${p.headingLevelSkipped ? ", a heading level is skipped" : ""}`));
    }
    if (p.images.total > 0 && p.images.missingAlt > 0) {
      const ratio = p.images.missingAlt / p.images.total;
      const points = Math.max(1, Math.round(ratio * AUDIT_RULES["images-missing-alt"].points));
      add(issue("images-missing-alt", "Images missing alt text", "Alt text helps screen-reader users and search engines understand images.", `${p.images.missingAlt} of ${p.images.total} images`, points));
    }
    if (!p.lang) add(issue("missing-lang", "Page language not declared", "The <html> tag has no lang attribute, which screen readers and translators rely on."));
    if (p.accessibility.unlabeledInputs > 0) {
      add(issue("unlabeled-inputs", "Form fields without labels", "Some form fields have no label or aria-label.", `${p.accessibility.unlabeledInputs} field(s)`));
    }
    if (p.accessibility.emptyLinks > 0) {
      add(issue("empty-links", "Links without text", "Some links have no text or accessible name.", `${p.accessibility.emptyLinks} link(s)`));
    }
    if (p.textLength < 200) add(issue("thin-content", "Very little text on the homepage", "The homepage has very little readable text.", `${p.textLength} characters`));
  }

  if (!obs.robotsTxtFound) add(issue("no-robots-txt", "No robots.txt", "No robots.txt file was found."));
  if (!obs.sitemapFound) add(issue("no-sitemap", "No sitemap", "No sitemap.xml was found, which makes it harder for search engines to discover pages."));

  if (obs.brokenLinks.length > 0) {
    const cfg = AUDIT_RULES["broken-links"];
    const points = Math.min(cfg.max, obs.brokenLinks.length * cfg.points);
    add(issue("broken-links", "Broken links found", "Some internal links returned an error.", obs.brokenLinks.slice(0, 5).map((l) => `${l.url} -> ${l.status}`).join("; "), points));
  }
  if (obs.largeImages.length > 0) {
    add(issue("large-images", "Very large images", `Images over ${Math.round(LARGE_IMAGE_BYTES / 1024)} KB slow down loading, especially on mobile.`, obs.largeImages.slice(0, 3).map((i) => `${i.url} (${Math.round(i.bytes / 1024)} KB)`).join("; ")));
  }
  if (obs.performance) {
    const s = obs.performance.score;
    if (s < 50) add(issue("slow-performance", "Slow page performance", `The ${obs.performance.provider} performance score is low.`, `Performance score ${s}/100`));
    else if (s < 75) add(issue("mediocre-performance", "Page performance could be better", `The ${obs.performance.provider} performance score is moderate.`, `Performance score ${s}/100`));
  }

  const total = issues.reduce((sum, i) => sum + i.pointsDeducted, 0);
  return {
    score: Math.max(0, 100 - total),
    issues,
    breakdown: issues.map((i) => ({ rule: i.type, points: -i.pointsDeducted, reason: i.title })),
  };
}
