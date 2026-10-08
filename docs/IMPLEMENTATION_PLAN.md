# Implementation Plan

Follows spec §103–§114 and the sprint backlog in §148. Each phase is done only when its acceptance criteria pass and the Definition of Done (spec §0) is met.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Foundation: monorepo, Docker, CI, config, Postgres, Valkey, migrations, logging, health, basic web/API | **Done** (verified locally 2026-10-08; CI not yet run on GitHub) |
| 1 | CRM MVP: auth, organizations, users, teams, RBAC, leads, contacts, companies, pipeline, assignment, follow-ups, tasks, notes, activities, dashboard | **Done** (2026-10-08) |
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

**Status (2026-10-08):** slices 1–9 are done and committed. There are 50 API integration tests against real Postgres and Valkey, covering every row of the threat model above, plus a mutation check proving the cross-tenant test catches a missing organization filter. The UI was verified in a browser: setup, validation errors, user and team management, audit log, agent permissions, sign-out redirect, mobile width, and a clean console.

Follow-ups noted, not done:
- Mobile navigation is a horizontal scroller; a collapsible menu would be better once the lead pages exist.
- Audit entries show raw user ids for membership changes; resolve them to names.
- Users can't yet change their own password or timezone (needs a profile page).

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

## Phase 1 / Sprint 3 — Leads

### Decisions

- Every organization gets a **default pipeline** (spec §16 stages) and **default lead sources** at creation. A migration backfills existing organizations.
- A lead's lifecycle status *is* its pipeline stage. There's no separate `status` column to drift out of sync.
- Every ingestion path (manual form now; CSV, webhook and API later) goes through one `ingestLead` function: **normalize → validate → deduplicate → insert → activity** (spec §12).
- **Dedup** for now matches exact normalized email and exact normalized phone within the organization. A duplicate is never silently dropped: manual create returns 409 with the existing lead id. Fuzzy matching and merge come later.
- **Phones** are normalized to E.164 with `libphonenumber-js`, using the organization's default country (`BD` unless changed).
- **Ownership:** a new lead is owned by its creator unless `ownerUserId` is given. Giving the lead to someone else needs `lead.assign`.
- **Visibility:** anyone with `lead.view` sees all of the organization's leads; "My leads" is a filter. Row-level visibility (agents see only their own) is a product decision to confirm before Phase 2.
- **Delete = archive** (`archived_at`). Leads are never hard-deleted from the API (spec §9, §13).
- **Company** stays free text on the lead (`company_name`) until lead conversion creates Company and Contact records in Sprint 4.

### Threat model additions

| Threat | Abuse case | Mitigation | Test |
| --- | --- | --- | --- |
| Elevation | Agent assigns leads to others | `lead.assign` required for any owner other than self | agent → 403 |
| Info disclosure | Reading or editing another org's lead, stage, tag or owner by id | every lookup scoped by `organization_id`; owner, stage and source ids validated in the same org | cross-org → 404 / 422 |
| Tampering | Moving a lead to a stage of another pipeline | stage must belong to the lead's pipeline | 422 |
| DoS | Huge search strings or page sizes | `q` ≤ 100 chars, `limit` ≤ 100 | 422 |
| Injection | Search text with SQL wildcards or quotes | parameterized `ILIKE` with `%`/`_` escaped | search for `%` matches literally |
| DoS | Huge CSV or row flood | ≤ 5 MB per file, ≤ 20,000 rows, ≤ 100 columns, checked on upload | 6 MB → 413 |
| Tampering | Malformed CSV (bad quotes, binary data) | strict parser; upload rejected with `INVALID_CSV` | garbage → 422 |
| Integrity | Worker crash mid-import re-imports rows | each row and its progress checkpoint commit in one transaction; retries resume from the checkpoint | process twice → same counts |
| Injection | Spreadsheet formula in the error report (`=HYPERLINK(…)`) | cells starting `= + - @` are prefixed with `'` | report cell escaped |
| Elevation | Import as another tenant or with a foreign owner | import rows bound to the uploader's organization; owner validated in the same org | cross-org → 404 / 422 |

### Slices

1. Schema + organization initialization: pipelines, stages, sources (with backfill)
2. Create lead via `ingestLead`, plus get lead, with a `lead.created` activity
3. List leads: filters (stage, owner incl. `me`/`unassigned`, source, tag, temperature, search) + cursor pagination
4. Update lead: fields, stage, owner, tags; archive; activities for each change
5. Web: leads list with filters, create form, lead detail with timeline
6. CSV import with a per-row report: upload → column mapping → queued job → worker runs `processLeadImport` from `@leadora/domain`, row by row through `ingestLead`
7. Custom fields

**Status (2026-10-08):** Sprint 3 is complete (slices 1–7, including custom fields with a settings UI). Verified with 94 API integration, 17 domain and 4 worker tests, plus mutation checks on LIKE escaping and formula escaping. In the browser: create, duplicate warning, edit, clear a field, stage and owner changes, archive, filters, and a full CSV import through the real worker.

Follow-ups noted, not done:
- Uploaded CSV content is stored in Postgres (≤ 5 MB); move it to object storage when the storage provider lands, and purge it after the import finishes.
- Import retries are safe, but the stale-job case (worker killed mid-row with no retry left) leaves status `PROCESSING`; a periodic sweeper should mark old ones `FAILED`.

## Phase 1 / Sprint 4 — Pipeline, assignment, follow-ups

Pipeline Kanban, assignment rules, follow-ups, tasks, notes, lead conversion to Contact + Company, dashboard metrics.

**Status (2026-10-08): done.** Acceptance met and verified in the browser. A lead was created, moved on the Kanban by drag-and-drop, given a note and a follow-up, the follow-up completed with an outcome, then the lead was converted to a contact, all without database intervention.

Decisions:
- Notes are immutable timeline activities (
ote.added), not a separate editable table.
- Tasks and contacts/companies reuse existing permission keys (ollowup.*, lead.*); the spec defines no 	ask.* or contact.* keys.
- Opportunities are not a separate entity yet. Forecasting uses lead budget × stage probability (spec §46).
- Assignment rules apply to automatic intake (CSV with auto-assign; webhooks/API later) and on demand; manual entry keeps the creator as owner.
- The dashboard's follow-up metric is "due in the next 24 hours" plus "overdue", which avoids timezone edge cases around "today".

Acceptance (Phase 1): a user can take a lead from creation to conversion without manual database intervention.
