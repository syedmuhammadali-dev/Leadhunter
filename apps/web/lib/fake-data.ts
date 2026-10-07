import type { Audit, AuditIssue, Lead, LeadStatus, Priority, ScoreSignal, SearchHistoryItem } from "./types";

// Everything in this file is FAKE development data (Phase 3). Real data arrives via the API in later phases.

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261007);
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;

export const LOCATIONS = [
  { country: "United Arab Emirates", city: "Dubai" },
  { country: "United Arab Emirates", city: "Abu Dhabi" },
  { country: "Pakistan", city: "Karachi" },
  { country: "Pakistan", city: "Lahore" },
  { country: "United Kingdom", city: "London" },
  { country: "Saudi Arabia", city: "Riyadh" },
] as const;

export const CATEGORIES = ["Restaurant", "Cafe", "Dentist", "Gym", "Bakery", "Salon", "Law Firm", "Clinic"] as const;

const NAME_A = ["Al Noor", "Golden", "Royal", "Sunrise", "Blue Pearl", "Urban", "Oasis", "Capital", "Green Leaf", "Silver", "Heritage", "Pearl"];
const NAME_B: Record<string, string[]> = {
  Restaurant: ["Grill", "Kitchen", "Bistro", "Tandoor"],
  Cafe: ["Cafe", "Coffee House", "Roasters"],
  Dentist: ["Dental Care", "Smile Clinic", "Dental Studio"],
  Gym: ["Fitness", "Gym", "Fit Hub"],
  Bakery: ["Bakery", "Bakehouse", "Patisserie"],
  Salon: ["Salon", "Beauty Lounge", "Hair Studio"],
  "Law Firm": ["Legal", "Law Associates", "Advocates"],
  Clinic: ["Medical Center", "Family Clinic", "Health Clinic"],
};

const STATUSES: LeadStatus[] = ["NEW", "NEW", "NEW", "RESEARCHED", "RESEARCHED", "CONTACTED", "REPLIED", "FOLLOW_UP", "LOST"];

interface Rule {
  type: string;
  severity: AuditIssue["severity"];
  title: string;
  explanation: string;
  evidence?: string;
  points: number;
  problem: string;
  signal: ScoreSignal;
}

const RULES: Rule[] = [
  { type: "missing-viewport", severity: "HIGH", title: "No mobile viewport tag", explanation: "Without a viewport meta tag the page may not display well on phones.", points: 15, problem: "Mobile problems", signal: { label: "Website has major mobile problems", weight: 3 } },
  { type: "missing-contact", severity: "MEDIUM", title: "Contact details hard to find", explanation: "No phone number, email or contact page was detected on the homepage.", points: 10, problem: "Contact problems", signal: { label: "Important contact problems", weight: 2 } },
  { type: "no-cta", severity: "MEDIUM", title: "No clear call to action", explanation: "No booking or contact button was detected near the top of the homepage.", points: 8, problem: "No clear CTA", signal: { label: "No clear CTA", weight: 2 } },
  { type: "no-whatsapp", severity: "LOW", title: "No WhatsApp link", explanation: "No WhatsApp link or contact option was found.", points: 4, problem: "No WhatsApp", signal: { label: "No WhatsApp/contact option", weight: 2 } },
  { type: "missing-meta-description", severity: "LOW", title: "Missing meta description", explanation: "No meta description found; search results may show poor snippets.", points: 5, problem: "Missing SEO basics", signal: { label: "Missing basic SEO elements", weight: 2 } },
  { type: "broken-link", severity: "MEDIUM", title: "Broken internal link", explanation: "A link on the homepage returned HTTP 404.", evidence: "/old-page -> 404", points: 6, problem: "Broken links", signal: { label: "Broken links", weight: 2 } },
  { type: "slow-page", severity: "MEDIUM", title: "Large images slow the page", explanation: "Several images are much larger than needed for display.", evidence: "hero image ~3 MB", points: 8, problem: "Slow performance", signal: { label: "Poor performance", weight: 2 } },
];

function priorityFor(score: number): Priority {
  return score >= 7 ? "HIGH" : score >= 4 ? "MEDIUM" : "LOW";
}

