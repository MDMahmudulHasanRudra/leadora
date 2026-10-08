import {
  activities,
  conversations,
  type Database,
  followups,
  inboxes,
  leadSources,
  leadTagLinks,
  leadTags,
  leads,
  messages,
  pipelineStages,
  roles,
  type Transaction,
  userRoles,
  users,
} from '@leadora/database';
import { and, desc, eq, inArray, min, ne } from 'drizzle-orm';
import { z } from 'zod';
import { draftReply } from '../ai/conversation-ai';
import type { AiDeps } from '../ai/gateway';
import { analyzeLeadWithAi } from '../ai/lead-analysis';
import { pickOwnerByRules } from '../leads/assignment';
import { setLeadTags } from '../leads/ingestion';
import { notify, notifyLeadAssigned } from '../notifications';
import { rescoreLeads } from '../scoring/rescore';
import { renderTemplate } from './conditions';
import { emitEvent } from './events';

const H = 3_600_000;
const text = (max: number) => z.string().trim().min(1).max(max);

/** Spec §40 actions. The schema is the contract for the API, the UI and the runner. */
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('assign_lead'), params: z.object({ mode: z.enum(['user', 'rules']), userId: z.uuid().optional() }) }),
  z.object({ type: z.literal('change_stage'), params: z.object({ stageKey: text(50) }) }),
  z.object({ type: z.literal('change_priority'), params: z.object({ priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']) }) }),
  z.object({ type: z.literal('add_tag'), params: z.object({ tag: text(50) }) }),
  z.object({
    type: z.literal('create_followup'),
    params: z.object({
      type: z.enum(['CALL', 'EMAIL', 'MESSAGE', 'MEETING', 'CUSTOM']),
      inHours: z.number().min(0).max(24 * 90),
      notes: z.string().trim().max(2000).optional(),
      assignTo: z.enum(['owner', 'user']).default('owner'),
      userId: z.uuid().optional(),
    }),
  }),
  z.object({
    type: z.literal('send_notification'),
    params: z.object({ to: z.enum(['owner', 'managers', 'user']), userId: z.uuid().optional(), title: text(200), body: z.string().trim().max(1000).optional() }),
  }),
  z.object({ type: z.literal('send_email'), params: z.object({ inboxId: z.uuid(), subject: text(300), body: text(20_000) }) }),
  z.object({ type: z.literal('run_ai_analysis'), params: z.object({}) }),
  z.object({ type: z.literal('draft_ai_reply'), params: z.object({ language: z.enum(['en', 'bn']).default('en') }) }),
]);
export type ActionInput = z.infer<typeof actionSchema>;
export const ACTION_TYPES = actionSchema.options.map((o) => o.shape.type.value);

export interface AutomationDeps {
  ai: AiDeps;
  /** Queues an outbound message for the messages worker (same path as a human reply). */
  enqueueMessage: (messageId: string) => Promise<void>;
  knowledgeEnabled: boolean;
}

export interface ActionContext {
  organizationId: string;
  leadId: string;
}

export type ActionResult = { output: Record<string, unknown> } | { skipped: string };

const skip = (reason: string): ActionResult => ({ skipped: reason });

async function loadLead(tx: Transaction, ctx: ActionContext) {
  const [row] = await tx
    .select({ lead: leads, stageKey: pipelineStages.key, stageName: pipelineStages.name, sourceType: leadSources.type, ownerName: users.fullName })
    .from(leads)
    .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
    .innerJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .leftJoin(users, eq(users.id, leads.ownerUserId))
    .where(and(eq(leads.id, ctx.leadId), eq(leads.organizationId, ctx.organizationId)))
    .for('update', { of: leads });
  return row ?? null;
}

const templateValues = (l: NonNullable<Awaited<ReturnType<typeof loadLead>>>) => ({
  'lead.fullName': l.lead.fullName,
  'lead.firstName': l.lead.fullName.split(/\s+/)[0],
  'lead.companyName': l.lead.companyName,
  'lead.email': l.lead.email,
  'lead.phone': l.lead.phone,
  'lead.score': l.lead.score,
  'lead.temperature': l.lead.temperature?.toLowerCase(),
  'lead.stage': l.stageName,
  'lead.owner': l.ownerName,
});

async function activeUser(tx: Transaction, organizationId: string, userId: string) {
  const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.organizationId, organizationId), eq(users.status, 'ACTIVE')));
  return u?.id ?? null;
}

async function syncNextFollowup(tx: Transaction, leadId: string) {
  const [{ next } = { next: null }] = await tx
    .select({ next: min(followups.scheduledAt) })
    .from(followups)
    .where(and(eq(followups.leadId, leadId), eq(followups.status, 'PENDING')));
  await tx.update(leads).set({ nextFollowupAt: next ?? null }).where(eq(leads.id, leadId));
}

