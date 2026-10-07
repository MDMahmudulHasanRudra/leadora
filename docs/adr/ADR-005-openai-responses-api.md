# ADR-005: OpenAI Responses API as first provider

**Status.** Accepted. Implementation is in Phase 3.

**Context.** OpenAI's Assistants API was sunset on 2026-08-26. New integrations use the Responses API, which supports tool calling and structured outputs.

**Decision.** The first `AiProvider` implementation (ADR-007) targets the Responses API. Model IDs come from configuration (logical profiles `fast`, `balanced`, `reasoning`, `embedding`; spec §123) and are never hard-coded. The API key stays server-side and is never returned by GET endpoints.

**Consequences.** Upgrading models is a configuration change. Usage accounting must separate model tokens from tool charges (spec §28).
