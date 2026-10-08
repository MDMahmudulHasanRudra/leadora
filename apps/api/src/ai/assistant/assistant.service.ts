import { Inject, Injectable } from '@nestjs/common';
import { aiAssistantQueries, type DbHandle, leadSourceType, pipelineStages, pipelines } from '@leadora/database';
import { dataBlock, runStructured } from '@leadora/domain';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { AuthContext } from '../../auth/auth-context';
import { DB } from '../../infra/tokens';
import { LeadReader } from '../../leads/lead-reader.service';
import { AiService } from '../ai.service';
import {
  conversationsNeedingAttention,
  listFollowups,
  searchLeads,
  sourcePerformance,
  teamPerformance,
  TOOL_ACCESS,
  type ToolResult,
} from './assistant-tools';
import { answerSchema, type Plan, planSchema } from './assistant.schemas';

type Status = 'ANSWERED' | 'DENIED' | 'UNSUPPORTED';

/**
 * Spec §38 pipeline: question → typed plan (model) → permission check → read-only tool (code) → summary (model).
 * The model never sees data it was not entitled to and never chooses SQL; it only picks a tool and its arguments.
 */
@Injectable()
export class AssistantService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly ai: AiService,
    private readonly reader: LeadReader,
  ) {}

  private async vocabulary(organizationId: string) {
    const stages = await this.handle.db
      .select({ key: pipelineStages.key, name: pipelineStages.name, outcome: pipelineStages.outcome })
      .from(pipelineStages)
      .innerJoin(pipelines, and(eq(pipelines.id, pipelineStages.pipelineId), eq(pipelines.isDefault, true)))
      .where(eq(pipelineStages.organizationId, organizationId))
      .orderBy(asc(pipelineStages.position));
    return { stages, sources: leadSourceType.enumValues };
  }

  private run(auth: AuthContext, plan: Plan): Promise<ToolResult> {
    const db = this.handle.db;
    switch (plan.tool) {
      case 'search_leads':
        return searchLeads(db, this.reader, auth, plan.leads ?? {});
      case 'team_performance':
        return teamPerformance(db, auth, plan.periodDays ?? 30);
      case 'source_performance':
        return sourcePerformance(db, auth, plan.periodDays);
      case 'list_followups':
        return listFollowups(db, auth, plan.followups ?? 'overdue', plan.mineOnly ?? false);
      case 'conversations_needing_attention':
        return conversationsNeedingAttention(db, auth);
      case 'unsupported':
        throw new Error('unreachable');
    }
  }

  async query(auth: AuthContext, question: string) {
    const ctx = { organizationId: auth.organizationId, userId: auth.userId };
    const vocab = await this.vocabulary(auth.organizationId);
    const { data: plan } = await runStructured(this.handle.db, this.ai.deps(), ctx, {
      purpose: 'assistant_plan',
      promptKey: 'assistant_planner',
      schema: planSchema,
      input: [
        `Today is ${new Date().toISOString().slice(0, 10)}.`,
        dataBlock('question', question),
        dataBlock('stages', JSON.stringify(vocab.stages)),
        dataBlock('sources', JSON.stringify(vocab.sources)),
      ].join('\n\n'),
    });

    const finish = async (status: Status, results: ToolResult | null, answer: string, highlights: string[] = []) => {
      await this.handle.db.insert(aiAssistantQueries).values({
        organizationId: auth.organizationId,
        userId: auth.userId,
        question,
        tool: plan.tool,
        plan,
        status,
        resultCount: results ? results.items.length : null,
        answer,
      });
      return { status, question, plan: { tool: plan.tool, explanation: plan.explanation, args: plan }, results, answer, highlights };
    };

    if (plan.tool === 'unsupported') return finish('UNSUPPORTED', null, plan.explanation);
    const access = TOOL_ACCESS[plan.tool];
    if (!auth.permissions.has(access.permission)) {
      return finish('DENIED', null, `You don't have permission to see ${access.label}, so I can't answer that.`);
    }

    const results = await this.run(auth, plan);
    if (results.items.length === 0) return finish('ANSWERED', results, 'Nothing matched this question.');

    const { data } = await runStructured(this.handle.db, this.ai.deps(), ctx, {
      purpose: 'assistant_answer',
      promptKey: 'assistant_answer',
      schema: answerSchema,
      input: [dataBlock('question', question), dataBlock('interpretation', plan.explanation), dataBlock('results', JSON.stringify(results))].join('\n\n'),
    });
    return finish('ANSWERED', results, data.answer, data.highlights);
  }

  async history(auth: AuthContext) {
    const items = await this.handle.db
      .select({
        id: aiAssistantQueries.id,
        question: aiAssistantQueries.question,
        tool: aiAssistantQueries.tool,
        status: aiAssistantQueries.status,
        resultCount: aiAssistantQueries.resultCount,
        answer: aiAssistantQueries.answer,
        createdAt: aiAssistantQueries.createdAt,
      })
      .from(aiAssistantQueries)
      .where(and(eq(aiAssistantQueries.organizationId, auth.organizationId), eq(aiAssistantQueries.userId, auth.userId)))
      .orderBy(desc(aiAssistantQueries.createdAt))
      .limit(20);
    return { items };
  }
}
