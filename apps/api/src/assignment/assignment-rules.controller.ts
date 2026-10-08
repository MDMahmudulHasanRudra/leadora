import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { assignmentRules, type DbHandle, teams, type Transaction, users } from '@leadora/database';
import { and, asc, eq, max } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { DB } from '../infra/tokens';

const list = (max: number) => z.array(z.string().trim().min(1).max(60)).max(max).optional();
const conditions = z
  .object({
    sourceTypes: z.array(z.enum(['MANUAL', 'CSV', 'WEBSITE', 'LANDING_PAGE', 'API', 'WEBHOOK', 'FACEBOOK', 'INSTAGRAM', 'WHATSAPP', 'EMAIL', 'REFERRAL', 'OTHER'])).optional(),
    countries: z.array(z.string().trim().toUpperCase().length(2)).max(50).optional(),
    tags: list(50),
    priorities: z.array(z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])).optional(),
  })
  .strict();

const base = {
  name: z.string().trim().min(1).max(100),
  conditions,
  strategy: z.enum(['USER', 'ROUND_ROBIN', 'LEAST_LOADED']),
  targetUserId: z.uuid().nullable().optional(),
  targetTeamId: z.uuid().nullable().optional(),
  enabled: z.boolean().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
};
const createSchema = z.object(base);
type CreateBody = z.infer<typeof createSchema>;
const updateSchema = z
  .object(base)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
type UpdateBody = z.infer<typeof updateSchema>;

const Id = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const notFound = () => new NotFoundException({ code: 'ASSIGNMENT_RULE_NOT_FOUND', message: 'Assignment rule not found' });
const invalidTarget = (message: string) => new UnprocessableEntityException({ code: 'INVALID_TARGET', message });

@ApiTags('assignment-rules')
@Controller('assignment-rules')
export class AssignmentRulesController {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** USER needs a user in this organization; team strategies need a team in this organization. */
  private async validateTarget(tx: Transaction, auth: AuthContext, v: { strategy: string; targetUserId?: string | null; targetTeamId?: string | null }) {
    if (v.strategy === 'USER') {
      if (!v.targetUserId) throw invalidTarget('Choose the user to assign to');
      const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, v.targetUserId), eq(users.organizationId, auth.organizationId)));
      if (!u) throw invalidTarget('User not found in your organization');
      return { targetUserId: v.targetUserId, targetTeamId: null };
    }
    if (!v.targetTeamId) throw invalidTarget('Choose the team to assign to');
    const [team] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.id, v.targetTeamId), eq(teams.organizationId, auth.organizationId)));
    if (!team) throw invalidTarget('Team not found in your organization');
    return { targetUserId: null, targetTeamId: v.targetTeamId };
  }

  @Get()
  @RequirePermission('lead.assign')
  async list(@CurrentAuth() auth: AuthContext) {
    const items = await this.handle.db
      .select()
      .from(assignmentRules)
      .where(eq(assignmentRules.organizationId, auth.organizationId))
      .orderBy(asc(assignmentRules.position), asc(assignmentRules.createdAt));
    return { items: items.map(({ organizationId: _o, lastAssignedUserId: _l, ...r }) => r) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('settings.manage')
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(createSchema)) body: CreateBody) {
    return this.handle.db.transaction(async (tx) => {
      const target = await this.validateTarget(tx, auth, body);
      const [{ top } = { top: null }] = await tx
        .select({ top: max(assignmentRules.position) })
        .from(assignmentRules)
        .where(eq(assignmentRules.organizationId, auth.organizationId));
      const [row] = await tx
        .insert(assignmentRules)
        .values({
          organizationId: auth.organizationId,
          name: body.name,
          conditions: body.conditions,
          strategy: body.strategy,
          enabled: body.enabled ?? true,
          position: body.position ?? (top ?? -1) + 1,
          ...target,
        })
        .returning();
      return row;
    });
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  update(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @Body(new ZodPipe(updateSchema)) body: UpdateBody) {
    return this.handle.db.transaction(async (tx) => {
      const scope = and(eq(assignmentRules.id, id), eq(assignmentRules.organizationId, auth.organizationId));
      const [current] = await tx.select().from(assignmentRules).where(scope).for('update');
      if (!current) throw notFound();
      const merged = { ...current, ...body };
      const target =
        body.strategy || body.targetUserId !== undefined || body.targetTeamId !== undefined ? await this.validateTarget(tx, auth, merged) : {};
      const [row] = await tx
        .update(assignmentRules)
        .set({ ...body, ...target, ...(body.strategy || body.targetTeamId !== undefined ? { lastAssignedUserId: null } : {}) })
        .where(scope)
        .returning();
      return row;
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    const deleted = await this.handle.db
      .delete(assignmentRules)
      .where(and(eq(assignmentRules.id, id), eq(assignmentRules.organizationId, auth.organizationId)))
      .returning({ id: assignmentRules.id });
    if (!deleted.length) throw notFound();
  }
}
