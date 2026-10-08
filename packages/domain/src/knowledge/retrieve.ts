import { type Database, EMBEDDING_DIMENSIONS, kbChunks, kbCollections, kbDocuments, kbSettings, teamMembers } from '@leadora/database';
import { and, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import { type AiContext, type AiDeps, runEmbedding } from '../ai/gateway';

export interface KnowledgeViewer {
  organizationId: string;
  userId: string;
  /** knowledge.manage sees every collection. */
  canManage: boolean;
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentVersion: number;
  collectionId: string;
  sourceType: 'FILE' | 'URL' | 'TEXT';
  sourceUrl: string | null;
  fileName: string | null;
  page: number | null;
  section: string | null;
  content: string;
  similarity: number | null;
  score: number;
}

export const RETRIEVAL_DEFAULTS = { topK: 6, minSimilarity: 0.25 };
const CANDIDATES = 30;
// Reciprocal rank fusion constant (Cormack et al.); 60 is the usual choice.
const RRF_K = 60;

/** Spec §35: the access filter every retrieval path shares, applied inside the query. */
export function collectionAccess(viewer: KnowledgeViewer): SQL | undefined {
  if (viewer.canManage) return undefined;
  const myTeams = sql`array(select ${teamMembers.teamId} from ${teamMembers} where ${teamMembers.userId} = ${viewer.userId})::uuid[]`;
  return or(eq(kbCollections.visibility, 'ORGANIZATION'), and(eq(kbCollections.visibility, 'TEAMS'), sql`${kbCollections.teamIds} && ${myTeams}`));
}

export async function retrievalSettings(db: Database, organizationId: string) {
  const [row] = await db.select().from(kbSettings).where(eq(kbSettings.organizationId, organizationId));
  return { topK: row?.topK ?? RETRIEVAL_DEFAULTS.topK, minSimilarity: row?.minSimilarity ?? RETRIEVAL_DEFAULTS.minSimilarity };
}

/**
 * Hybrid retrieval (spec §36): vector similarity and Postgres full-text search, fused by reciprocal rank.
 * Only INDEXED documents embedded with the org's current model are searched — vectors from different models
 * are not comparable.
 */
export async function retrieve(
  db: Database,
  deps: AiDeps,
  viewer: KnowledgeViewer,
  query: string,
  opts: { collectionIds?: string[]; topK?: number; purpose?: string } = {},
): Promise<RetrievedChunk[]> {
  const settings = await retrievalSettings(db, viewer.organizationId);
  const topK = opts.topK ?? settings.topK;
  const ctx: AiContext = { organizationId: viewer.organizationId, userId: viewer.userId };
  const { vectors, model } = await runEmbedding(db, deps, ctx, { purpose: opts.purpose ?? 'kb_query', input: [query], dimensions: EMBEDDING_DIMENSIONS });
  const qvec = `[${vectors[0]!.join(',')}]`;

  const scope = and(
    eq(kbChunks.organizationId, viewer.organizationId),
    eq(kbDocuments.status, 'INDEXED'),
    eq(kbDocuments.embeddingModel, model),
    collectionAccess(viewer),
    opts.collectionIds?.length ? inArray(kbChunks.collectionId, opts.collectionIds) : undefined,
  );
  const fields = {
    chunkId: kbChunks.id,
    documentId: kbDocuments.id,
    documentTitle: kbDocuments.title,
    documentVersion: kbChunks.documentVersion,
    collectionId: kbChunks.collectionId,
    sourceType: kbDocuments.sourceType,
    sourceUrl: kbDocuments.sourceUrl,
    fileName: kbDocuments.fileName,
    page: kbChunks.page,
    section: kbChunks.section,
    content: kbChunks.content,
  };
  const base = () =>
    db
      .select({ ...fields, similarity: sql<number>`1 - (${kbChunks.embedding} <=> ${qvec}::vector)` })
      .from(kbChunks)
      .innerJoin(kbDocuments, eq(kbDocuments.id, kbChunks.documentId))
      .innerJoin(kbCollections, eq(kbCollections.id, kbChunks.collectionId));

  const tsQuery = sql`websearch_to_tsquery('simple', ${query})`;
  const [semantic, keyword] = await Promise.all([
    base()
      .where(scope)
      .orderBy(sql`${kbChunks.embedding} <=> ${qvec}::vector`)
      .limit(CANDIDATES),
    base()
      .where(and(scope, sql`${kbChunks.search} @@ ${tsQuery}`))
      .orderBy(sql`ts_rank(${kbChunks.search}, ${tsQuery}) desc`)
      .limit(CANDIDATES),
  ]);

  const fused = new Map<string, RetrievedChunk>();
  const add = (rows: typeof semantic, keep: (r: (typeof semantic)[number]) => boolean) =>
    rows.forEach((r, rank) => {
      if (!keep(r)) return;
      const prev = fused.get(r.chunkId);
      const similarity = Number(r.similarity);
      fused.set(r.chunkId, { ...r, similarity, score: (prev?.score ?? 0) + 1 / (RRF_K + rank + 1) });
    });
  // A semantic hit must clear the similarity floor; a keyword hit is evidence on its own.
  add(semantic, (r) => Number(r.similarity) >= settings.minSimilarity);
  add(keyword, () => true);
  return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, topK);
}
