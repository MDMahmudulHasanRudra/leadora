import { createHash } from 'node:crypto';
import { type Database, EMBEDDING_DIMENSIONS, kbChunks, kbDocuments } from '@leadora/database';
import type { StorageProvider } from '@leadora/storage';
import { eq } from 'drizzle-orm';
import { type AiDeps, runEmbedding } from '../ai/gateway';
import { DomainError } from '../errors';
import { chunkSections } from './chunk';
import type { DocumentKind } from './detect';
import { extractSections, htmlToText } from './parse';
import { type FetchedPage, robotsAllows, safeFetch } from './safe-fetch';

export interface KnowledgeDeps {
  ai: AiDeps;
  storage: StorageProvider;
  /** Injectable for tests; defaults to the SSRF-safe fetcher. */
  fetchPage?: (url: string) => Promise<FetchedPage>;
}

const EMBED_BATCH = 64;

const KIND_BY_MIME: Record<string, DocumentKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'text',
  'text/markdown': 'markdown',
  'text/csv': 'csv',
  'text/html': 'html',
};

export const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

/** Storage keys are built here only, from ids and a sanitized name (never raw user input). */
export function documentStorageKey(organizationId: string, documentId: string, version: number, fileName: string): string {
  const safe = fileName.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '').slice(-100) || 'file';
  return `orgs/${organizationId}/kb/${documentId}/v${version}/${safe}`;
}

/** Spec §79: fetch a page politely (robots.txt) and keep its readable text as a snapshot. */
async function snapshotUrl(url: string, fetchPage: (url: string) => Promise<FetchedPage>): Promise<{ text: string; title: string | null }> {
  const u = new URL(url);
  const robots = await fetchPage(`${u.origin}/robots.txt`).catch(() => null);
  if (robots && /text\/plain/i.test(robots.contentType) && !robotsAllows(robots.body.toString('utf8'), u.pathname)) {
    throw new DomainError('invalid', 'URL_DISALLOWED', 'This site does not allow automated access to that page (robots.txt)');
  }
  const page = await fetchPage(url);
  const type = page.contentType.toLowerCase();
  const raw = page.body.toString('utf8');
  if (type.includes('text/html')) {
    const title = raw.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1]?.trim() ?? null;
    return { text: htmlToText(raw), title };
  }
  if (type.includes('text/plain')) return { text: raw, title: null };
  throw new DomainError('invalid', 'UNSUPPORTED_PAGE', 'Only web pages and plain-text URLs can be imported');
}

/**
 * Spec §33 lifecycle: UPLOADED → PROCESSING → INDEXED | FAILED. Re-running is safe: chunks are replaced in one
 * transaction. Transient AI/network failures rethrow so the queue retries (until `finalAttempt`); bad input
 * fails the document immediately with a readable reason.
 */
export async function indexDocument(db: Database, deps: KnowledgeDeps, documentId: string, opts: { finalAttempt: boolean }) {
  const [doc] = await db.update(kbDocuments).set({ status: 'PROCESSING', error: null }).where(eq(kbDocuments.id, documentId)).returning();
  if (!doc) return { status: 'SKIPPED' as const };
  const ctx = { organizationId: doc.organizationId, userId: doc.createdByUserId };

  try {
    let buf: Buffer;
    let kind: DocumentKind;
    if (doc.sourceType === 'URL') {
      // URL documents are re-fetched on every (re-)index, so "Re-index" means "refresh".
      const { text, title } = await snapshotUrl(doc.sourceUrl!, deps.fetchPage ?? ((u) => safeFetch(u)));
      buf = Buffer.from(text, 'utf8');
      kind = 'text';
      const hash = sha256(buf);
      if (hash !== doc.sha256) {
        const version = doc.sha256 ? doc.version + 1 : doc.version;
        const storageKey = documentStorageKey(doc.organizationId, doc.id, version, 'snapshot.txt');
        await deps.storage.put(storageKey, buf, 'text/plain');
        await db
          .update(kbDocuments)
          .set({ version, storageKey, sha256: hash, sizeBytes: buf.length, ...(title && doc.title === doc.sourceUrl ? { title } : {}) })
          .where(eq(kbDocuments.id, doc.id));
        // The previous snapshot is superseded; keep storage from growing with every refresh.
        if (doc.storageKey && doc.storageKey !== storageKey) await deps.storage.delete(doc.storageKey).catch(() => undefined);
        doc.version = version;
        doc.storageKey = storageKey;
      }
    } else {
      buf = await deps.storage.get(doc.storageKey);
      kind = KIND_BY_MIME[doc.mimeType] ?? 'text';
    }

    const chunks = chunkSections(await extractSections(buf, kind));
    if (chunks.length === 0) throw new DomainError('invalid', 'NO_TEXT', 'No readable text was found in this document');

    const vectors: number[][] = [];
    let model = '';
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const res = await runEmbedding(db, deps.ai, ctx, {
        purpose: 'kb_index',
        // The heading travels with the text so a chunk is findable by its section title.
        input: batch.map((c) => (c.section ? `${c.section}\n\n${c.content}` : c.content)),
        dimensions: EMBEDDING_DIMENSIONS,
        entity: { type: 'kb_document', id: doc.id },
      });
      vectors.push(...res.vectors);
      model = res.model;
    }

    await db.transaction(async (tx) => {
      await tx.delete(kbChunks).where(eq(kbChunks.documentId, doc.id));
      for (let i = 0; i < chunks.length; i += 200) {
        await tx.insert(kbChunks).values(
          chunks.slice(i, i + 200).map((c, j) => ({
            organizationId: doc.organizationId,
            collectionId: doc.collectionId,
            documentId: doc.id,
            documentVersion: doc.version,
            ordinal: c.ordinal,
            content: c.content,
            section: c.section,
            page: c.page,
            embedding: vectors[i + j]!,
          })),
        );
      }
      await tx
        .update(kbDocuments)
        .set({ status: 'INDEXED', chunkCount: chunks.length, embeddingModel: model, indexedAt: new Date(), error: null })
        .where(eq(kbDocuments.id, doc.id));
    });
    return { status: 'INDEXED' as const, chunks: chunks.length };
  } catch (err) {
    const transient = err instanceof DomainError ? err.kind === 'upstream' : true;
    if (transient && !opts.finalAttempt) throw err;
    const message = err instanceof DomainError ? err.message : 'Indexing failed unexpectedly';
    await db.update(kbDocuments).set({ status: 'FAILED', error: message.slice(0, 500) }).where(eq(kbDocuments.id, doc.id));
    return { status: 'FAILED' as const, error: message };
  }
}
