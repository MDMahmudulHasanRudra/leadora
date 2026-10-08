import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { activities, aiAnalyses, conversations, type DbHandle, leads, messages } from '@leadora/database';
import { dataBlock, rescoreLeads, runStructured } from '@leadora/domain';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth-context';
import { DB } from '../infra/tokens';
import { conversationAnalysisSchema, type ReplyRequest, replySchema } from './ai.schemas';
import { AiService } from './ai.service';

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Conversation not found' });
const LANGUAGES = { en: 'English', bn: 'Bangla' } as const;

@Injectable()
export class ConversationAiService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly ai: AiService,
  ) {}

  /**
   * The thread as plain lines, oldest first, inside a data block. Internal notes help analysis but are
   * left out of reply drafting so they can never leak into a customer-facing message.
   */
  private async thread(auth: AuthContext, id: string, opts: { internalNotes: boolean }) {
    const [conv] = await this.handle.db
      .select({ id: conversations.id, subject: conversations.subject, leadId: leads.id, leadName: leads.fullName, company: leads.companyName })
      .from(conversations)
      .innerJoin(leads, eq(leads.id, conversations.leadId))
      .where(and(eq(conversations.id, id), eq(conversations.organizationId, auth.organizationId)));
    if (!conv) throw notFound();
    const rows = await this.handle.db
      .select({ direction: messages.direction, content: messages.content, createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.conversationId, id), opts.internalNotes ? undefined : ne(messages.direction, 'INTERNAL')))
      .orderBy(desc(messages.seq))
      .limit(40);
    const who = { INBOUND: 'CUSTOMER', OUTBOUND: 'US', INTERNAL: 'TEAM NOTE' } as const;
    const lines = rows
      .reverse()
      .map((m) => `${m.createdAt.toISOString()} ${who[m.direction]}: ${m.content.slice(0, 1500)}`)
      .join('\n');
    return {
      conv,
      blocks: [
        dataBlock('customer', JSON.stringify({ name: conv.leadName, company: conv.company, subject: conv.subject })),
        dataBlock('conversation', lines || '(no messages yet)'),
      ],
    };
  }

  async analyze(auth: AuthContext, id: string) {
    const { conv, blocks } = await this.thread(auth, id, { internalNotes: true });
    const { data, runId } = await runStructured(
      this.handle.db,
      this.ai.deps(),
      { organizationId: auth.organizationId, userId: auth.userId },
      {
        purpose: 'conversation_analysis',
        promptKey: 'conversation_analysis',
        schema: conversationAnalysisSchema,
        input: [`Today is ${new Date().toISOString().slice(0, 10)}. Analyse this conversation.`, ...blocks].join('\n\n'),
        entity: { type: 'conversation', id },
      },
    );
    await this.handle.db.transaction(async (tx) => {
      await tx.insert(aiAnalyses).values({ organizationId: auth.organizationId, entityType: 'conversation', entityId: id, purpose: 'conversation_analysis', runId, result: data });
      // The freshest AI view of the lead wins; the hybrid blend decides the final score (spec §14).
      await tx.update(leads).set({ aiScore: data.score }).where(eq(leads.id, conv.leadId));
      await rescoreLeads(tx, auth.organizationId, [conv.leadId]);
      await tx.insert(activities).values({
        organizationId: auth.organizationId,
        leadId: conv.leadId,
        actorUserId: auth.userId,
        type: 'ai.conversation_analyzed',
        payload: { conversationId: id, score: data.score, sentiment: data.sentiment, recommendedAction: data.recommendedNextAction },
      });
    });
    return data;
  }

  async latest(auth: AuthContext, id: string) {
    await this.thread(auth, id, { internalNotes: false });
    const [row] = await this.handle.db
      .select({ result: aiAnalyses.result, createdAt: aiAnalyses.createdAt })
      .from(aiAnalyses)
      .where(and(eq(aiAnalyses.organizationId, auth.organizationId), eq(aiAnalyses.entityId, id), eq(aiAnalyses.purpose, 'conversation_analysis')))
      .orderBy(desc(aiAnalyses.createdAt))
      .limit(1);
    if (!row) throw new NotFoundException({ code: 'NO_ANALYSIS', message: 'This conversation has not been analysed yet' });
    return row;
  }

  /** Drafts only — nothing is stored or sent. The agent edits and sends it as a normal message. */
  async reply(auth: AuthContext, id: string, req: ReplyRequest) {
    const { blocks } = await this.thread(auth, id, { internalNotes: false });
    const input = [
      `Mode: ${req.mode}`,
      `Language: ${LANGUAGES[req.language]}`,
      `Tone: ${req.tone}`,
      ...blocks,
      ...(req.draft ? [dataBlock('draft', req.draft)] : []),
    ].join('\n\n');
    const { data } = await runStructured(
      this.handle.db,
      this.ai.deps(),
      { organizationId: auth.organizationId, userId: auth.userId },
      { purpose: `reply_${req.mode}`, promptKey: 'reply_assistant', schema: replySchema, input, entity: { type: 'conversation', id } },
    );
    return data;
  }
}