/** AI work happens before the step's transaction so no database transaction is held open during a model call. */
export async function prepareAction(db: Database, deps: AutomationDeps, ctx: ActionContext, action: ActionInput): Promise<Record<string, unknown> | null> {
  if (action.type === 'run_ai_analysis') {
    // analyzeLeadWithAi persists its own result; a crash before the step commits can at worst repeat an analysis.
    const data = await analyzeLeadWithAi(db, deps.ai, { organizationId: ctx.organizationId, userId: null }, ctx.leadId);
    return { score: data.score, recommendedAction: data.recommendedAction };
  }
  if (action.type === 'draft_ai_reply') {
    const [conv] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.leadId, ctx.leadId), eq(conversations.organizationId, ctx.organizationId), ne(conversations.status, 'RESOLVED')))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);
    if (!conv) return { skipped: 'The lead has no open conversation' };
    const draft = await draftReply(
      db,
      deps.ai,
      { organizationId: ctx.organizationId, userId: null },
      conv.id,
      { mode: 'suggest', language: action.params.language, tone: 'friendly' },
      // No user is behind an automation, so only organization-wide collections are used: a team-restricted
      // document must never surface in a note that every agent can read.
      { enabled: deps.knowledgeEnabled, viewer: { organizationId: ctx.organizationId, userId: '00000000-0000-0000-0000-000000000000', canManage: false } },
    );
    return { conversationId: conv.id, reply: draft.reply, notes: draft.notes, citations: draft.citations.map((c) => c.title) };
  }
  return null;
}

