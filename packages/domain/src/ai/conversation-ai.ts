import { conversations, type Database, leads, messages } from '@leadora/database';
import { and, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { DomainError } from '../errors';
import { type KnowledgeViewer, retrieve, type RetrievedChunk, sourceBlock } from '../knowledge/retrieve';
import { type AiContext, type AiDeps, runStructured } from './gateway';
import { dataBlock } from './prompts';

/** Spec §32: suggest, rewrite and translate. The agent always reviews and sends. */
export const replyRequestSchema = z
  .object({
    mode: z.enum(['suggest', 'rewrite', 'translate']),
    draft: z.string().trim().max(20_000).optional(),
    language: z.enum(['en', 'bn']).default('en'),
    tone: z.enum(['friendly', 'formal', 'concise']).default('friendly'),
  })
  .refine((v) => v.mode === 'suggest' || !!v.draft, { path: ['draft'], message: 'Write a draft first' });
export type ReplyRequest = z.infer<typeof replyRequestSchema>;

export const replySchema = z.strictObject({
  reply: z.string().max(4000),
  language: z.enum(['en', 'bn']),
  notes: z.string().max(400),
  // Ids of knowledge-base sources (S1, S2…) the reply relies on; empty when none were given or used.
  citations: z.array(z.string().max(5)).max(8),
});

const LANGUAGES = { en: 'English', bn: 'Bangla' } as const;

/**
 * The thread as plain lines, oldest first, inside a data block. Internal notes help analysis but are
 * left out of reply drafting so they can never leak into a customer-facing message.
 */
export async function conversationThread(db: Database, organizationId: string, id: string, opts: { internalNotes: boolean }) {
  const [conv] = await db
    .select({ id: conversations.id, subject: conversations.subject, leadId: leads.id, leadName: leads.fullName, company: leads.companyName })
    .from(conversations)
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .where(and(eq(conversations.id, id), eq(conversations.organizationId, organizationId)));
  if (!conv) throw new DomainError('not_found', 'NOT_FOUND', 'Conversation not found');
  const rows = await db
    .select({ direction: messages.direction, content: messages.content, createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.conversationId, id), opts.internalNotes ? undefined : ne(messages.direction, 'INTERNAL')))
    .orderBy(desc(messages.seq))
    .limit(40);
  rows.reverse();
  const who = { INBOUND: 'CUSTOMER', OUTBOUND: 'US', INTERNAL: 'TEAM NOTE' } as const;
  const lines = rows.map((m) => `${m.createdAt.toISOString()} ${who[m.direction]}: ${m.content.slice(0, 1500)}`).join('\n');
  return {
    conv,
    lastCustomerMessage: rows.findLast((m) => m.direction === 'INBOUND')?.content ?? '',
    blocks: [
      dataBlock('customer', JSON.stringify({ name: conv.leadName, company: conv.company, subject: conv.subject })),
      dataBlock('conversation', lines || '(no messages yet)'),
    ],
  };
}

export interface ReplyKnowledge {
  /** Installation switch and the viewer's knowledge.view; retrieval is skipped when either is off. */
  enabled: boolean;
  viewer: KnowledgeViewer;
}

/**
 * Spec §37 grounding for replies: passages the viewer may see (same access filter as everywhere else).
 * Best effort — a draft still works when the knowledge base is off, empty or unavailable.
 */
async function knowledgeFor(db: Database, deps: AiDeps, kb: ReplyKnowledge | undefined, query: string, onError: (err: Error) => void) {
  if (!kb?.enabled || query.trim().length < 3) return [];
  try {
    const chunks = await retrieve(db, deps, kb.viewer, query.slice(0, 1000), { topK: 4, purpose: 'kb_reply' });
    return chunks.map((chunk, i) => ({ id: `S${i + 1}`, chunk }));
  } catch (err) {
    onError(err as Error);
    return [] as { id: string; chunk: RetrievedChunk }[];
  }
}

/** Drafts only — nothing is stored or sent here. */
export async function draftReply(
  db: Database,
  deps: AiDeps,
  ctx: AiContext,
  conversationId: string,
  req: ReplyRequest,
  kb?: ReplyKnowledge,
  onKnowledgeError: (err: Error) => void = () => undefined,
) {
  const { blocks, lastCustomerMessage } = await conversationThread(db, ctx.organizationId, conversationId, { internalNotes: false });
  const sources = req.mode === 'translate' ? [] : await knowledgeFor(db, deps, kb, req.mode === 'rewrite' && req.draft ? req.draft : lastCustomerMessage, onKnowledgeError);
  const input = [
    `Mode: ${req.mode}`,
    `Language: ${LANGUAGES[req.language]}`,
    `Tone: ${req.tone}`,
    ...blocks,
    ...sources.map((s) => sourceBlock(s.id, s.chunk)),
    ...(req.draft ? [dataBlock('draft', req.draft)] : []),
  ].join('\n\n');
  const { data } = await runStructured(db, deps, ctx, {
    purpose: `reply_${req.mode}`,
    promptKey: 'reply_assistant',
    schema: replySchema,
    input,
    entity: { type: 'conversation', id: conversationId },
  });
  // Only sources we supplied can be cited.
  const byId = new Map(sources.map((s) => [s.id, s.chunk]));
  const citations = [...new Set(data.citations)]
    .filter((sid) => byId.has(sid))
    .map((sid) => {
      const c = byId.get(sid)!;
      return { id: sid, documentId: c.documentId, title: c.documentTitle, page: c.page, section: c.section, sourceUrl: c.sourceUrl };
    });
  return { reply: data.reply, language: data.language, notes: data.notes, citations };
}
