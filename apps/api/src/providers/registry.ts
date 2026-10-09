import { CsvProvider } from "./csv.js";
import { MockProvider } from "./mock.js";
import type { BusinessDataProvider } from "./types.js";

export const PROVIDER_INFO = [
  { name: "mock", description: "Deterministic fake businesses for development and demos" },
  { name: "csv", description: "Businesses imported from an uploaded CSV file" },
] as const;

export type ProviderName = (typeof PROVIDER_INFO)[number]["name"];

/**
 * Create a provider by name. To add a provider, implement BusinessDataProvider and add a case here
 * (and an entry in PROVIDER_INFO). Nothing else in the app needs to change.
 */
export function createProvider(name: ProviderName, options: { csvText?: string } = {}): BusinessDataProvider {
  switch (name) {
    case "mock":
      return new MockProvider();
    case "csv":
      return new CsvProvider(options.csvText ?? "");
  }
}
