# Architecture Decision Records

Format: Context → Decision → Consequences. Status is `Accepted` unless noted. Supersede an ADR by adding a new one; never rewrite history.

| ADR | Decision |
| --- | --- |
| [001](ADR-001-nestjs.md) | NestJS backend |
| [002](ADR-002-postgresql.md) | PostgreSQL primary database |
| [003](ADR-003-pgvector.md) | pgvector for embeddings |
| [004](ADR-004-valkey.md) | Valkey for cache/queue |
| [005](ADR-005-openai-responses-api.md) | OpenAI Responses API |
| [006](ADR-006-multi-tenancy.md) | Shared-schema multi-tenancy |
| [007](ADR-007-ai-provider-abstraction.md) | AI provider abstraction |
| [008](ADR-008-rag-strategy.md) | RAG strategy |
| [009](ADR-009-open-source-reuse.md) | Open-source reuse policy |
| [010](ADR-010-drizzle-orm.md) | Drizzle ORM + SQL migrations |
| [011](ADR-011-toolchain.md) | Toolchain versions & test runners |
| [012](ADR-012-sessions-and-identity.md) | Opaque sessions, platform-unique email, code-defined permissions |
| [013](ADR-013-domain-package.md) | Framework-free `@leadora/domain` shared by API and worker |
