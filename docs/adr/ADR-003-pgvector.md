# ADR-003: pgvector for embeddings

**Context.** The knowledge base and semantic search need vector similarity. A separate vector database adds infrastructure, backups and a second consistency boundary.

**Decision.** Use the `vector` extension inside the primary Postgres (image `pgvector/pgvector:pg17`). It's enabled in migration `0000`. HNSW indexes get added per embedding table when that table exists. Qdrant (Apache-2.0) is the documented scale-out option, adopted only when measured load requires it (spec §36).

**Consequences.** Retrieval can join vectors with permission and tenant metadata in one SQL query (spec §35). Embedding dimension is fixed per column, so changing embedding models requires a re-index migration.
