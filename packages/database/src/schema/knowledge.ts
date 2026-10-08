import { sql } from 'drizzle-orm';
import { customType, index, integer, pgEnum, pgTable, real, text, timestamp, unique, uuid, varchar, vector } from 'drizzle-orm/pg-core';
import { id } from './columns';
import { organizations } from './organizations';
import { users } from './users';

const ms = { withTimezone: true, precision: 3 } as const;

/** Every embedding is requested at this size, so one HNSW index serves all models (spec §36). */
export const EMBEDDING_DIMENSIONS = 1536;

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const kbVisibility = pgEnum('kb_visibility', ['ORGANIZATION', 'TEAMS']);
export const kbSourceType = pgEnum('kb_source_type', ['FILE', 'URL', 'TEXT']);
// Spec §33/§100. OUTDATED is derived (indexed with an embedding model other than the current one), never stored.
export const kbDocumentStatus = pgEnum('kb_document_status', ['UPLOADED', 'PROCESSING', 'INDEXED', 'FAILED']);

// Spec §35: the collection carries the access scope; documents and chunks inherit it.
export const kbCollections = pgTable(
  'kb_collections',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text(),
    visibility: kbVisibility().notNull().default('ORGANIZATION'),
    teamIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp(ms).notNull().defaultNow(),
    updatedAt: timestamp(ms)
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique('kb_collections_org_name_unique').on(t.organizationId, t.name)],
);

export const kbDocuments = pgTable(
  'kb_documents',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    collectionId: uuid()
      .notNull()
      .references(() => kbCollections.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    sourceType: kbSourceType().notNull(),
    sourceUrl: text(),
    fileName: text(),
    mimeType: varchar({ length: 100 }).notNull(),
    sizeBytes: integer().notNull(),
    sha256: varchar({ length: 64 }).notNull(),
    // The original (or URL snapshot) in object storage, so the document can be re-indexed.
    storageKey: text().notNull(),
    version: integer().notNull().default(1),
    status: kbDocumentStatus().notNull().default('UPLOADED'),
    error: text(),
    chunkCount: integer().notNull().default(0),
    embeddingModel: varchar({ length: 100 }),
    indexedAt: timestamp(ms),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp(ms).notNull().defaultNow(),
    updatedAt: timestamp(ms)
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('kb_documents_org_collection_idx').on(t.organizationId, t.collectionId, t.createdAt.desc())],
);

// Spec §34: every chunk keeps document id + version, page/section, ordinal and its access scope (collection).
export const kbChunks = pgTable(
  'kb_chunks',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    collectionId: uuid()
      .notNull()
      .references(() => kbCollections.id, { onDelete: 'cascade' }),
    documentId: uuid()
      .notNull()
      .references(() => kbDocuments.id, { onDelete: 'cascade' }),
    documentVersion: integer().notNull(),
    ordinal: integer().notNull(),
    content: text().notNull(),
    section: text(),
    page: integer(),
    embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    // 'simple' config: no stemming, so Bangla and mixed-language text is matched as written.
    search: tsvector().generatedAlwaysAs(sql`to_tsvector('simple', coalesce(section, '') || ' ' || content)`),
    createdAt: timestamp(ms).notNull().defaultNow(),
  },
  (t) => [
    index('kb_chunks_document_idx').on(t.documentId, t.ordinal),
    index('kb_chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('kb_chunks_search_idx').using('gin', t.search),
  ],
);

// Spec §33 "Retrieval Settings". Only overrides are stored; defaults live in code.
export const kbSettings = pgTable('kb_settings', {
  organizationId: uuid()
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  topK: integer(),
  minSimilarity: real(),
  updatedAt: timestamp(ms).notNull().defaultNow(),
});

export type KbCollection = typeof kbCollections.$inferSelect;
export type KbDocument = typeof kbDocuments.$inferSelect;
