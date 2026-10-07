# ADR-008: RAG strategy

**Status.** Accepted. Implementation is in Phase 5.

**Decision.** Pipeline: upload → parse → chunk → embed (worker `embeddings` queue) → `knowledge_chunks` with pgvector. Retrieval filters by `organization_id`, knowledge-base permissions and document permissions **before** similarity ranking. Chunks keep document ID, version, page/section and source. Answers cite sources. Document content is untrusted data and is never treated as instructions (spec §56–57).

**Consequences.** A new document version triggers a re-index, and old chunks are marked outdated. The RAG evaluation fixtures (spec §66) gate prompt changes.
