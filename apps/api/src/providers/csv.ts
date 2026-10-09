import {
  buildDedupeKey,
  mapCsvRows,
  parseCsv,
  validateBusinessRow,
  type ProviderBusiness,
  type SearchBusinessesParams,
} from "@leadhunter/shared";
import type { BusinessDataProvider } from "./types.js";

export interface InvalidRow {
  line: number;
  errors: string[];
}

export interface ValidRow {
  line: number;
  business: ProviderBusiness;
}

/**
 * Provider backed by an uploaded CSV file. Parsing and validation happen in the constructor;
 * `valid`, `invalid` and `fileErrors` describe what was found. Business ids are dedupe keys
 * (CSV rows have no stable provider id).
 */
export class CsvProvider implements BusinessDataProvider {
  readonly name = "csv";
  readonly valid: ValidRow[] = [];
  readonly invalid: InvalidRow[] = [];
  readonly fileErrors: string[] = [];
  /** Number of data rows in the file, valid or not. */
  totalRows = 0;

  constructor(csvText: string) {
    let cells: string[][];
    try {
      cells = parseCsv(csvText);
    } catch (e) {
      this.fileErrors.push(e instanceof Error ? e.message : "Could not parse CSV");
      return;
    }
    const parsed = mapCsvRows(cells);
    this.fileErrors.push(...parsed.fileErrors);
    this.totalRows = parsed.rows.length;
    for (const row of parsed.rows) {
      const result = validateBusinessRow(row.data);
      if (result.ok) this.valid.push({ line: row.line, business: result.value });
      else this.invalid.push({ line: row.line, errors: result.errors });
    }
  }

  async searchBusinesses({ country, city, category, limit }: SearchBusinessesParams): Promise<ProviderBusiness[]> {
    const same = (a: string, b: string) => !b || a.toLowerCase() === b.toLowerCase();
    return this.valid
      .map((v) => v.business)
      .filter((b) => same(b.country, country) && same(b.city, city) && same(b.category, category))
      .slice(0, limit);
  }

  async getBusinessDetails(id: string): Promise<ProviderBusiness | null> {
    return this.valid.find((v) => buildDedupeKey(v.business.name, v.business.city, v.business.website) === id)?.business ?? null;
  }
}
