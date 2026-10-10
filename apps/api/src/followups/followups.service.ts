import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { activities, type DbHandle, followups, leads, type Transaction, users } from '@leadora/database';
import { leadVisibility, rescoreLeads } from '@leadora/domain';
import { aliasedTable, and, asc, desc, eq, gte, inArray, lt, min, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../auth/auth-context';
import { leadNotFound, type Viewer } from '../leads/lead-reader.service';
import { DB } from '../infra/tokens';

const TYPES = ['CALL', 'EMAIL', 'MESSAGE', 'MEETING', 'CUSTOM'] as const;
const CONTACT_TYPES = new Set(['CALL', 'EMAIL', 'MESSAGE', 'MEETING']);

export const createFollowupSchema = z.object({
  type: z.enum(TYPES),
  scheduledAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
  notes: z.string().trim().max(2000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assignedUserId: z.uuid().optional(),
});
export type CreateFollowupInput = z.infer<typeof createFollowupSchema>;

export const updateFollowupSchema = z
  .object({
    status: z.enum(['COMPLETED', 'SKIPPED', 'CANCELLED']),
    outcome: z.string().trim().max(2000),
    scheduledAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
    notes: z.string().trim().max(2000),
    type: z.enum(TYPES),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateFollowupInput = z.infer<typeof updateFollowupSchema>;

export const listFollowupsSchema = z.object({
  assignee: z.union([z.literal('me'), z.uuid()]).optional(),
  status: z.enum(['pending', 'overdue', 'upcoming', 'completed', 'all']).default('pending'),
  leadId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListFollowupsQuery = z.infer<typeof listFollowupsSchema>;

const notFound = () => new NotFoundException({ code: 'FOLLOWUP_NOT_FOUND', message: 'Follow-up not found' });
const assignee = aliasedTable(users, 'assignee');

@Injectable()
export class FollowupsService {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** Follow-ups are visible when their lead is (agents: own and unassigned leads). */
  private async find(db: DbHandle['db'] | Transaction, viewer: Viewer, where: SQL, order: SQL[], limit = 100) {
    const rows = await db
      .select({
        id: followups.id,
        type: followups.type,
        status: followups.status,
        priority: followups.priority,
        scheduledAt: followups.scheduledAt,
        notes: followups.notes,
        outcome: followups.outcome,
        completedAt: followups.completedAt,
        createdAt: followups.createdAt,
        leadId: leads.id,
        leadName: leads.fullName,
        assigneeId: assignee.id,
        assigneeName: assignee.fullName,
      })
      .from(followups)
      .innerJoin(leads, eq(leads.id, followups.leadId))
      .leftJoin(assignee, eq(assignee.id, followups.assignedUserId))
      .where(and(eq(followups.organizationId, viewer.organizationId), leadVisibility(viewer), where))
      .orderBy(...order)
      .limit(limit);
    const now = Date.now();
    return rows.map(({ leadId, leadName, assigneeId, assigneeName, ...f }) => ({
      ...f,
      overdue: f.status === 'PENDING' && f.scheduledAt.getTime() < now,
      lead: { id: leadId, fullName: leadName },
      assignee: assigneeId ? { id: assigneeId, fullName: assigneeName } : null,
    }));
  }

  private async get(db: DbHandle['db'] | Transaction, viewer: Viewer, id: string) {
    const [row] = await this.find(db, viewer, eq(followups.id, id), []);
    if (!row) throw notFound();
    return row;
  }

  list(auth: AuthContext, q: ListFollowupsQuery) {
    const now = new Date();
    const filters: SQL[] = [];
    if (q.assignee) filters.push(eq(followups.assignedUserId, q.assignee === 'me' ? auth.userId : q.assignee));
    if (q.leadId) filters.push(eq(followups.leadId, q.leadId));
    if (q.status === 'pending') filters.push(eq(followups.status, 'PENDING'));
    if (q.status === 'overdue') filters.push(eq(followups.status, 'PENDING'), lt(followups.scheduledAt, now));
    if (q.status === 'upcoming') filters.push(eq(followups.status, 'PENDING'), gte(followups.scheduledAt, now));
    if (q.status === 'completed') filters.push(inArray(followups.status, ['COMPLETED', 'SKIPPED', 'CANCELLED']));
    const order = q.status === 'completed' ? [desc(followups.completedAt)] : [asc(followups.scheduledAt)];
    return this.find(this.handle.db, auth, and(...filters) ?? eq(followups.organizationId, auth.organizationId), order, q.limit);
  }

  /** Keeps leads.next_followup_at equal to the earliest pending follow-up (spec §8). */
  private async syncLead(tx: Transaction, leadId: string, contacted: boolean) {
    const [{ next } = { next: null }] = await tx
      .select({ next: min(followups.scheduledAt) })
      .from(followups)
      .where(and(eq(followups.leadId, leadId), eq(followups.status, 'PENDING')));
    await tx
      .update(leads)
      .set({ nextFollowupAt: next ?? null, ...(contacted ? { lastContactedAt: new Date() } : {}) })
      .where(eq(leads.id, leadId));
  }

  async create(auth: AuthContext, leadId: string, input: CreateFollowupInput) {
    return this.handle.db.transaction(async (tx) => {
      const [lead] = await tx
        .select({ id: leads.id, ownerUserId: leads.ownerUserId, archivedAt: leads.archivedAt })
        .from(leads)
        .where(and(eq(leads.id, leadId), eq(leads.organizationId, auth.organizationId), leadVisibility(auth)))
        .for('update');
      if (!lead) throw leadNotFound();
      if (lead.archivedAt) throw new ConflictException({ code: 'LEAD_ARCHIVED', message: 'Restore this lead first' });

      const target = input.assignedUserId ?? auth.userId;
      if (target !== auth.userId && !auth.permissions.has('lead.assign')) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You can only schedule follow-ups for yourself' });
      }
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, target), eq(users.organizationId, auth.organizationId), eq(users.status, 'ACTIVE')));
      if (!user) throw new UnprocessableEntityException({ code: 'INVALID_ASSIGNEE', message: 'Assignee must be an active user in your organization' });

      const [row] = await tx
        .insert(followups)
        .values({
          organizationId: auth.organizationId,
          leadId,
          assignedUserId: target,
          createdByUserId: auth.userId,
          type: input.type,
          scheduledAt: input.scheduledAt,
          notes: input.notes || null,
          priority: input.priority ?? 'MEDIUM',
        })
        .returning({ id: followups.id });
      await tx.insert(activities).values({
        organizationId: auth.organizationId,
        leadId,
        actorUserId: auth.userId,
        type: 'followup.created',
        payload: { followupId: row!.id, type: input.type, scheduledAt: input.scheduledAt.toISOString(), assignedUserId: target },
      });
      await this.syncLead(tx, leadId, false);
      return this.get(tx, auth, row!.id);
    });
  }

  async update(auth: AuthContext, id: string, input: UpdateFollowupInput) {
    return this.handle.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(followups)
        .where(
          and(
            eq(followups.id, id),
            eq(followups.organizationId, auth.organizationId),
            inArray(followups.leadId, tx.select({ id: leads.id }).from(leads).where(and(eq(leads.organizationId, auth.organizationId), leadVisibility(auth)))),
          ),
        )
        .for('update');
      if (!current) throw notFound();
      if (current.status !== 'PENDING') {
        throw new ConflictException({ code: 'FOLLOWUP_CLOSED', message: 'This follow-up is already closed' });
      }
      if (input.status && current.assignedUserId !== auth.userId && !auth.permissions.has('lead.assign')) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only the assignee or a manager can close this follow-up' });
      }

      await tx
        .update(followups)
        .set({
          ...(input.type ? { type: input.type } : {}),
          ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
          ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
          ...(input.outcome !== undefined ? { outcome: input.outcome || null } : {}),
          ...(input.status ? { status: input.status, completedAt: new Date() } : {}),
          ...(input.scheduledAt ? { remindedAt: null } : {}),
        })
        .where(eq(followups.id, id));

      const type = input.status
        ? `followup.${input.status.toLowerCase()}`
        : input.scheduledAt
          ? 'followup.rescheduled'
          : 'followup.updated';
      await tx.insert(activities).values({
        organizationId: auth.organizationId,
        leadId: current.leadId,
        actorUserId: auth.userId,
        type,
        payload: {
          followupId: id,
          type: input.type ?? current.type,
          ...(input.outcome ? { outcome: input.outcome } : {}),
          ...(input.scheduledAt ? { from: current.scheduledAt.toISOString(), to: input.scheduledAt.toISOString() } : {}),
        },
      });
      await this.syncLead(tx, current.leadId, input.status === 'COMPLETED' && CONTACT_TYPES.has(input.type ?? current.type));
      if (input.status === 'COMPLETED') await rescoreLeads(tx, auth.organizationId, [current.leadId]);
      return this.get(tx, auth, id);
    });
  }
}
