# Leadora AI

AI-powered Lead Generation, CRM and Sales Intelligence platform.

- Product & architecture specification: [AI-LEAD-PLATFORM-SPEC.md](AI-LEAD-PLATFORM-SPEC.md)
- Architecture overview: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Implementation plan & status: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)
- Architecture decisions: [docs/adr](docs/adr)

## Stack

Next.js · NestJS · PostgreSQL + pgvector · Valkey · BullMQ · Drizzle ORM · Caddy · Docker Compose · pnpm workspaces

## Run with Docker (recommended)

Requirements: Docker with Compose v2.

```bash
cp .env.example .env        # then set POSTGRES_PASSWORD and JWT_SECRET
docker compose up -d --build --wait
```

Open http://localhost:8080 (port set by `PUBLIC_HTTP_PORT`). On first run you are sent to **/setup** to create your organization and the first admin account. After that, registration closes (unless `ALLOW_SIGNUP=true`) and admins add people under **Users**.

Migrations run automatically through the one-shot `migrate` service before `api` and `worker` start. To run them manually:

```bash
docker compose run --rm migrate
```

Useful commands:

```bash
docker compose ps                     # service health
docker compose logs -f api worker     # structured JSON logs
docker compose down                   # stop (keeps data volumes)
docker compose down -v                # stop and DELETE all data
```

## Run on the host (development)

Requirements: Node 24, pnpm 11.

```bash
pnpm install
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres valkey
pnpm build:packages
pnpm db:migrate
pnpm --filter @leadora/api dev      # http://localhost:3001  (Swagger: /api/docs)
pnpm --filter @leadora/worker dev
pnpm --filter @leadora/web dev      # http://localhost:3000
```

Host-run apps read `DATABASE_URL` / `VALKEY_URL` from your shell environment; export them from `.env` first.

Optional demo data: `pnpm db:seed` creates a separate "Demo Traders" organization with about forty leads, an admin
(`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`) and an optional agent (`SEED_AGENT_*`). It refuses to run with
`NODE_ENV=production` and does nothing if the demo organization already exists. On a fresh install, finish `/setup`
for your own organization first.

## Quality gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm licenses:check                    # production dependency licenses (ADR-009)
pnpm --filter @leadora/api test:perf   # load test against spec §68 (docs/PERFORMANCE.md)
```

## Repository layout

```text
apps/
  api/        NestJS REST API (/api/v1, /health)
  worker/     BullMQ background workers
  web/        Next.js frontend
packages/
  config/     Zod-validated environment config
  database/   Drizzle schema, migrations
infrastructure/
  proxy/      Caddyfile
docs/         Architecture, plan, ADRs
```

## Health endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | basic service status |
| `GET /health/live` | liveness (process up, no dependency checks) |
| `GET /health/ready` | readiness (Postgres + Valkey; 503 if any is down) |
