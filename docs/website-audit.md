# Website audit engine (Phase 5)

Read-only analysis of a business's public homepage. Code: `apps/api/src/analyzer/` and `apps/api/src/security/`.

## What an audit does
1. Checks `robots.txt` on the site (and again on the final site if a redirect leaves it). If robots.txt disallows `LeadHunterBot`/`*` for the homepage, the audit is **SKIPPED** and the page is never fetched. A missing file means allowed; a 5xx means disallowed.
2. Fetches the homepage (GET, max 1 MB, 12 s, max 5 redirects) and parses it.
3. Probes `/sitemap.xml` (or uses a `Sitemap:` line from robots.txt).
4. Tests up to 8 same-site internal links for 404/5xx (HEAD, falling back to a small GET). Respects robots.txt per path.
5. Sends HEAD requests for up to 5 same-site images to find very large ones (> 500 KB).
6. Optionally asks a performance provider (Google PageSpeed) for a score.

It never submits forms, logs in, sends cookies, or downloads anything other than HTML (and HEAD responses). Requests to one host are spaced by `AUDIT_HOST_DELAY_MS` (default 1.5 s) and at most `AUDIT_CONCURRENCY` (default 2) audits run at once; a batch request accepts at most 25 businesses.

## What is detected
- **Technical:** HTTP status, HTTPS, redirects, title, meta description, viewport, canonical, robots.txt, sitemap, broken links.
- **Business presence:** phone, email, WhatsApp, contact page, contact form, Google Maps link, social links, booking link, services/menu info, pricing (observed only), clear call to action.
- **UX / accessibility:** mobile viewport, navigation, heading structure, image alt text, large images, `lang`, form labels, empty links, thin content.
- **Performance:** only if `PAGESPEED_ENABLED=true` (free API; `PAGESPEED_API_KEY` optional). Otherwise not measured.

## Website score (0-100), fully transparent
The score starts at 100 and every issue deducts points. The deductions are the **only** thing that moves the score:
`score = max(0, 100 - sum(points of all issues))`.
Severity and points per rule live in one table, `AUDIT_RULES` in `analyzer/scoring.ts`. Each stored `AuditIssue` has type, severity, title, explanation, evidence, points deducted and detection time, and the audit stores a `scoreBreakdown` list (`rule`, `points`, `reason`). The audit page shows the same breakdown table.

Observations about pricing and found contact details are recorded as facts, not scored.

## SSRF protection (`security/url-guard.ts`, `security/safe-fetch.ts`)
Every URL, including each redirect target, must be plain public `http(s)`:
- no credentials in the URL, only ports 80 and 443
- blocked: `localhost`, `*.local`, `*.internal`, `*.localhost`, single-label names, `metadata.google.internal`
- blocked IPs (v4 and v6, including IPv4-mapped IPv6 and odd forms like `2130706433` or `0x7f000001`): loopback, private ranges, link-local (`169.254.169.254` cloud metadata), CGNAT, multicast, reserved, documentation, 6to4/NAT64
- DNS is resolved inside the connection (`lookup` hook) and every returned address is checked, so a public name that points to an internal address, or DNS rebinding, is refused
- response size, time and redirect count are capped; compressed responses are not requested

`testAllowList` on the guard exists only so tests can reach local test servers. Production code never sets it.

## API
- `POST /api/businesses/:id/audit` starts an audit (202 `{ auditId, reused }`). If one is already running for the business it is reused.
- `POST /api/audits/batch` body `{ businessIds: string[] }` (1-25).
- `GET /api/audits/:id` returns the audit with issues (poll until `status` is not `PENDING`/`RUNNING`).
- `GET /api/businesses/:id/audits`, `GET /api/businesses/:id`.

Audit status: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED` (network/blocked/etc., business marked `UNREACHABLE` or `ERROR`), `SKIPPED` (robots.txt).
Public contact details found on the site (phone, email, WhatsApp, social links, contact page) are saved as `ContactMethod` rows with source `website-audit`.

## UI
`/import` lists imported businesses with a **Run Audit** button (polls until finished). `/businesses/[id]/audit` shows score, how it was calculated, issues with evidence, and observed contact signals.

## Limits
- Homepage only, no JavaScript rendering: single-page apps that build content in the browser may look emptier than they are.
- Phone numbers found in text are best-effort pattern matches.
- The Leads / Lead detail pages still use the Phase 3 fake data until the later phases connect them to the database.
