# LeadHunter

Free, local-first business lead research tool (not a spam/outreach system). See `docs/architecture.md` and `phases.txt`.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` (Neon free Postgres or local Postgres).
3. `npm run db:generate`
4. `npm run build -w @leadhunter/shared`
5. `npm run dev` (API on :4000, web on :3000)

## Checks
`npm run typecheck`, `npm test`, `npm run build`, `npm run db:validate`

## n8n
See `n8n/README.md` (`npx n8n`).
