import { Inject, Injectable } from '@nestjs/common';
import type { DbHandle } from '@leadora/database';
import { dataBlock, retrieve, type RetrievedChunk, runStructured } from '@leadora/domain';
import { AiService } from '../ai/ai.service';
import type { AuthContext } from '../auth/auth-context';
import { DB } from '../infra/tokens';
import { answerSchema } from './knowledge.schemas';
import { viewerOf } from './knowledge.service';

const citation = (id: string, c: RetrievedChunk) => ({
  id,
  chunkId: c.chunkId,
  documentId: c.documentId,
  title: c.documentTitle,
  documentVersion: c.documentVersion,
  sourceType: c.sourceType,
  sourceUrl: c.sourceUrl,
  fileName: c.fileName,
  page: c.page,
  section: c.section,
  snippet: c.content.slice(0, 280),
});

/** A source block as the model sees it: id, where it comes from, then the text (spec §34). */
export const sourceBlock = (id: string, c: RetrievedChunk) =>
  dataBlock(id, `${c.documentTitle}${c.page ? `, page ${c.page}` : ''}${c.section ? ` — ${c.section}` : ''}\n${c.content}`);

@Injectable()
export class KnowledgeRagService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly ai: AiService,
  ) {}

  async search(auth: AuthContext, query: string, collectionIds?: string[]) {
    const items = await retrieve(this.handle.db, this.ai.deps(), viewerOf(auth), query, { collectionIds, purpose: 'kb_search' });
    return { items };
  }

  /** Spec §37 grounding: search first, answer only from what was found, cite it, admit when it isn't there. */
  async ask(auth: AuthContext, question: string, collectionIds?: string[]) {
    const chunks = await retrieve(this.handle.db, this.ai.deps(), viewerOf(auth), question, { collectionIds });
    if (chunks.length === 0) {
      return { answer: "I couldn't find this in your knowledge base.", citations: [], insufficientEvidence: true };
    }
    const sources = chunks.map((c, i) => ({ id: `S${i + 1}`, chunk: c }));
    const { data } = await runStructured(
      this.handle.db,
      this.ai.deps(),
      { organizationId: auth.organizationId, userId: auth.userId },
      {
        purpose: 'kb_answer',
        promptKey: 'kb_answer',
        schema: answerSchema,
        input: [dataBlock('question', question), ...sources.map((s) => sourceBlock(s.id, s.chunk))].join('\n\n'),
      },
    );
    // Only ids we actually supplied count as citations; anything else the model made up is dropped.
    const byId = new Map(sources.map((s) => [s.id, s.chunk]));
    const used = [...new Set(data.citations)].filter((id) => byId.has(id));
    return { answer: data.answer, citations: used.map((id) => citation(id, byId.get(id)!)), insufficientEvidence: data.insufficientEvidence };
  }
}
