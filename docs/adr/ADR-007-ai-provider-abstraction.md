# ADR-007: AI provider abstraction

**Status.** Accepted. Implementation is in Phase 3.

**Context.** Business logic must not depend on one vendor (spec §2.3).

**Decision.** `packages/ai` will define `AiProvider` with `generate`, `generateStructured`, `embed`, `moderate`, `stream` and `toolCall`. `OpenAiProvider` is the first implementation. Every call goes through a gateway that enforces per-organization budget, rate limits and feature flags, validates structured output with Zod (with one retry on failure), and writes an `ai_runs` row.

**Consequences.** Anthropic, Google or local providers can be added without touching domain code. If AI is disabled or failing, the CRM keeps working (spec §121).