export async function applyAction(
  tx: Transaction,
  deps: AutomationDeps,
  ctx: ActionContext,
  action: ActionInput,
  prepared: Record<string, unknown> | null,
): Promise<ActionResult> {
  const l = await loadLead(tx, ctx);
  if (!l) return skip('The lead no longer exists');
  if (l.lead.archivedAt) return skip('The lead is archived');
  const lead = l.lead;

  switch (action.type) {
    case 'assign_lead': {
      let to: string | null;
      let rule: string | undefined;
      if (action.params.mode === 'user') {
        to = action.params.userId ? await activeUser(tx, ctx.organizationId, action.params.userId) : null;
        if (!to) return skip('The chosen user is not active in this organization');
      } else {
        const pick = await pickOwnerByRules(tx, ctx.organizationId, { sourceType: l.sourceType, country: lead.country, priority: lead.priority });
        if (!pick) return skip('No assignment rule matched');
        to = pick.userId;
        rule = pick.ruleName;
      }
      if (to === lead.ownerUserId) return skip('Already assigned to that user');
      await tx.update(leads).set({ ownerUserId: to }).where(eq(leads.id, lead.id));
      await tx.insert(activities).values({ organizationId: ctx.organizationId, leadId: lead.id, actorUserId: null, type: 'lead.assigned', payload: { from: lead.ownerUserId, to, automation: true } });
      await notifyLeadAssigned(tx, { organizationId: ctx.organizationId, leadId: lead.id, leadName: lead.fullName, toUserId: to, actorUserId: null, rule });
      return { output: { ownerUserId: to } };
    }
    case 'change_stage': {
      const [stage] = await tx
        .select()
        .from(pipelineStages)
        // Keys are stored upper-case; people type them any way.
        .where(and(eq(pipelineStages.pipelineId, lead.pipelineId), eq(pipelineStages.key, action.params.stageKey.toUpperCase())));
      if (!stage) return skip(`No stage "${action.params.stageKey}" in this lead's pipeline`);
      if (stage.id === lead.stageId) return skip('Already in that stage');
      await tx
        .update(leads)
        .set({ stageId: stage.id, convertedAt: stage.outcome === 'WON' ? new Date() : null, lostAt: stage.outcome === 'LOST' ? new Date() : null })
        .where(eq(leads.id, lead.id));
      await tx.insert(activities).values({ organizationId: ctx.organizationId, leadId: lead.id, actorUserId: null, type: 'lead.stage_changed', payload: { from: l.stageKey, to: stage.key, automation: true } });
      await emitEvent(tx, { organizationId: ctx.organizationId, type: 'lead.stage_changed', leadId: lead.id, payload: { from: l.stageKey, to: stage.key, outcome: stage.outcome } });
      return { output: { from: l.stageKey, to: stage.key } };
    }
    case 'change_priority': {
      if (lead.priority === action.params.priority) return skip('Priority is already set');
      await tx.update(leads).set({ priority: action.params.priority }).where(eq(leads.id, lead.id));
      await tx.insert(activities).values({
        organizationId: ctx.organizationId,
        leadId: lead.id,
        actorUserId: null,
        type: 'lead.updated',
        payload: { changes: { priority: { from: lead.priority, to: action.params.priority } }, automation: true },
      });
      return { output: { priority: action.params.priority } };
    }
    case 'add_tag': {
      const names = (
        await tx.select({ name: leadTags.name }).from(leadTagLinks).innerJoin(leadTags, eq(leadTags.id, leadTagLinks.tagId)).where(eq(leadTagLinks.leadId, lead.id))
      ).map((t) => t.name);
      if (names.some((n) => n.toLowerCase() === action.params.tag.toLowerCase())) return skip('The lead already has this tag');
      await setLeadTags(tx, ctx.organizationId, lead.id, [...names, action.params.tag]);
      await rescoreLeads(tx, ctx.organizationId, [lead.id]);
      return { output: { tag: action.params.tag } };
    }
    case 'create_followup': {
      const assignee = action.params.assignTo === 'user' && action.params.userId ? await activeUser(tx, ctx.organizationId, action.params.userId) : lead.ownerUserId;
      const scheduledAt = new Date(Date.now() + Math.max(action.params.inHours * H, 60_000));
      const [f] = await tx
        .insert(followups)
        .values({
          organizationId: ctx.organizationId,
          leadId: lead.id,
          assignedUserId: assignee,
          createdByUserId: null,
          type: action.params.type,
          priority: lead.priority,
          scheduledAt,
          notes: action.params.notes ? renderTemplate(action.params.notes, templateValues(l)) : null,
        })
        .returning({ id: followups.id });
      await syncNextFollowup(tx, lead.id);
      await tx.insert(activities).values({
        organizationId: ctx.organizationId,
        leadId: lead.id,
        actorUserId: null,
        type: 'followup.created',
        payload: { followupId: f!.id, type: action.params.type, scheduledAt: scheduledAt.toISOString(), automation: true },
      });
      return { output: { followupId: f!.id, scheduledAt: scheduledAt.toISOString(), assignedUserId: assignee } };
    }
    case 'send_notification': {
      const values = templateValues(l);
      let recipients: string[];
      if (action.params.to === 'owner') recipients = lead.ownerUserId ? [lead.ownerUserId] : [];
      else if (action.params.to === 'user') recipients = action.params.userId && (await activeUser(tx, ctx.organizationId, action.params.userId)) ? [action.params.userId] : [];
      else {
        const managers = await tx
          .selectDistinct({ id: users.id })
          .from(users)
          .innerJoin(userRoles, eq(userRoles.userId, users.id))
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(and(eq(users.organizationId, ctx.organizationId), eq(users.status, 'ACTIVE'), inArray(roles.key, ['ADMIN', 'MANAGER'])));
        recipients = managers.map((m) => m.id);
      }
      if (recipients.length === 0) return skip('Nobody to notify');
      for (const userId of recipients) {
        await notify(tx, {
          organizationId: ctx.organizationId,
          userId,
          type: 'automation',
          title: renderTemplate(action.params.title, values).slice(0, 200),
          body: action.params.body ? renderTemplate(action.params.body, values).slice(0, 1000) : null,
          link: `/leads/${lead.id}`,
          data: { leadId: lead.id },
        });
      }
      return { output: { notified: recipients.length } };
    }
    case 'send_email': {
      if (!lead.email) return skip('The lead has no email address');
      const [inbox] = await tx
        .select({ id: inboxes.id })
        .from(inboxes)
        .where(and(eq(inboxes.id, action.params.inboxId), eq(inboxes.organizationId, ctx.organizationId), eq(inboxes.enabled, true), eq(inboxes.channel, 'EMAIL')));
      if (!inbox) return skip('The email inbox is missing or disabled');
      const values = templateValues(l);
      const body = renderTemplate(action.params.body, values);
      let [conv] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.inboxId, inbox.id), eq(conversations.leadId, lead.id), ne(conversations.status, 'RESOLVED')))
        .orderBy(desc(conversations.lastMessageAt))
        .limit(1);
      conv ??= (
        await tx
          .insert(conversations)
          .values({ organizationId: ctx.organizationId, inboxId: inbox.id, leadId: lead.id, subject: renderTemplate(action.params.subject, values).slice(0, 300) })
          .returning({ id: conversations.id })
      )[0];
      const [msg] = await tx
        .insert(messages)
        .values({ organizationId: ctx.organizationId, conversationId: conv!.id, direction: 'OUTBOUND', senderType: 'SYSTEM', content: body, status: 'QUEUED' })
        .returning({ id: messages.id, createdAt: messages.createdAt });
      await tx
        .update(conversations)
        .set({ lastDirection: 'OUTBOUND', lastMessageAt: msg!.createdAt, lastMessagePreview: body.slice(0, 140), status: 'OPEN' })
        .where(eq(conversations.id, conv!.id));
      // Enqueued before commit, like human replies: the sender skips messages it can't find.
      await deps.enqueueMessage(msg!.id);
      return { output: { conversationId: conv!.id, messageId: msg!.id } };
    }
    case 'run_ai_analysis':
      return { output: prepared ?? {} };
    case 'draft_ai_reply': {
      if (!prepared || 'skipped' in prepared) return skip(String(prepared?.skipped ?? 'Nothing to reply to'));
      await tx.insert(messages).values({
        organizationId: ctx.organizationId,
        conversationId: String(prepared.conversationId),
        direction: 'INTERNAL',
        senderType: 'AI',
        content: `AI-suggested reply — review before sending:\n\n${String(prepared.reply)}${prepared.notes ? `\n\nNote: ${String(prepared.notes)}` : ''}`,
        status: 'SENT',
        sentAt: new Date(),
        aiGenerated: true,
      });
      return { output: { conversationId: prepared.conversationId, citations: prepared.citations } };
    }
  }
}
