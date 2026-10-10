import { ConflictException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { type DbHandle, kbChunks, kbCollections, kbDocuments, kbSettings, teams } from '@leadora/database';
import {
  assertFetchableUrl,
  collectionAccess,
  currentEmbeddingModel,
  detectFileType,
  documentStorageKey,
  type KnowledgeViewer,
  retrievalSettings,
  scanWithClamd,
  sha256,
} from '@leadora/domain';
import type { StorageProvider } from '@leadora/storage';
import type { Queue } from 'bullmq';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth-context';
import type { RequestMeta } from '../common/request-meta';
import { DB, EMBEDDINGS_QUEUE, ENV, STORAGE } from '../infra/tokens';
import type { Env } from '@leadora/config';
import type { CollectionInput } from './knowledge.schemas';

const MB = 1_048_576;

/** The parts of a multer upload we use (multer's global types are not loaded under `types: [node]`). */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}
const collectionNotFound = () => new NotFoundException({ code: 'COLLECTION_NOT_FOUND', message: 'Collection not found' });
const documentNotFound = () => new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' });

export const viewerOf = (auth: AuthContext): KnowledgeViewer => ({
  organizationId: auth.organizationId,
  userId: auth.userId,
  canManage: auth.permissions.has('knowledge.manage'),
});

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
    @Inject(STORAGE) private readonly storage: StorageProvider,
    @Inject(EMBEDDINGS_QUEUE) private readonly queue: Queue,
    private readonly audit: AuditService,
  ) {}

  // ---- collections ----

  async listCollections(auth: AuthContext) {
    const rows = await this.handle.db
      .select({
        id: kbCollections.id,
        name: kbCollections.name,
        description: kbCollections.description,
        visibility: kbCollections.visibility,
        teamIds: kbCollections.teamIds,
        documentCount: sql<number>`(select count(*)::int from ${kbDocuments} where ${kbDocuments.collectionId} = ${kbCollections.id})`,
        createdAt: kbCollections.createdAt,
      })
      .from(kbCollections)
      .where(and(eq(kbCollections.organizationId, auth.organizationId), collectionAccess(viewerOf(auth))))
      .orderBy(asc(kbCollections.name));
    return { items: rows };
  }

  /** Throws 404 for collections that don't exist or that the viewer can't see. */
  async getCollection(auth: AuthContext, id: string) {
    const [row] = await this.handle.db
      .select()
      .from(kbCollections)
      .where(and(eq(kbCollections.id, id), eq(kbCollections.organizationId, auth.organizationId), collectionAccess(viewerOf(auth))));
    if (!row) throw collectionNotFound();
    return row;
  }

  private async assertTeams(organizationId: string, teamIds: string[]) {
    if (!teamIds.length) return;
    const [{ n } = { n: 0 }] = await this.handle.db
      .select({ n: count() })
      .from(teams)
      .where(and(eq(teams.organizationId, organizationId), inArray(teams.id, teamIds)));
    if (n !== new Set(teamIds).size) throw new UnprocessableEntityException({ code: 'INVALID_TEAM', message: 'One of the teams does not exist' });
  }

  async createCollection(auth: AuthContext, input: CollectionInput, meta: RequestMeta) {
    await this.assertTeams(auth.organizationId, input.teamIds);
    return this.handle.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(kbCollections)
        .values({
          organizationId: auth.organizationId,
          name: input.name,
          description: input.description ?? null,
          visibility: input.visibility,
          teamIds: input.visibility === 'TEAMS' ? input.teamIds : [],
          createdByUserId: auth.userId,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new ConflictException({ code: 'COLLECTION_EXISTS', message: 'A collection with this name already exists' });
      await this.audit.record(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'kb.collection_created',
        resourceType: 'kb_collection',
        resourceId: row.id,
        newValues: { name: row.name, visibility: row.visibility, teamIds: row.teamIds },
        meta,
      });
      return row;
    });
  }

  async updateCollection(auth: AuthContext, id: string, input: CollectionInput, meta: RequestMeta) {
    const current = await this.getCollection(auth, id);
    await this.assertTeams(auth.organizationId, input.teamIds);
    return this.handle.db.transaction(async (tx) => {
      const [row] = await tx
        .update(kbCollections)
        .set({
          name: input.name,
          description: input.description ?? null,
          visibility: input.visibility,
          teamIds: input.visibility === 'TEAMS' ? input.teamIds : [],
        })
        .where(eq(kbCollections.id, id))
        .returning();
      await this.audit.record(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'kb.collection_updated',
        resourceType: 'kb_collection',
        resourceId: id,
        oldValues: { name: current.name, visibility: current.visibility, teamIds: current.teamIds },
        newValues: { name: row!.name, visibility: row!.visibility, teamIds: row!.teamIds },
        meta,
      });
      return row;
    });
  }

  async deleteCollection(auth: AuthContext, id: string, meta: RequestMeta) {
    const current = await this.getCollection(auth, id);
    const files = await this.handle.db.select({ key: kbDocuments.storageKey }).from(kbDocuments).where(eq(kbDocuments.collectionId, id));
    await this.handle.db.transaction(async (tx) => {
      await tx.delete(kbCollections).where(eq(kbCollections.id, id));
      await this.audit.record(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'kb.collection_deleted',
        resourceType: 'kb_collection',
        resourceId: id,
        oldValues: { name: current.name, documents: files.length },
        meta,
      });
    });
    await Promise.all(files.filter((f) => f.key).map((f) => this.removeFile(f.key)));
  }

  // ---- documents ----

  private async shapeDocuments(organizationId: string, rows: (typeof kbDocuments.$inferSelect)[]) {
    const model = await currentEmbeddingModel(this.handle.db, organizationId);
    return rows.map(({ storageKey: _key, organizationId: _org, ...d }) => ({
      ...d,
      // Spec §100 "Outdated": indexed with a model other than the current one, so excluded from retrieval.
      status: d.status === 'INDEXED' && d.embeddingModel !== model ? ('OUTDATED' as const) : d.status,
    }));
  }

  private documentScope(auth: AuthContext) {
    return and(eq(kbDocuments.organizationId, auth.organizationId), collectionAccess(viewerOf(auth)));
  }

  async listDocuments(auth: AuthContext, collectionId?: string) {
    const rows = await this.handle.db
      .select({ doc: kbDocuments })
      .from(kbDocuments)
      .innerJoin(kbCollections, eq(kbCollections.id, kbDocuments.collectionId))
      .where(and(this.documentScope(auth), collectionId ? eq(kbDocuments.collectionId, collectionId) : undefined))
      .orderBy(desc(kbDocuments.createdAt))
      .limit(500);
    return { items: await this.shapeDocuments(auth.organizationId, rows.map((r) => r.doc)) };
  }

  private async findDocument(auth: AuthContext, id: string) {
    const [row] = await this.handle.db
      .select({ doc: kbDocuments })
      .from(kbDocuments)
      .innerJoin(kbCollections, eq(kbCollections.id, kbDocuments.collectionId))
      .where(and(eq(kbDocuments.id, id), this.documentScope(auth)));
    if (!row) throw documentNotFound();
    return row.doc;
  }

  async getDocument(auth: AuthContext, id: string) {
    const [doc] = await this.shapeDocuments(auth.organizationId, [await this.findDocument(auth, id)]);
    return doc!;
  }

  async chunks(auth: AuthContext, id: string) {
    await this.findDocument(auth, id);
    const items = await this.handle.db
      .select({ id: kbChunks.id, ordinal: kbChunks.ordinal, page: kbChunks.page, section: kbChunks.section, content: kbChunks.content, documentVersion: kbChunks.documentVersion })
      .from(kbChunks)
      .where(eq(kbChunks.documentId, id))
      .orderBy(asc(kbChunks.ordinal))
      .limit(500);
    return { items };
  }

  async source(auth: AuthContext, id: string) {
    const doc = await this.findDocument(auth, id);
    if (!doc.storageKey) throw new NotFoundException({ code: 'NO_SOURCE', message: 'This document has no stored file yet' });
    const body = await this.storage.get(doc.storageKey);
    const fileName = doc.fileName ?? (doc.sourceType === 'URL' ? 'snapshot.txt' : `${doc.title}.txt`);
    // Only inert types are served as themselves; everything is an attachment with nosniff (spec §55).
    const contentType = doc.mimeType === 'application/pdf' || doc.mimeType.startsWith('text/') ? doc.mimeType : 'application/octet-stream';
    return { body, fileName, contentType };
  }

  private async enqueue(documentId: string) {
    // removeOnComplete lets a later re-index reuse the same id; the id dedupes clicks while a job is pending.
    await this.queue.add('kb.index', { documentId }, { jobId: `kb-index-${documentId}`, attempts: 3, backoff: { type: 'custom' }, removeOnComplete: true, removeOnFail: 100 });
  }

  private async createDocument(
    auth: AuthContext,
    meta: RequestMeta,
    values: { collectionId: string; title: string; sourceType: 'FILE' | 'TEXT' | 'URL'; sourceUrl?: string; fileName?: string; mimeType: string; body?: Buffer },
  ) {
    await this.getCollection(auth, values.collectionId);
    const hash = values.body ? sha256(values.body) : '';
    if (hash) {
      const [dup] = await this.handle.db
        .select({ id: kbDocuments.id })
        .from(kbDocuments)
        .where(and(eq(kbDocuments.collectionId, values.collectionId), eq(kbDocuments.sha256, hash)));
      if (dup) throw new ConflictException({ code: 'DUPLICATE_DOCUMENT', message: 'This collection already has this exact file', details: { documentId: dup.id } });
    }
    const id = crypto.randomUUID();
    const storageKey = values.body ? documentStorageKey(auth.organizationId, id, 1, values.fileName ?? 'document.txt') : '';
    // Store first: a database row must never point at a file that isn't there.
    if (values.body) await this.storage.put(storageKey, values.body, values.mimeType);
    const doc = await this.handle.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(kbDocuments)
        .values({
          id,
          organizationId: auth.organizationId,
          collectionId: values.collectionId,
          title: values.title,
          sourceType: values.sourceType,
          sourceUrl: values.sourceUrl ?? null,
          fileName: values.fileName ?? null,
          mimeType: values.mimeType,
          sizeBytes: values.body?.length ?? 0,
          sha256: hash,
          storageKey,
          createdByUserId: auth.userId,
        })
        .returning();
      await this.audit.record(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'kb.document_created',
        resourceType: 'kb_document',
        resourceId: id,
        newValues: { title: values.title, sourceType: values.sourceType, collectionId: values.collectionId, sizeBytes: values.body?.length ?? 0, sourceUrl: values.sourceUrl ?? null },
        meta,
      });
      return row!;
    });
    await this.enqueue(doc.id);
    const [shaped] = await this.shapeDocuments(auth.organizationId, [doc]);
    return shaped!;
  }

  async upload(auth: AuthContext, meta: RequestMeta, file: UploadedFileLike | undefined, fields: { collectionId: string; title?: string }) {
    if (!file) throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: 'Choose a file to upload', details: [{ path: 'file', message: 'Required' }] });
    // Multer gives latin1-decoded names; re-decode so Bangla and other UTF-8 file names survive.
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const { mimeType } = detectFileType(file.buffer, fileName, file.mimetype, this.env.KB_MAX_FILE_MB * MB);
    if (this.env.CLAMAV_HOST) await scanWithClamd(file.buffer, { host: this.env.CLAMAV_HOST, port: this.env.CLAMAV_PORT });
    return this.createDocument(auth, meta, {
      collectionId: fields.collectionId,
      title: fields.title ?? fileName.replace(/\.[^.]+$/, '').slice(0, 200),
      sourceType: 'FILE',
      fileName,
      mimeType,
      body: file.buffer,
    });
  }

  async addText(auth: AuthContext, meta: RequestMeta, input: { collectionId: string; title: string; text: string }) {
    return this.createDocument(auth, meta, {
      collectionId: input.collectionId,
      title: input.title,
      sourceType: 'TEXT',
      fileName: `${input.title}.txt`,
      mimeType: 'text/plain',
      body: Buffer.from(input.text, 'utf8'),
    });
  }

  async addUrl(auth: AuthContext, meta: RequestMeta, input: { collectionId: string; url: string; title?: string }) {
    // Validated here for a fast answer; the worker re-checks every resolved address and redirect.
    const url = assertFetchableUrl(input.url).toString();
    return this.createDocument(auth, meta, { collectionId: input.collectionId, title: input.title ?? url, sourceType: 'URL', sourceUrl: url, mimeType: 'text/plain' });
  }

  async reindex(auth: AuthContext, id: string) {
    await this.findDocument(auth, id);
    await this.handle.db.update(kbDocuments).set({ status: 'UPLOADED', error: null }).where(eq(kbDocuments.id, id));
    await this.enqueue(id);
    return { id, status: 'UPLOADED' as const };
  }

  async deleteDocument(auth: AuthContext, id: string, meta: RequestMeta) {
    const doc = await this.findDocument(auth, id);
    await this.handle.db.transaction(async (tx) => {
      await tx.delete(kbDocuments).where(eq(kbDocuments.id, id));
      await this.audit.record(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'kb.document_deleted',
        resourceType: 'kb_document',
        resourceId: id,
        oldValues: { title: doc.title, sourceType: doc.sourceType, collectionId: doc.collectionId },
        meta,
      });
    });
    if (doc.storageKey) await this.removeFile(doc.storageKey);
  }

  /** The row is already gone, so a storage hiccup must not fail the request; the orphan is logged. */
  private async removeFile(key: string) {
    await this.storage.delete(key).catch((err: Error) => this.logger.warn({ key, err: err.message }, 'kb.file_delete_failed'));
  }

  // ---- settings ----

  async getSettings(auth: AuthContext) {
    return retrievalSettings(this.handle.db, auth.organizationId);
  }

  async updateSettings(auth: AuthContext, input: { topK?: number; minSimilarity?: number }) {
    const values = { ...input, updatedAt: new Date() };
    await this.handle.db
      .insert(kbSettings)
      .values({ organizationId: auth.organizationId, ...values })
      .onConflictDoUpdate({ target: kbSettings.organizationId, set: values });
    return this.getSettings(auth);
  }
}
