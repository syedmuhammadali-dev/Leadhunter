# Business data providers

All business data enters LeadHunter through the `BusinessDataProvider` interface
(`apps/api/src/providers/types.ts`). The importer, database, audits, scoring and UI never know which
provider produced a business, so adding a provider does not change them.

```ts
interface BusinessDataProvider {
  readonly name: string; // stored as Business.source, e.g. "csv"
  searchBusinesses(params: { country; city; category; limit }): Promise<ProviderBusiness[]>;
  getBusinessDetails(id: string): Promise<ProviderBusiness | null>;
}
```

`ProviderBusiness` (in `packages/shared`) holds only public, business-level fields: name, category,
country, city, address, website, phone, email, rating, reviewCount, facebook, instagram, linkedin,
plus optional `sourceId` / `sourceUrl`.

## Providers included now (free)
| Provider | File | Notes |
|---|---|---|
| `mock` | `providers/mock.ts` | Deterministic fake businesses (`.example` domains). |
| `csv` | `providers/csv.ts` | Parses and validates an uploaded CSV. Rows have no stable id, so duplicates are found by dedupe key. |

## CSV format
Required columns: `name`, `category`, `country`, `city`.
Optional: `address`, `website`, `phone`, `email`, `rating` (0-5), `reviewCount`, `facebook`, `instagram`, `linkedin`.
Header names ignore case/spaces (`Review Count`, `review_count` work). Limits: 5 MB, 5000 rows.
URLs must be http(s). A sample is at `apps/web/public/sample-leads.csv`.

## Duplicate detection (`services/importer.ts`)
A row is skipped when any of these is true:
1. It repeats an earlier row in the same file (same normalized name + city + website domain).
2. `dedupeKey` (normalized name | city | website domain) already exists in the database.
3. The same website domain already exists in the same city (catches renamed duplicates).
4. The same `(source, sourceId)` already exists (providers that supply ids).

The database also enforces `dedupeKey` and `(source, sourceId)` as unique, so concurrent imports cannot create duplicates.

## Adding a future permitted API provider
Only use APIs whose terms allow this use, with your own key. Never scrape pages, bypass limits or use proxies.

1. Create `apps/api/src/providers/<name>.ts` with a class implementing `BusinessDataProvider`.
   Map the API's response to `ProviderBusiness`; set `sourceId` to the API's stable place id and `sourceUrl` if allowed.
   Read the key from `process.env` (add it to `.env.example`, never to the frontend).
2. Respect the API's quotas: honour `limit`, page with the API's own pagination, back off on 429.
3. Register it in `providers/registry.ts`: add an entry to `PROVIDER_INFO` and a `case` in `createProvider`.
4. Add `"<name>"` to the `provider` enum in `routes.ts` (`searchBodySchema`).
5. Add tests with the HTTP layer mocked (no real calls in CI).

Nothing else changes: `POST /api/search` with `{ provider: "<name>", save: true }` already runs the
provider, de-duplicates and stores results, and the dashboard/audit/scoring code reads from the database.

## API endpoints
- `GET  /api/providers` lists providers.
- `POST /api/import/csv` body `{ csvText }` returns `{ totalRows, validRows, inserted, duplicates[], invalid[], fileErrors[] }`.
- `POST /api/search` body `{ provider, country, city, category, limit, save?, csvText? }`.
- `GET  /api/businesses?source=&q=&page=&pageSize=` lists stored businesses.
