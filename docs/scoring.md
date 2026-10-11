# Lead priority scoring (Phase 6)

The lead score ranks **which businesses are worth researching first**. It is built only from signals we can observe
(whether there is a website, what the website audit found, how many public reviews exist).
It is **not** a prediction that a business needs a website or will buy anything, and the app never says so.
Every score is stored with the exact reasons behind it.

Code: `apps/api/src/scoring/` (pure engine + config), `apps/api/src/services/scoring-service.ts` (database), `apps/api/src/leads-routes.ts` (API).

## Default signals
| Signal | Points | Applies when |
|---|---|---|
| No website found | +5 | The business has no website |
| Website could not be reached | +3 | The site exists but the audit could not connect |
| Website has major mobile problems | +3 | Audit found `missing-viewport` or `viewport-not-responsive` |
| Important contact problems | +2 | `no-contact-info` or `no-contact-page-or-form` |
| No clear call to action | +2 | `no-cta` |
| No WhatsApp/contact option | +2 | `no-whatsapp` |
| Missing basic SEO elements | +2 | `missing-title`, `missing-meta-description` or `missing-canonical` |
| Broken links | +2 | `broken-links` |
| Poor performance | +2 | `slow-performance` or `large-images` |
| Solid public presence | +1 | 100 or more reviews |
| Strong public presence | +2 | 500 or more reviews (replaces the +1) |

Each signal counts at most once. "No website" and the website signals are alternatives, so the highest possible score is
`max(no website path, website path) + 2` = **17** with the defaults (`maximumScore` is computed from the config).

Priorities: **High** at 6 or more, **Medium** at 3 or more, otherwise **Low** (thresholds are configurable).

### Missing data is not penalised
If a website has not been audited yet, was skipped (robots.txt) or the audit failed, its website signals are marked
"not checked", add no points, and the lead's score explanation says why. Only facts we observed add points.

## What is stored
- `LeadScore` (history): `score`, `maximumScore`, `priority`, `reasons` (e.g. `"No website found (+5)"`), `signals` (every signal considered with `matched` / `evaluated`, plus `notes`), `configVersion`, `calculatedAt`. A new row is written only when the result changes.
- `Lead.score`, `maximumScore`, `priority`, `scoredAt`: a copy of the newest result so the Leads table can filter and sort in the database.
- `Business.websiteScore`: score of the latest completed website audit (sortable).

Scores are recalculated automatically after a CSV import (new businesses) and after every website audit.

## Changing the weights
Weights, labels, thresholds, review tiers and the audit issue types behind each signal live in one validated config
(`DEFAULT_SCORING_CONFIG` in `scoring/config.ts`). Nothing about scoring is hardcoded in the UI; the Settings page just displays the active config.

To override values without touching code, create a JSON file containing **only what you want to change**, for example:

```json
{
  "thresholds": { "high": 8, "medium": 4 },
  "signals": { "noWebsite": { "weight": 6 } }
}
```

Then set `SCORING_CONFIG_PATH=C:\path\to\scoring.json` in `.env`, restart the API, and click **Recalculate all scores** on the Settings page
(or `POST /api/scoring/recalculate`). Invalid files make the API fail to start with a readable message instead of silently scoring with wrong weights.
Every score records a `configVersion` (a short hash of the active weights), so old scores can always be traced to the rules that produced them.

## API
- `GET /api/leads` query: `filter` (`has-website`, `no-website`, `problems`, `high`, `medium`, `low`), `priority`, `status`, `minScore`, `maxScore`, `q`, `country`, `city`, `category`, `sort` (`score`, `name`, `rating`, `reviews`, `websiteScore`), `dir`, `page`, `pageSize` (max 100), `limit` (cap the result set). Missing values sort last; ties are broken by name and id so pages are stable.
- `GET /api/leads/:id` lead detail with the latest score explanation, contact methods and score history.
- `GET /api/leads/stats` dashboard numbers.
- `GET /api/scoring/config`, `POST /api/scoring/recalculate`.

## Dashboard
The Leads table filters by priority, website state and score range (Min/Max score), sorts by score, name, rating, reviews or website score,
and pages 10 rows at a time. A lead's page shows each signal that added points, signals that were checked but did not apply, signals not yet checked, and the score history.
