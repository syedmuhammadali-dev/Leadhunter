import { z } from "zod";

/** A business as returned by any BusinessDataProvider. Only public, business-level information. */
export interface ProviderBusiness {
  name: string;
  category: string;
  country: string;
  city: string;
  address?: string;
  website?: string;
  phone?: string;
  email?: string;
  rating?: number;
  reviewCount?: number;
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  /** The provider's own id, when it has a stable one. */
  sourceId?: string;
  sourceUrl?: string;
}

export const searchBusinessesParamsSchema = z.object({
  country: z.string().trim().max(100).default(""),
  city: z.string().trim().max(100).default(""),
  category: z.string().trim().max(100).default(""),
  limit: z.number().int().min(1).max(500).default(50),
});
export type SearchBusinessesParams = z.infer<typeof searchBusinessesParamsSchema>;

export const CSV_FIELDS = [
  "name",
  "category",
  "country",
  "city",
  "address",
  "website",
  "phone",
  "email",
  "rating",
  "reviewCount",
  "facebook",
  "instagram",
  "linkedin",
] as const;
export type CsvField = (typeof CSV_FIELDS)[number];

export const CSV_REQUIRED_FIELDS: CsvField[] = ["name", "category", "country", "city"];

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 5000;

const HEADER_ALIASES: Record<string, CsvField> = Object.fromEntries([
  ...CSV_FIELDS.map((f) => [f.toLowerCase(), f]),
  ["review_count", "reviewCount"],
  ["reviews", "reviewCount"],
  ["businessname", "name"],
  ["business_name", "name"],
  ["url", "website"],
  ["site", "website"],
  ["telephone", "phone"],
]);

/** Map a raw header cell to a known field, ignoring case, spaces and dashes. */
export function matchHeader(raw: string): CsvField | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "");
  return HEADER_ALIASES[key] ?? HEADER_ALIASES[key.replace(/_/g, "")] ?? null;
}

/** Returns a normalized http(s) URL string, or null if the value is not a safe web URL. */
export function normalizeHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export type RowResult = { ok: true; value: ProviderBusiness } | { ok: false; errors: string[] };

const MAX_TEXT = 300;

/** Validate and clean one CSV row (keys are CsvField names, values raw strings). */
export function validateBusinessRow(raw: Partial<Record<CsvField, string>>): RowResult {
  const errors: string[] = [];
  const get = (f: CsvField) => (raw[f] ?? "").trim();

  const text = (f: CsvField, required: boolean): string | undefined => {
    const v = get(f);
    if (!v) {
      if (required) errors.push(`${f} is required`);
      return undefined;
    }
    if (v.length > MAX_TEXT) {
      errors.push(`${f} is longer than ${MAX_TEXT} characters`);
      return undefined;
    }
    return v;
  };

  const url = (f: CsvField): string | undefined => {
    const v = get(f);
    if (!v) return undefined;
    const normalized = normalizeHttpUrl(v);
    if (!normalized) errors.push(`${f} is not a valid http(s) URL`);
    return normalized ?? undefined;
  };

  const name = text("name", true);
  const category = text("category", true);
  const country = text("country", true);
  const city = text("city", true);
  const address = text("address", false);
  const phone = text("phone", false);
  const website = url("website");
  const facebook = url("facebook");
  const instagram = url("instagram");
  const linkedin = url("linkedin");

  let email: string | undefined;
  if (get("email")) {
    const parsed = z.email().safeParse(get("email"));
    if (parsed.success) email = parsed.data.toLowerCase();
    else errors.push("email is not a valid email address");
  }

  let rating: number | undefined;
  if (get("rating")) {
    const n = Number(get("rating"));
    if (Number.isFinite(n) && n >= 0 && n <= 5) rating = n;
    else errors.push("rating must be a number between 0 and 5");
  }

  let reviewCount: number | undefined;
  if (get("reviewCount")) {
    const n = Number(get("reviewCount").replace(/,/g, ""));
    if (Number.isInteger(n) && n >= 0) reviewCount = n;
    else errors.push("reviewCount must be a whole number, 0 or more");
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { name: name!, category: category!, country: country!, city: city!, address, website, phone, email, rating, reviewCount, facebook, instagram, linkedin },
  };
}

export interface ParsedCsvRow {
  /** 1-based line number in the file (header is line 1). */
  line: number;
  data: Partial<Record<CsvField, string>>;
}

export interface ParsedCsv {
  rows: ParsedCsvRow[];
  fileErrors: string[];
}

/** Turn raw CSV cells into keyed rows, checking headers and size limits. */
export function mapCsvRows(cells: string[][]): ParsedCsv {
  if (cells.length === 0) return { rows: [], fileErrors: ["The CSV file is empty"] };
  const [header, ...body] = cells;
  const columns = header!.map(matchHeader);
  const present = new Set(columns.filter((c): c is CsvField => c !== null));
  const missing = CSV_REQUIRED_FIELDS.filter((f) => !present.has(f));
  if (missing.length > 0) {
    return { rows: [], fileErrors: [`Missing required column(s): ${missing.join(", ")}`] };
  }
  if (body.length > MAX_CSV_ROWS) {
    return { rows: [], fileErrors: [`Too many rows (${body.length}). The limit is ${MAX_CSV_ROWS}`] };
  }
  const rows = body.map((cellsInRow, idx) => {
    const data: Partial<Record<CsvField, string>> = {};
    columns.forEach((col, i) => {
      if (col && data[col] === undefined) data[col] = cellsInRow[i] ?? "";
    });
    return { line: idx + 2, data };
  });
  return { rows, fileErrors: [] };
}
