# ADR-002: PostgreSQL as primary database

**Context.** CRM data is relational (leads, contacts, companies, pipelines, assignments) and needs transactions, constraints, full-text search and reporting.

**Decision.** PostgreSQL 17 (PostgreSQL License). All business truth lives here (spec §2.1). Timestamps are `timestamptz` in UTC. UUID primary keys come from `gen_random_uuid()`. Emails use `citext`.

**Consequences.** One durable store to back up and restore. Full-text search starts in Postgres (spec §130). The schema changes only through migrations (ADR-010).
