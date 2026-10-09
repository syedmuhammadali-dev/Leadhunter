import type { PrismaClient } from "@prisma/client";
import { buildDedupeKey, normalizeName, websiteDomain, type ProviderBusiness } from "@leadhunter/shared";
import { CsvProvider, type InvalidRow } from "../providers/csv.js";

export interface SaveItem {
  /** Line in the source file, when there is one. */
  line?: number;
  business: ProviderBusiness;
}

export interface DuplicateRow {
  line?: number;
  name: string;
  reason: string;
}

export interface SaveResult {
  inserted: number;
  duplicates: DuplicateRow[];
}

export interface ImportReport extends SaveResult {
  totalRows: number;
  validRows: number;
  invalid: InvalidRow[];
  fileErrors: string[];
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * Save provider businesses, skipping duplicates. A row is a duplicate when:
 *  - it repeats an earlier row in the same batch,
 *  - the same name + city + website domain already exists (dedupeKey),
 *  - the same website domain already exists in the same city, or
 *  - the same (source, sourceId) already exists.
 */
export async function saveBusinesses(db: PrismaClient, items: SaveItem[], source: string): Promise<SaveResult> {
  const duplicates: DuplicateRow[] = [];
  const seenKeys = new Set<string>();
  const candidates: { item: SaveItem; key: string; domain: string | null }[] = [];

  for (const item of items) {
    const b = item.business;
    const key = buildDedupeKey(b.name, b.city, b.website);
    if (seenKeys.has(key)) {
      duplicates.push({ line: item.line, name: b.name, reason: "Duplicate of an earlier row in this file" });
      continue;
    }
    seenKeys.add(key);
    candidates.push({ item, key, domain: websiteDomain(b.website) });
  }

  const keys = candidates.map((c) => c.key);
  const domains = [...new Set(candidates.map((c) => c.domain).filter((d): d is string => d !== null))];
  const sourceIds = candidates.map((c) => c.item.business.sourceId).filter((s): s is string => !!s);

  const [byKey, byDomain, bySourceId] = await Promise.all([
    db.business.findMany({ where: { dedupeKey: { in: keys } }, select: { dedupeKey: true } }),
    domains.length ? db.business.findMany({ where: { websiteDomain: { in: domains } }, select: { websiteDomain: true, location: { select: { city: true } } } }) : [],
    sourceIds.length ? db.business.findMany({ where: { source, sourceId: { in: sourceIds } }, select: { sourceId: true } }) : [],
  ]);
  const existingKeys = new Set(byKey.map((b) => b.dedupeKey));
  const existingDomainCity = new Set(byDomain.map((b) => `${b.websiteDomain}|${normalizeName(b.location?.city ?? "")}`));
  const existingSourceIds = new Set(bySourceId.map((b) => b.sourceId));

  let inserted = 0;
  const domainCityInBatch = new Set<string>();
  for (const { item, key, domain } of candidates) {
    const b = item.business;
    const domainCity = domain ? `${domain}|${normalizeName(b.city)}` : null;
    let reason: string | null = null;
    if (existingKeys.has(key)) reason = "Already in the database (same name, city and website)";
    else if (domainCity && (existingDomainCity.has(domainCity) || domainCityInBatch.has(domainCity))) reason = "Same website in the same city already exists";
    else if (b.sourceId && existingSourceIds.has(b.sourceId)) reason = "Already imported from this provider";
    if (reason) {
      duplicates.push({ line: item.line, name: b.name, reason });
      continue;
    }

    try {
      await db.business.create({
        data: {
          name: b.name,
          normalizedName: normalizeName(b.name),
          category: b.category,
          website: b.website,
          websiteDomain: domain,
          websiteStatus: b.website ? "UNKNOWN" : "NO_WEBSITE",
          phone: b.phone,
          publicEmail: b.email,
          rating: b.rating,
          reviewCount: b.reviewCount,
          source,
          sourceId: b.sourceId,
          sourceUrl: b.sourceUrl,
          dedupeKey: key,
          location: { create: { country: b.country, city: b.city, address: b.address } },
          lead: { create: {} },
          contactMethods: {
            create: [
              ...(b.phone ? [{ type: "PHONE" as const, value: b.phone, source }] : []),
              ...(b.email ? [{ type: "EMAIL" as const, value: b.email, source }] : []),
              ...(b.facebook ? [{ type: "FACEBOOK" as const, value: b.facebook, source }] : []),
              ...(b.instagram ? [{ type: "INSTAGRAM" as const, value: b.instagram, source }] : []),
              ...(b.linkedin ? [{ type: "LINKEDIN" as const, value: b.linkedin, source }] : []),
            ],
          },
        },
      });
      inserted++;
      if (domainCity) domainCityInBatch.add(domainCity);
    } catch (e) {
      // Lost a race with another writer: treat as a duplicate instead of failing the whole import.
      if (!isUniqueViolation(e)) throw e;
      duplicates.push({ line: item.line, name: b.name, reason: "Already in the database" });
    }
  }
  return { inserted, duplicates };
}

/** Parse, validate and save a CSV file's businesses. */
export async function importCsv(db: PrismaClient, csvText: string): Promise<ImportReport> {
  const provider = new CsvProvider(csvText);
  if (provider.fileErrors.length > 0) {
    return { totalRows: provider.totalRows, validRows: 0, inserted: 0, duplicates: [], invalid: [], fileErrors: provider.fileErrors };
  }
  const saved = await saveBusinesses(db, provider.valid, "csv");
  return {
    totalRows: provider.totalRows,
    validRows: provider.valid.length,
    inserted: saved.inserted,
    duplicates: saved.duplicates,
    invalid: provider.invalid,
    fileErrors: [],
  };
}
