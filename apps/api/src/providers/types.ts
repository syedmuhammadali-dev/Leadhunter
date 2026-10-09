import type { ProviderBusiness, SearchBusinessesParams } from "@leadhunter/shared";

/**
 * A source of public business-level data. The rest of the app only talks to this interface,
 * so a new (permitted) provider can be added without changing importer, scoring, audits or UI.
 * See docs/providers.md.
 */
export interface BusinessDataProvider {
  /** Short stable name stored as Business.source, e.g. "mock" or "csv". */
  readonly name: string;
  searchBusinesses(params: SearchBusinessesParams): Promise<ProviderBusiness[]>;
  getBusinessDetails(id: string): Promise<ProviderBusiness | null>;
}
