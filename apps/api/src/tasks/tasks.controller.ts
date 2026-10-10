import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type DbHandle, leads, tasks, type Transaction, users } from '@leadora/database';
import { aliasedTable, and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { DB } from '../infra/tokens';
import type { Viewer } from '../leads/lead-reader.service';
import { leadVisibility } from '@leadora/domain';

const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const dueAt = z.iso.datetime({ offset: true }).transform((s) => new Date(s)).nullable();

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  dueAt: dueAt.optional(),
  priority: priority.optional(),
  assignedUserId: z.uuid().optional(),
  leadId: z.uuid().optional(),
  checklist: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
});
type CreateBody = z.infer<typeof createSchema>;

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000),
    dueAt,
    priority,
    status: z.enum(['OPEN', 'DONE']),
    assignedUserId: z.uuid(),
    checklist: z.array(z.object({ text: z.string().trim().min(1).max(200), done: z.boolean() })).max(50),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
type UpdateBody = z.infer<typeof updateSchema>;

const listSchema = z.object({
  assignee: z.union([z.literal('me'), z.uuid()]).optional(),
  status: z.enum(['open', 'done', 'all']).default('open'),
  leadId: z.uuid().optional(),
});
type ListQuery = z.infer<typeof listSchema>;

const Id = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const notFound = () => new NotFoundException({ code: 'TASK_NOT_FOUND', message: 'Task not found' });
const assignee = aliasedTable(users, 'assignee');

// Tasks reuse the follow-up permissions: the spec defines no separate task.* permissions.
@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** Tasks stay visible to their viewers; the linked lead is shown only when the viewer may see it. */
  private async find(db: DbHandle['db'] | Transaction, viewer: Viewer, where?: SQL, order: SQL[] = []) {
    const { organizationId } = viewer;
    const rows = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        priority: tasks.priority,
        dueAt: tasks.dueAt,
        checklist: tasks.checklist,
        completedAt: tasks.completedAt,
        createdAt: tasks.createdAt,
        leadId: leads.id,
        leadName: leads.fullName,
        assigneeId: assignee.id,
        assigneeName: assignee.fullName,
      })
      .from(tasks)
      .leftJoin(leads, and(eq(leads.id, tasks.leadId), leadVisibility(viewer)))
      .leftJoin(assignee, eq(assignee.id, tasks.assignedUserId))
      .where(and(eq(tasks.organizationId, organizationId), where))
      .orderBy(...order)
      .limit(200);
    return rows.map(({ leadId, leadName, assigneeId, assigneeName, ...task }) => ({
      ...task,
      lead: leadId ? { id: leadId, fullName: leadName } : null,
      assignee: assigneeId ? { id: assigneeId, fullName: assigneeName } : null,
    }));
  }

  private async get(db: DbHandle['db'] | Transaction, viewer: Viewer, id: string) {
    const [task] = await this.find(db, viewer, eq(tasks.id, id));
    if (!task) throw notFound();
    return task;
  }

  private async checkAssignee(tx: Transaction, auth: AuthContext, userId: string) {
    if (userId !== auth.userId && !auth.permissions.has('lead.assign')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You can only assign tasks to yourself' });
    }
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, auth.organizationId), eq(users.status, 'ACTIVE')));
    if (!user) throw new UnprocessableEntityException({ code: 'INVALID_ASSIGNEE', message: 'Assignee must be an active user in your organization' });
  }

  @Get()
  @RequirePermission('followup.view')
  async list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(listSchema)) q: ListQuery) {
    const filters: SQL[] = [];
    if (q.assignee) filters.push(eq(tasks.assignedUserId, q.assignee === 'me' ? auth.userId : q.assignee));
    if (q.leadId) filters.push(eq(tasks.leadId, q.leadId));
    if (q.status !== 'all') filters.push(eq(tasks.status, q.status === 'open' ? 'OPEN' : 'DONE'));
    const order = q.status === 'done' ? [desc(tasks.completedAt)] : [asc(tasks.dueAt), asc(tasks.createdAt)];
    return { items: await this.find(this.handle.db, auth, and(...filters), order) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('followup.create')
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(createSchema)) body: CreateBody) {
    return this.handle.db.transaction(async (tx) => {
      const target = body.assignedUserId ?? auth.userId;
      await this.checkAssignee(tx, auth, target);
      if (body.leadId) {
        const [lead] = await tx
          .select({ id: leads.id })
          .from(leads)
          .where(and(eq(leads.id, body.leadId), eq(leads.organizationId, auth.organizationId), leadVisibility(auth)));
        if (!lead) throw new UnprocessableEntityException({ code: 'INVALID_LEAD', message: 'Lead not found' });
      }
      const [row] = await tx
        .insert(tasks)
        .values({
          organizationId: auth.organizationId,
          title: body.title,
          description: body.description || null,
          dueAt: body.dueAt ?? null,
          priority: body.priority ?? 'MEDIUM',
          assignedUserId: target,
          createdByUserId: auth.userId,
          leadId: body.leadId ?? null,
          checklist: (body.checklist ?? []).map((text) => ({ text, done: false })),
        })
        .returning({ id: tasks.id });
      return this.get(tx, auth, row!.id);
    });
  }

  @Patch(':id')
  @RequirePermission('followup.complete')
  update(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @Body(new ZodPipe(updateSchema)) body: UpdateBody) {
    return this.handle.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.organizationId, auth.organizationId)))
        .for('update');
      if (!current) throw notFound();
      if (body.assignedUserId && body.assignedUserId !== current.assignedUserId) await this.checkAssignee(tx, auth, body.assignedUserId);
      const statusChange =
        body.status && body.status !== current.status ? { completedAt: body.status === 'DONE' ? new Date() : null } : {};
      await tx
        .update(tasks)
        .set({ ...body, ...statusChange, ...(body.description !== undefined ? { description: body.description || null } : {}) })
        .where(eq(tasks.id, id));
      return this.get(tx, auth, id);
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('followup.complete')
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    const deleted = await this.handle.db
      .delete(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organizationId, auth.organizationId)))
      .returning({ id: tasks.id });
    if (!deleted.length) throw notFound();
  }
}
