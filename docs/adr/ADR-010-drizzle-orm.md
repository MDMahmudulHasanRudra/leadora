# ADR-010: Drizzle ORM with generated SQL migrations

**Context.** We need typed queries, reviewable SQL migrations and first-class pgvector support. Prisma represents `vector` columns as `Unsupported` and hides SQL behind its own engine.

**Decision.** Drizzle ORM (Apache-2.0) with `drizzle-kit generate`. Migrations are plain SQL committed to `packages/database/migrations` and reviewed in PRs. Hand edits are allowed for things Drizzle can't express (e.g. `CREATE EXTENSION`), as long as the snapshot still matches the schema. They're applied by the one-shot `migrate` container or `pnpm db:migrate`. Naming: `NNNN_<description>.sql`.

**Consequences.** CI runs migrations against an empty database twice and fails on schema drift. Production schema is never edited by hand (spec §62).
