import { ConflictException, ForbiddenException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { activities, type DbHandle, leadSources, leads, leadTagLinks, leadTags, pipelineStages, type Transaction } from '@leadora/database';
import { and, asc, eq, exists, ilike, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth-context';
import { decodeTimeCursor, encodeTimeCursor } from '../common/cursor';
import { DB } from '../infra/tokens';
import { leadNotFound, LeadReader } from './lead-reader.service';
import type { CreateLeadInput, ListLeadsQuery, UpdateLeadInput } from './leads.schemas';
import {
  escapeLike,
  findDuplicate,
  ingestLead,
  loadCustomFieldDefinitions,
  normalizeEmail,
  readCustomFields,
  validateCustomFields,
  writeCustomFields,
  normalizePhoneOrThrow,
  notifyLeadAssigned,
  pickOwnerByRules,
  resolveOwner,
  resolveSource,
  emitEvent,
  rescoreLeads,
  resolveStage,
  setLeadTags,
} from '@leadora/domain';

const TEXT_FIELDS = ['fullName', 'companyName', 'jobTitle', 'location', 'country', 'industry', 'currency', 'notes'] as const;

@Injectable()
export class LeadsService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly reader: LeadReader,
  ) {}

  async list(auth: AuthContext, q: ListLeadsQuery) {
    const filters: SQL[] = [q.archived === 'true' ? isNotNull(leads.archivedAt) : isNull(leads.archivedAt)];
    if (q.owner === 'me') filters.push(eq(leads.ownerUserId, auth.userId));
    else if (q.owner === 'unassigned') filters.push(isNull(leads.ownerUserId));
    else if (q.owner) filters.push(eq(leads.ownerUserId, q.owner));
    if (q.stageId) filters.push(eq(leads.stageId, q.stageId));
    if (q.sourceId) filters.push(eq(leads.sourceId, q.sourceId));
    if (q.priority) filters.push(eq(leads.priority, q.priority));
    if (q.temperature) filters.push(eq(leads.temperature, q.temperature));
    if (q.tag) {
      filters.push(
        exists(
          this.handle.db
            .select({ one: sql`1` })
            .from(leadTagLinks)
            .innerJoin(leadTags, eq(leadTags.id, leadTagLinks.tagId))
            .where(and(eq(leadTagLinks.leadId, leads.id), eq(leadTags.name, q.tag))),
        ),
      );
    }
    if (q.q) {
      const pattern = `%${escapeLike(q.q)}%`;
      filters.push(
        or(ilike(leads.fullName, pattern), ilike(leads.email, pattern), ilike(leads.phone, pattern), ilike(leads.companyName, pattern))!,
      );
    }
    if (q.cursor) {
      const c = decodeTimeCursor(q.cursor);
      filters.push(or(lt(leads.createdAt, c.createdAt), and(eq(leads.createdAt, c.createdAt), lt(leads.id, c.id)))!);
    }

    const rows = await this.reader.find(auth.organizationId, { where: and(...filters), limit: q.limit + 1 });
    const items = rows.slice(0, q.limit);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > q.limit && last ? encodeTimeCursor(last.createdAt, last.id) : null };
  }

  private async lockLead(tx: Transaction, organizationId: string, id: string) {
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), eq(leads.organizationId, organizationId)))
      .for('update');
    if (!lead) throw leadNotFound();
    return lead;
  }

  async update(auth: AuthContext, id: string, input: UpdateLeadInput) {
    return this.handle.db.transaction(async (tx) => {
      const current = await this.lockLead(tx, auth.organizationId, id);
      if (current.archivedAt) {
        throw new ConflictException({ code: 'LEAD_ARCHIVED', message: 'Restore this lead before editing it' });
      }

      const patch: Partial<typeof leads.$inferInsert> = {};
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const set = <K extends keyof typeof leads.$inferInsert>(key: K, from: unknown, to: (typeof leads.$inferInsert)[K]) => {
        if (from === to) return;
        patch[key] = to;
        changes[key] = { from, to };
      };

      if (input.email !== undefined) set('email', current.email, normalizeEmail(input.email));
      if (input.phone !== undefined) set('phone', current.phone, await normalizePhoneOrThrow(tx, auth.organizationId, input.phone));
      if (patch.email !== undefined || patch.phone !== undefined) {
        const dup = await findDuplicate(tx, auth.organizationId, patch.email ?? null, patch.phone ?? null, id);
        if (dup) {
          throw new ConflictException({
            code: 'LEAD_DUPLICATE',
            message: `Another lead already has this ${dup.matchedOn}`,
            details: dup,
          });
        }
      }

      for (const key of TEXT_FIELDS) {
        if (input[key] !== undefined) set(key, current[key], input[key] ?? null);
      }
      if (input.priority !== undefined) set('priority', current.priority, input.priority);
      if (input.budget !== undefined) {
        const from = current.budget === null ? null : Number(current.budget);
        if (from !== input.budget) {
          patch.budget = input.budget.toString();
          changes.budget = { from, to: input.budget };
        }
      }
      if (input.sourceId !== undefined && input.sourceId !== current.sourceId) {
        set('sourceId', current.sourceId, (await resolveSource(tx, auth.organizationId, input.sourceId, 'MANUAL')).id);
      }

      const activityRows: { type: string; payload: Record<string, unknown> }[] = [];
      let stageChange: { from: string; to: string; outcome: string } | null = null;

      if (input.ownerUserId !== undefined && input.ownerUserId !== current.ownerUserId) {
        if (!auth.permissions.has('lead.assign')) {
          throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to reassign leads' });
        }
        patch.ownerUserId = await resolveOwner(tx, auth.organizationId, input.ownerUserId);
        activityRows.push({ type: 'lead.assigned', payload: { from: current.ownerUserId, to: patch.ownerUserId } });
      }

      if (input.stageId !== undefined && input.stageId !== current.stageId) {
        const [from] = await tx.select({ key: pipelineStages.key }).from(pipelineStages).where(eq(pipelineStages.id, current.stageId));
        const stage = await resolveStage(tx, auth.organizationId, input.stageId, current.pipelineId);
        patch.stageId = stage.id;
        patch.convertedAt = stage.outcome === 'WON' ? new Date() : null;
        patch.lostAt = stage.outcome === 'LOST' ? new Date() : null;
        activityRows.push({ type: 'lead.stage_changed', payload: { from: from!.key, to: stage.key } });
        stageChange = { from: from!.key, to: stage.key, outcome: stage.outcome };
      }

      if (input.tags !== undefined) {
        const before = await this.tagNames(tx, id);
        await setLeadTags(tx, auth.organizationId, id, input.tags);
        const after = await this.tagNames(tx, id);
        if (before.join('\u0000').toLowerCase() !== after.join('\u0000').toLowerCase()) changes.tags = { from: before, to: after };
      }

      if (input.customFields !== undefined) {
        const values = validateCustomFields(await loadCustomFieldDefinitions(tx, auth.organizationId, 'lead'), input.customFields, 'update');
        const before = (await readCustomFields(tx, auth.organizationId, 'lead', [id])).get(id) ?? {};
        await writeCustomFields(tx, auth.organizationId, id, values);
        for (const [def, to] of values) {
          const from = before[def.key] ?? null;
          if (JSON.stringify(from) !== JSON.stringify(to)) changes[`customFields.${def.key}`] = { from, to };
        }
        // Custom-field-only edits still need updated_at to move.
        if (!Object.keys(patch).length && Object.keys(changes).length) patch.updatedAt = new Date();
      }

      if (Object.keys(patch).length) await tx.update(leads).set(patch).where(eq(leads.id, id));
      if (Object.keys(changes).length) activityRows.unshift({ type: 'lead.updated', payload: { changes } });
      if (activityRows.length) {
        await tx.insert(activities).values(
          activityRows.map((a) => ({ organizationId: auth.organizationId, leadId: id, actorUserId: auth.userId, ...a })),
        );
      }
      if (patch.ownerUserId !== undefined) {
        await notifyLeadAssigned(tx, {
          organizationId: auth.organizationId,
          leadId: id,
          leadName: (patch.fullName as string | undefined) ?? current.fullName,
          toUserId: patch.ownerUserId,
          actorUserId: auth.userId,
        });
      }
      if (Object.keys(changes).length) await rescoreLeads(tx, auth.organizationId, [id]);
      if (stageChange) {
        await emitEvent(tx, { organizationId: auth.organizationId, type: 'lead.stage_changed', leadId: id, actorUserId: auth.userId, payload: stageChange });
      }
      return this.reader.get(auth.organizationId, id, tx);
    });
  }

  /** Re-runs assignment rules for an existing lead (spec §17). */
  async autoAssign(auth: AuthContext, id: string) {
    return this.handle.db.transaction(async (tx) => {
      const current = await this.lockLead(tx, auth.organizationId, id);
      if (current.archivedAt) throw new ConflictException({ code: 'LEAD_ARCHIVED', message: 'Restore this lead first' });
      const [source] = await tx.select({ type: leadSources.type }).from(leadSources).where(eq(leadSources.id, current.sourceId));
      const pick = await pickOwnerByRules(tx, auth.organizationId, {
        sourceType: source!.type,
        country: current.country,
        tags: await this.tagNames(tx, id),
        priority: current.priority,
      });
      if (!pick) throw new UnprocessableEntityException({ code: 'NO_MATCHING_RULE', message: 'No assignment rule matches this lead' });
      if (pick.userId !== current.ownerUserId) {
        await tx.update(leads).set({ ownerUserId: pick.userId }).where(eq(leads.id, id));
        await notifyLeadAssigned(tx, {
          organizationId: auth.organizationId,
          leadId: id,
          leadName: current.fullName,
          toUserId: pick.userId,
          actorUserId: auth.userId,
          rule: pick.ruleName,
        });
        await tx.insert(activities).values({
          organizationId: auth.organizationId,
          leadId: id,
          actorUserId: auth.userId,
          type: 'lead.assigned',
          payload: { from: current.ownerUserId, to: pick.userId, assignmentRule: pick.ruleName },
        });
      }
      return this.reader.get(auth.organizationId, id, tx);
    });
  }

  /** Notes are immutable timeline entries (spec §20): corrections are new notes. */
  async addNote(auth: AuthContext, id: string, body: string) {
    return this.handle.db.transaction(async (tx) => {
      const current = await this.lockLead(tx, auth.organizationId, id);
      if (current.archivedAt) {
        throw new ConflictException({ code: 'LEAD_ARCHIVED', message: 'Restore this lead before adding notes' });
      }
      const [activity] = await tx
        .insert(activities)
        .values({ organizationId: auth.organizationId, leadId: id, actorUserId: auth.userId, type: 'note.added', payload: { body } })
        .returning({ id: activities.id, createdAt: activities.createdAt });
      await tx.update(leads).set({ updatedAt: new Date() }).where(eq(leads.id, id));
      return { ...activity, body };
    });
  }

  async setArchived(auth: AuthContext, id: string, archived: boolean) {
    return this.handle.db.transaction(async (tx) => {
      const current = await this.lockLead(tx, auth.organizationId, id);
      if (Boolean(current.archivedAt) !== archived) {
        await tx.update(leads).set({ archivedAt: archived ? new Date() : null }).where(eq(leads.id, id));
        await tx.insert(activities).values({
          organizationId: auth.organizationId,
          leadId: id,
          actorUserId: auth.userId,
          type: archived ? 'lead.archived' : 'lead.restored',
        });
      }
      return this.reader.get(auth.organizationId, id, tx);
    });
  }

  private async tagNames(tx: Transaction, leadId: string): Promise<string[]> {
    const rows = await tx
      .select({ name: leadTags.name })
      .from(leadTagLinks)
      .innerJoin(leadTags, eq(leadTags.id, leadTagLinks.tagId))
      .where(eq(leadTagLinks.leadId, leadId))
      .orderBy(asc(leadTags.name));
    return rows.map((r) => r.name);
  }

  async create(auth: AuthContext, input: CreateLeadInput) {
    if (input.ownerUserId !== undefined && input.ownerUserId !== auth.userId && !auth.permissions.has('lead.assign')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You can only create leads owned by yourself' });
    }
    return this.handle.db.transaction(async (tx) => {
      const result = await ingestLead(
        tx,
        { organizationId: auth.organizationId, actorUserId: auth.userId, sourceType: 'MANUAL' },
        input,
      );
      if (result.status === 'DUPLICATE') {
        throw new ConflictException({
          code: 'LEAD_DUPLICATE',
          message: `A lead with this ${result.matchedOn} already exists`,
          details: { existingLeadId: result.existingLeadId, matchedOn: result.matchedOn },
        });
      }
      return this.reader.get(auth.organizationId, result.leadId, tx);
    });
  }
}
