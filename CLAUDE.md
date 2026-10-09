# LeadHunter

Free, local-first business lead *research* tool for finding potential website-development clients.
Pick country / city / category / limit -> collect permitted business data -> audit website -> transparent priority score -> dashboard -> CSV export.
It is NOT a spam/outreach system. Full phase spec: `phases.txt` (source of truth). Architecture: `docs/architecture.md`.

## Workflow rules
- Work ONE phase at a time (`phases.txt`). Start only when the user says "START PHASE N". Stop after the phase; never start the next.
- Phase 0 = explain only, no code.
- After each phase: run typecheck/build/tests, fix errors, then report what was created, exact run commands, and what to verify manually.
- Don't add libraries, auth, AI, providers or outreach before the phase that calls for them.
- Don't rewrite working code or change existing UI unnecessarily.
- User prefers Roman Urdu/English (Hinglish) explanations; keep code, comments and docs in English.

## Stack
- Monorepo (npm workspaces): `apps/web` (Next.js + TS + Tailwind), `apps/api` (Node + TS REST), `packages/shared`, `prisma/`, `n8n/`, `docs/`
- PostgreSQL + Prisma, n8n (self-hosted local), optional Ollama. Windows + VS Code + Docker only where it helps (Postgres, n8n).
- $0 cost in dev. Never assume a service is permanently free.

## Hard legal/safety rules (never violate)
1. No Google Maps page scraping, no browser automation on it, no CAPTCHA/rate-limit bypass, no proxy rotation, no unofficial scraping APIs.
2. Business-level public info only; no sensitive personal data.
3. Respect robots.txt; timeouts, rate limits, small concurrency on audits; never submit forms or authenticate.
4. NEVER auto-send email/WhatsApp/DMs. Outreach is a draft for manual review; user triggers any action.
5. Never pretend to be the business owner. Never claim a business "needs" or "will buy". Scores = research priority from observable signals only, with visible reasons.
6. Website analyzer must be SSRF-safe (block localhost, private IPs, metadata endpoints; validate DNS; cap size and redirects).
7. Secrets only in `.env` (never committed, never in frontend). Keep `.env.example` current.
8. AI (Ollama) is optional; app must work with rule-based scoring alone. Separate observed facts from AI suggestions.

## Design principles
- Business-data source behind a `BusinessDataProvider` interface (Mock + CSV first); scoring weights configurable, not hardcoded in UI.
- Shared types/validation (zod) in `packages/shared`.

## Commands
- `npm install` then copy `.env.example` -> `.env` (set `DATABASE_URL`)
- `npm run db:generate` / `npm run db:validate` (Prisma 7: URL lives in `prisma.config.ts`, client uses `@prisma/adapter-pg`)
- `npx prisma migrate dev --name <name>` (uses `DATABASE_URL_DIRECT`, the non-pooled Neon URL), `npx prisma db seed` (idempotent fake data)
- DB tests: `apps/api/src/schema.db.test.ts` hit the real Neon DB (skipped if no DATABASE_URL)
- `npm run build -w @leadhunter/shared` (needed once before api/web typecheck)
- `npm run dev:api` (:4000), `npm run dev:web` (:3000), `npm run dev` for both
- `npm run typecheck`, `npm test`, `npm run build`, `npm run lint -w @leadhunter/web`
- n8n: `npx n8n` (no Docker on this PC). Dev DB = Neon project `leadhunter-dev`.

## Gotchas
- Write `.env` / JSON without a BOM (PowerShell `Set-Content -Encoding utf8` adds one and breaks parsing).
- Pin `prisma` and `@prisma/client` to the same version (npm picked an 8.0 rc for the CLI once).
- `tsx watch` crashes on this Windows setup; API dev uses `node --watch --import tsx`.
- Run dev servers via background tasks, not `&` (they die when the shell call ends).

## Status
- Phase 0-4 done. Phase 4: providers in `apps/api/src/providers` (mock, csv, registry), importer in `services/importer.ts`, routes in `routes.ts`, web `/import` page; see `docs/providers.md`. Phase 3 UI uses FAKE data in `apps/web/lib/fake-data.ts` (not the DB yet); filtering/sort/pagination in `lib/query.ts` via URL search params. Search/leads pages still use FAKE data (Phase 3). Awaiting "START PHASE 5".
- Chrome testing: with several browsers connected, use `switch_browser`; if the window is minimized screenshots/clicks time out, but `navigate` + `get_page_text` still work.
