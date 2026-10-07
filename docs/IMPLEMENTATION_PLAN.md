# Implementation Plan

Follows spec §103–§114 and the sprint backlog in §148. Each phase is done only when its acceptance criteria pass and the Definition of Done (spec §0) is met.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Foundation: monorepo, Docker, CI, config, Postgres, Valkey, migrations, logging, health, basic web/API | **Done** (verified locally 2026-10-08; CI not yet run on GitHub) |
| 1 | CRM MVP: auth, organizations, users, teams, RBAC, leads, contacts, companies, pipeline, assignment, follow-ups, tasks, notes, activities, dashboard | Not started |
| 2 | Communication: inbox, conversations, messages, realtime, email adapter, webhooks | Not started |
| 3 | AI foundation: provider abstraction, OpenAI Responses API, settings, usage logging, prompt versioning, structured outputs | Not started |
| 4 | AI intelligence: scoring, conversation analysis, summaries, reply assistant, next action, NL search | Not started |
| 5 | Knowledge base / RAG with pgvector and citations | Not started |
| 6 | Automation engine | Not started |
| 7 | Integrations: WhatsApp, Facebook, Instagram, web chat, API keys | Not started |
| 8 | Analytics & forecasting | Not started |
| 9 | Production hardening | Not started |
| 10 | SaaS | Not started |

## Phase 0 checklist

- [x] pnpm monorepo (`apps/api`, `apps/worker`, `apps/web`, `packages/config`, `packages/database`)
- [x] Env validation (`@leadora/config`) with tests
- [x] Drizzle migrations: `organizations`, `users`, `citext` + `vector` extensions
- [x] NestJS API: `/health`, `/health/live`, `/health/ready`, error contract, request IDs, JSON logs, Swagger in non-prod
- [x] Worker: BullMQ queues per spec §119, retry schedule §120, health server, graceful shutdown
- [x] Next.js web shell with spec §96 navigation and live system status
- [x] Multi-stage Dockerfile (non-root, tini), Compose with healthchecks, one-shot migrations, Caddy proxy
- [x] CI: lint, typecheck, tests, migration check, drift check, build, Docker smoke test
- [x] ADRs 001–011
- [x] `docker compose up -d --build --wait` from empty volumes: all 7 services healthy, migrations idempotent, seed works, a worker job round-trips, UI shows live status through Caddy
- [ ] CI green on GitHub (no remote configured yet)
- [ ] `THIRD_PARTY_NOTICES.md` generated from `pnpm licenses list --prod` (Phase 0 follow-up)

## Phase 1 / Sprint 2 — Auth, tenancy, RBAC

### Threat model (STRIDE over the auth boundary)

Trust boundaries: HTTP body/cookies/headers (incl. `Origin`, `X-Forwarded-For` from Caddy), the first-run registration endpoint.

| Threat | Abuse case | Mitigation | Test |
| --- | --- | --- | --- |
| Spoofing | Credential stuffing / brute force | Argon2id; Valkey-backed limiter: 10 failed attempts / 15 min per IP+email | 11th attempt → 429 |
| Spoofing | User enumeration via login | Same `INVALID_CREDENTIALS` for unknown email and wrong password; dummy hash verify | unknown vs wrong pw identical |
| Spoofing | Stolen session token | 32-byte random token, only SHA-256 stored; `httpOnly`, `SameSite=Lax`, `Secure` (configurable); 7-day expiry; logout revokes | logout → `/me` 401 |
| Tampering | CSRF on state-changing routes | `SameSite=Lax` + `Origin` allowlist (`APP_ORIGINS`) on non-GET | bad Origin → 403 |
| Repudiation | Denying an admin action | `audit_logs` row written in the same transaction | audit entries exist |
| Info disclosure | Password hash or other tenant data in responses | Response DTO allowlists; org id only from session | cross-org → 404 |
| DoS | Huge passwords to burn CPU | Password 12–128 chars, body limit 100 kB | 129 chars → 422 |
| Elevation | Agent creates admins / open org registration | Permission guard on every route (deny by default); registration only on first run or `ALLOW_SIGNUP=true` (advisory lock) | agent → 403; 2nd register → 403 |
| Elevation | Disabled user keeps access | Disabling revokes all sessions; login refused | disabled → 401 |

Deferred to Phase 2 (needs the email adapter): email verification, password reset, invitations.

### Slices (each: failing test → code → green suite → commit)

1. Integration test harness (real Postgres `leadora_test` + Valkey db 15)
2. Schema: `roles`, `role_permissions`, `user_roles`, `sessions`, `audit_logs`; global unique email (ADR-012)
3. First-run registration → org + default roles + admin + session
4. Login / logout / me, with rate limiting and Origin check
5. Auth guard (deny by default) + `@RequirePermission` + tenant context
6. Users admin API: list, create, update role/status (disable revokes sessions)
7. Teams API: CRUD + members
8. Audit log API
9. Web: login, first-run setup, authenticated shell, users & teams pages

## Phase 1 — later sprints (3–4)

1. **Schema**: `teams`, `team_members`, `roles`, `permissions`, `role_permissions`, `user_roles`, `sessions`, `audit_logs`, `outbox_events`.
2. **Auth**: email/password with Argon2id, HTTP-only session cookie, email verification and password reset tokens (hashed), rate limits on auth endpoints.
3. **Tenancy guard**: request-scoped organization context resolved from the session, plus a repository helper that always applies `organization_id`. Postgres RLS evaluated as defense in depth (ADR to follow).
4. **RBAC**: permission guard (`@RequirePermission('lead.assign')`), default roles seeded per organization.
5. **Leads**: `leads`, `lead_sources`, `lead_tags`, `lead_tag_links`, `custom_field_definitions/values`, `CreateLeadCommand` ingestion path with normalizer, validator and deduplicator (spec §12–13).
6. **Pipeline / assignment / follow-ups / tasks / notes / activities** (spec §16–20) with transactional activity writes (§117).
7. **Web**: auth screens, lead list/detail, pipeline Kanban, follow-up list.

Acceptance: a user can take a lead from creation to conversion without manual database intervention.
