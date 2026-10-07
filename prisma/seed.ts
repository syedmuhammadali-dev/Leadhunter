import { PrismaClient, type ContactType, type IssueSeverity, type PriorityLevel } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildDedupeKey, normalizeName, websiteDomain } from "@leadhunter/shared";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL }),
});

interface SeedIssue {
  type: string;
  severity: IssueSeverity;
  title: string;
  explanation: string;
  evidence?: string;
  points: number;
}

interface SeedBusiness {
  sourceId: string;
  name: string;
  category: string;
  country: string;
  city: string;
  address?: string;
  website?: string;
  phone?: string;
  email?: string;
  rating?: number;
  reviews?: number;
  socials?: { type: ContactType; value: string }[];
  issues?: SeedIssue[];
  score?: number;
  priority?: PriorityLevel;
  reasons?: string[];
}

// All businesses below are FAKE. Domains use the reserved .example TLD.
const businesses: SeedBusiness[] = [
  {
    sourceId: "seed-001", name: "Al Noor Grill", category: "Restaurant", country: "United Arab Emirates", city: "Dubai",
    address: "Street 12, Al Karama, Dubai", phone: "+971 4 000 0001", rating: 4.5, reviews: 812,
    socials: [{ type: "INSTAGRAM", value: "https://instagram.com/alnoorgrill.example" }],
    score: 7, priority: "HIGH", reasons: ["No website found (+5)", "Strong public presence: 812 reviews (+2)"],
  },
  {
    sourceId: "seed-002", name: "Marina Bites", category: "Restaurant", country: "United Arab Emirates", city: "Dubai",
    address: "Marina Walk, Dubai", website: "http://marinabites.example", phone: "+971 4 000 0002", email: "hello@marinabites.example", rating: 4.2, reviews: 340,
    issues: [
      { type: "no-https", severity: "HIGH", title: "Site is not served over HTTPS", explanation: "The homepage loads over plain HTTP.", evidence: "http://marinabites.example", points: 15 },
      { type: "missing-viewport", severity: "HIGH", title: "No mobile viewport tag", explanation: "Without a viewport meta tag the page may not display well on phones.", points: 15 },
      { type: "no-cta", severity: "MEDIUM", title: "No clear call to action", explanation: "No booking or contact button was detected on the homepage.", points: 8 },
    ],
    score: 5, priority: "HIGH", reasons: ["Website has major mobile problems (+3)", "No clear CTA (+2)"],
  },
  {
    sourceId: "seed-003", name: "Desert Rose Cafe", category: "Cafe", country: "United Arab Emirates", city: "Dubai",
    website: "https://desertrosecafe.example", phone: "+971 4 000 0003", rating: 4.7, reviews: 1204,
    issues: [
      { type: "missing-meta-description", severity: "LOW", title: "Missing meta description", explanation: "No meta description found; search results may show poor snippets.", points: 5 },
    ],
    score: 3, priority: "MEDIUM", reasons: ["Missing basic SEO elements (+2)", "Strong public presence: 1204 reviews (+1)"],
  },
  {
    sourceId: "seed-004", name: "Karachi Dental Care", category: "Dentist", country: "Pakistan", city: "Karachi",
    address: "Clifton Block 5, Karachi", website: "https://karachidental.example", phone: "+92 21 0000 0004", email: "info@karachidental.example", rating: 4.8, reviews: 96,
    socials: [{ type: "FACEBOOK", value: "https://facebook.com/karachidental.example" }],
    issues: [
      { type: "no-whatsapp", severity: "LOW", title: "No WhatsApp contact option", explanation: "No WhatsApp link was found on the homepage.", points: 3 },
    ],
    score: 2, priority: "LOW", reasons: ["No WhatsApp/contact option (+2)"],
  },
  {
    sourceId: "seed-005", name: "Lahore Fitness Hub", category: "Gym", country: "Pakistan", city: "Lahore",
    address: "Gulberg III, Lahore", phone: "+92 42 0000 0005", rating: 4.1, reviews: 58,
    score: 5, priority: "HIGH", reasons: ["No website found (+5)"],
  },
  {
    sourceId: "seed-006", name: "Old Town Bakery", category: "Bakery", country: "United Kingdom", city: "London",
    address: "14 High Street, London", website: "https://oldtownbakery.example", rating: 4.4, reviews: 210,
    issues: [
      { type: "slow-page", severity: "MEDIUM", title: "Large images slow the page down", explanation: "Several images appear larger than needed for display.", evidence: "hero.jpg ~3.2 MB", points: 8 },
      { type: "broken-link", severity: "MEDIUM", title: "Broken internal link", explanation: "A link on the homepage returned 404.", evidence: "/menu-old -> 404", points: 6 },
    ],
    score: 4, priority: "MEDIUM", reasons: ["Poor performance (+2)", "Broken links (+2)"],
  },
  {
    sourceId: "seed-007", name: "Thames Legal Partners", category: "Law Firm", country: "United Kingdom", city: "London",
    website: "https://thameslegal.example", phone: "+44 20 0000 0007", email: "enquiries@thameslegal.example", rating: 4.6, reviews: 41,
    score: 0, priority: "LOW", reasons: ["No issues detected"],
  },
  {
    sourceId: "seed-008", name: "Sunset Yoga Studio", category: "Yoga Studio", country: "United Arab Emirates", city: "Abu Dhabi",
    website: "https://sunsetyoga.example", phone: "+971 2 000 0008", rating: 4.9, reviews: 77,
    issues: [
      { type: "missing-alt", severity: "LOW", title: "Images missing alt text", explanation: "6 of 9 images have no alt attribute.", evidence: "6/9 images", points: 4 },
      { type: "no-contact-form", severity: "LOW", title: "No contact form", explanation: "No contact form was detected.", points: 3 },
    ],
    score: 3, priority: "MEDIUM", reasons: ["Important contact problems (+2)", "Missing basic SEO elements (+1)"],
  },
];

