# LeadHunter Architecture (Phase 0)

## 1. Overview
```
Next.js Dashboard -> Node API -> n8n (orchestration) -> Provider -> DB -> Website Analyzer -> Scoring -> (optional Ollama) -> PostgreSQL -> Dashboard -> CSV
```
Key decision: **the API owns all logic** (provider, analyzer, scoring, AI). n8n only orchestrates by calling API endpoints, so the workflow stays thin and the logic stays testable in TypeScript.

## 2. Components
| Component | Role |
|---|---|
| `apps/web` | Next.js UI: search form, leads table, lead detail, audit view, history, settings, CRM, export. Talks only to the API. |
| `apps/api` | Node/TS REST API. Validation (zod), Prisma access, provider layer, analyzer, scorer, AI service, export, n8n trigger. |
| `packages/shared` | Shared TS types, zod schemas, enums, score config types. |
| `prisma/` | Schema, migrations, seed (fake businesses). |
| `n8n/` | Workflow JSON + docs. Runs locally in Docker. |
| PostgreSQL | Single source of truth. Docker locally. |
| Ollama (optional) | Local LLM for summaries/drafts. Absent -> rule-based only. |

Backend modules: `providers/` (BusinessDataProvider: Mock, CSV, future API), `analyzer/` (SSRF-safe fetch, robots.txt, HTML checks), `scoring/` (configurable weights), `ai/` (AiProvider interface, Ollama impl), `jobs/`, `export/`.

## 3. Data flow
1. User submits country/city/category/limit in the UI.
2. Web -> `POST /api/search-jobs` -> API validates, creates SearchJob (QUEUED).
3. API calls n8n webhook (shared-secret header) with jobId + params.
4. n8n calls API: fetch businesses from provider -> dedupe -> save (Business/Location/Lead/SearchResult).
5. n8n queues audits for businesses with websites; API runs them with a concurrency limit; stores WebsiteAudit + AuditIssue.
6. API computes LeadScore (score, max, reasons, signals) and updates job progress at each step.
7. UI polls `GET /api/search-jobs/:id` for progress, then shows leads. Export via `GET /api/leads/export`.

## 4. n8n <-> backend
- API -> n8n: HTTP POST to webhook, header `x-webhook-secret`.
- n8n -> API: HTTP Request nodes to internal endpoints, header `x-api-key`, base URL `http://host.docker.internal:4000` (API) from the n8n container.
- Progress is written by the API (n8n calls `PATCH /internal/jobs/:id`). No credentials stored in the workflow JSON; use n8n env/credentials.

## 5. Folder structure
```
leadhunter/
  apps/web  apps/api
  packages/shared
  prisma/ (schema.prisma, migrations, seed.ts)
  n8n/ (workflows/, README.md)
  docs/
  docker-compose.yml  (postgres + n8n only)
  .env.example  CLAUDE.md  phases.txt
```
npm workspaces; no Turborepo/Nx (unneeded).

## 6. Database schema (proposed, finalized in Phase 2)
- **Business**: name, normalizedName, category, website, phone, publicEmail, social links, rating, reviewCount, source, sourceId, sourceUrl. Unique (source, sourceId); dedupe key (normalizedName + city + website domain).
- **Location**: businessId, country, city, address, lat/lng optional.
- **Lead**: businessId (unique), status (CRM enum), notes, tags, nextFollowUpAt, proposalAmount.
- **ContactMethod**: type (EMAIL/PHONE/WHATSAPP/FORM/SOCIAL), value, source (public only).
- **WebsiteAudit**: businessId, url, httpStatus, https, redirects, title, metaDescription, viewport, canonical, robots/sitemap flags, websiteScore, scoreBreakdown (JSON), startedAt/finishedAt, status.
- **AuditIssue**: auditId, type, severity, title, explanation, evidence, pointsDeducted, detectedAt.
- **LeadScore**: leadId, score, maximumScore, priority (HIGH/MEDIUM/LOW), reasons, signals (JSON), configVersion, calculatedAt.
- **SearchJob**: country, city, category, limit, status, counters (found, withWebsite, audited, highPriority), error, timestamps.
- **SearchResult**: jobId, businessId (unique pair).
- **OutreachDraft**: leadId, channel, body, generatedBy (HUMAN/AI), status (DRAFT/REVIEWED), never auto-sent.
Indexes on category/city/status/score/createdAt; FK cascades chosen carefully.

## 7. Free/local strategy
Docker Compose runs Postgres + n8n; API and web run with `npm run dev`. Data from MockProvider and CSV import. Audits use plain `fetch` + HTML parsing (cheerio). PageSpeed is a pluggable, optional (free API key) integration. Ollama optional.

## 8. Limits of fully free operation
- No official free business-listing API with unlimited volume; real data = CSV imports or a permitted provider with free quota (limits change; verify at the time).
- Free hosting tiers sleep/limit hours and storage; n8n and Ollama realistically stay local.
- No JS rendering (no headless browser) -> some SPA sites may be under-analyzed.
- Local audits are rate-limited by design; ratings/reviews only exist if the provider supplies them.

## 9. Phases
0 Architecture · 1 Workspace · 2 DB · 3 Dashboard UI · 4 Providers (Mock/CSV) · 5 Website analyzer · 6 Scoring · 7 n8n · 8 CSV export · 9 Optional Ollama AI · 10 CRM · 11 Security review · 12 Free-tier deploy prep · 13 QA.
Suggestion: pull a minimal SSRF guard into Phase 5 (not wait for Phase 11), since the analyzer fetches arbitrary URLs.
