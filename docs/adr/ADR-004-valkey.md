# ADR-004: Valkey for cache, queues and ephemeral state

**Context.** We need queues, rate limiting and caching. Redis 8+ is tri-licensed (RSALv2 / SSPLv1 / AGPLv3).

**Decision.** Valkey 8 (BSD-3-Clause), wire-compatible with Redis clients. BullMQ provides the queues. It runs with AOF persistence and `maxmemory-policy noeviction`, because evicting queue keys would silently lose jobs.

**Consequences.** Standard `ioredis` / BullMQ clients work unchanged. If caching is added to the same instance, cache keys must carry TTLs, because `noeviction` will reject writes when memory is full. A separate cache instance is the fix if this becomes a problem.
