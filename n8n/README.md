# n8n integration

n8n only orchestrates research jobs; all logic lives in the API (`apps/api`).

## Run locally (no Docker)
```
npx n8n
```
Open http://localhost:5678 and create the local owner account. Or use `docker compose up n8n` if Docker is installed.

## Communication
- API -> n8n: `POST http://localhost:5678/webhook/lead-research` with header `x-webhook-secret: <N8N_WEBHOOK_SECRET>`.
- n8n -> API: HTTP Request nodes to `http://localhost:4000/internal/...` (use `http://host.docker.internal:4000` from Docker) with header `x-api-key: <INTERNAL_API_KEY>`.
- Secrets live in `.env` / n8n credentials, never in workflow JSON.

Workflow JSON goes in `n8n/workflows/` (added in Phase 7). Workflows must only research and analyze; never send messages.