function buildLead(i: number): Lead {
  // The first 12 leads are Dubai restaurants so the default search form example always has results.
  const randomLoc = pick(LOCATIONS);
  const randomCategory = pick(CATEGORIES);
  const loc = i < 12 ? LOCATIONS[0] : randomLoc;
  const category = i < 12 ? "Restaurant" : randomCategory;
  const name = `${pick(NAME_A)} ${pick(NAME_B[category]!)}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const reviewCount = Math.floor(rand() * rand() * 1500) + 5;
  const rating = Math.round((3.4 + rand() * 1.6) * 10) / 10;
  const roll = rand();
  const hasWebsite = roll > 0.22;
  const unreachable = hasWebsite && roll < 0.27;
  const website = hasWebsite ? `https://${slug}${i}.example` : null;

  const signals: ScoreSignal[] = [];
  const issues: AuditIssue[] = [];
  const problems: string[] = [];

  if (!hasWebsite) {
    signals.push({ label: "No website found", weight: 5 });
    problems.push("No website");
  } else if (unreachable) {
    signals.push({ label: "Website unreachable", weight: 3 });
    problems.push("Website unreachable");
  } else {
    for (const r of RULES) {
      if (rand() < 0.28) {
        issues.push({ type: r.type, severity: r.severity, title: r.title, explanation: r.explanation, evidence: r.evidence, pointsDeducted: r.points });
        signals.push(r.signal);
        problems.push(r.problem);
      }
    }
  }
  if (reviewCount >= 500) signals.push({ label: `Strong public presence: ${reviewCount} reviews`, weight: 2 });
  else if (reviewCount >= 100) signals.push({ label: `Solid public presence: ${reviewCount} reviews`, weight: 1 });

  const score = signals.reduce((s, x) => s + x.weight, 0);
  const audit: Audit | null =
    hasWebsite && !unreachable
      ? {
          url: website!,
          httpStatus: 200,
          usesHttps: true,
          websiteScore: Math.max(0, 100 - issues.reduce((s, x) => s + x.pointsDeducted, 0)),
          issues,
          auditedAt: "2026-10-05T10:30:00Z",
        }
      : null;

  return {
    id: `lead-${String(i + 1).padStart(3, "0")}`,
    name, category, country: loc.country, city: loc.city,
    address: `${Math.floor(rand() * 90) + 1} Main Street, ${loc.city}`,
    website,
    phone: `+${Math.floor(rand() * 90) + 10} ${Math.floor(rand() * 900000000) + 100000000}`,
    rating, reviewCount,
    websiteStatus: !hasWebsite ? "NO_WEBSITE" : unreachable ? "UNREACHABLE" : "ACTIVE",
    score, maxScore: 20, priority: priorityFor(score), signals, problems,
    status: pick(STATUSES), audit, source: "mock",
    researchedAt: "2026-10-05T10:30:00Z",
  };
}

export const LEADS: Lead[] = Array.from({ length: 64 }, (_, i) => buildLead(i));

export const HISTORY: SearchHistoryItem[] = [
  { id: "job-006", country: "United Arab Emirates", city: "Dubai", category: "Restaurant", maxResults: 50, status: "COMPLETED", businessesFound: 50, websitesFound: 39, auditsCompleted: 39, highPriority: 14, createdAt: "2026-10-05T10:12:00Z" },
  { id: "job-005", country: "Pakistan", city: "Lahore", category: "Gym", maxResults: 30, status: "COMPLETED", businessesFound: 27, websitesFound: 15, auditsCompleted: 15, highPriority: 11, createdAt: "2026-10-04T16:40:00Z" },
  { id: "job-004", country: "United Kingdom", city: "London", category: "Bakery", maxResults: 25, status: "COMPLETED", businessesFound: 25, websitesFound: 24, auditsCompleted: 24, highPriority: 4, createdAt: "2026-10-03T09:05:00Z" },
  { id: "job-003", country: "Pakistan", city: "Karachi", category: "Dentist", maxResults: 40, status: "FAILED", businessesFound: 0, websitesFound: 0, auditsCompleted: 0, highPriority: 0, createdAt: "2026-10-02T13:22:00Z" },
  { id: "job-002", country: "Saudi Arabia", city: "Riyadh", category: "Cafe", maxResults: 20, status: "COMPLETED", businessesFound: 20, websitesFound: 16, auditsCompleted: 16, highPriority: 5, createdAt: "2026-10-01T11:48:00Z" },
  { id: "job-001", country: "United Arab Emirates", city: "Abu Dhabi", category: "Salon", maxResults: 15, status: "COMPLETED", businessesFound: 15, websitesFound: 10, auditsCompleted: 10, highPriority: 6, createdAt: "2026-09-30T08:30:00Z" },
];

/** Default weights shown on the Settings page (read-only for now; configurable in Phase 6). */
export const SCORING_WEIGHTS = [
  { label: "No website", weight: 5 },
  { label: "Major mobile problems", weight: 3 },
  { label: "Important contact problems", weight: 2 },
  { label: "No clear CTA", weight: 2 },
  { label: "No WhatsApp/contact option", weight: 2 },
  { label: "Missing basic SEO elements", weight: 2 },
  { label: "Broken links", weight: 2 },
  { label: "Poor performance", weight: 2 },
  { label: "Strong public presence (reviews)", weight: 2 },
];