async function main() {
  const job = await db.searchJob.upsert({
    where: { id: "seed-job-dubai-restaurants" },
    update: {},
    create: {
      id: "seed-job-dubai-restaurants", country: "United Arab Emirates", city: "Dubai", category: "Restaurant",
      maxResults: 50, provider: "mock", status: "COMPLETED", businessesFound: 2, websitesFound: 1, auditsCompleted: 1,
      highPriorityCount: 2, startedAt: new Date(), completedAt: new Date(),
    },
  });

  let rank = 0;
  for (const b of businesses) {
    const dedupeKey = buildDedupeKey(b.name, b.city, b.website);
    const business = await db.business.upsert({
      where: { dedupeKey },
      update: {},
      create: {
        name: b.name, normalizedName: normalizeName(b.name), category: b.category,
        website: b.website, websiteDomain: websiteDomain(b.website),
        websiteStatus: b.website ? "ACTIVE" : "NO_WEBSITE",
        phone: b.phone, publicEmail: b.email, rating: b.rating, reviewCount: b.reviews,
        source: "mock", sourceId: b.sourceId, dedupeKey,
        location: { create: { country: b.country, city: b.city, address: b.address } },
        lead: { create: { status: "RESEARCHED" } },
        contactMethods: {
          create: [
            ...(b.phone ? [{ type: "PHONE" as const, value: b.phone, source: "mock" }] : []),
            ...(b.email ? [{ type: "EMAIL" as const, value: b.email, source: "mock" }] : []),
            ...(b.socials ?? []).map((s) => ({ ...s, source: "mock" })),
          ],
        },
      },
      include: { lead: true },
    });

    if (b.city === "Dubai" && b.category === "Restaurant") {
      await db.searchResult.upsert({
        where: { jobId_businessId: { jobId: job.id, businessId: business.id } },
        update: {},
        create: { jobId: job.id, businessId: business.id, rank: ++rank },
      });
    }

    const existingAudit = await db.websiteAudit.count({ where: { businessId: business.id } });
    if (b.website && existingAudit === 0) {
      const deducted = (b.issues ?? []).reduce((sum, i) => sum + i.points, 0);
      await db.websiteAudit.create({
        data: {
          businessId: business.id, url: b.website, status: "COMPLETED", httpStatus: 200,
          usesHttps: b.website.startsWith("https://"), redirectCount: 0,
          websiteScore: Math.max(0, 100 - deducted),
          scoreBreakdown: (b.issues ?? []).map((i) => ({ rule: i.type, points: -i.points, reason: i.title })),
          startedAt: new Date(), finishedAt: new Date(),
          issues: {
            create: (b.issues ?? []).map((i) => ({
              type: i.type, severity: i.severity, title: i.title, explanation: i.explanation,
              evidence: i.evidence, pointsDeducted: i.points,
            })),
          },
        },
      });
    }

    if (business.lead && b.score !== undefined && b.priority) {
      const hasScore = await db.leadScore.count({ where: { leadId: business.lead.id } });
      if (hasScore === 0) {
        await db.leadScore.create({
          data: {
            leadId: business.lead.id, score: b.score, maximumScore: 20, priority: b.priority,
            reasons: b.reasons ?? [], signals: [], configVersion: "seed",
          },
        });
      }
    }
  }
  console.log(`Seeded ${businesses.length} fake businesses.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
