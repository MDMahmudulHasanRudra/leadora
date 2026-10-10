import { Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type DbHandle, leads, pipelineStages, pipelines } from '@leadora/database';
import { and, asc, count, eq, isNull, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { DB } from '../infra/tokens';
import { LeadReader } from './lead-reader.service';

const querySchema = z.object({
  owner: z.union([z.literal('me'), z.literal('unassigned'), z.uuid()]).optional(),
  perStage: z.coerce.number().int().min(1).max(100).default(50),
});
type Query = z.infer<typeof querySchema>;

/** Kanban data (spec §98): every stage with its lead count and the newest cards. */
@ApiTags('pipelines')
@Controller('pipelines')
export class BoardController {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly reader: LeadReader,
  ) {}

  @Get(':id/board')
  @RequirePermission('lead.view')
  async board(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string, @Query(new ZodPipe(querySchema)) q: Query) {
    const [pipeline] = await this.handle.db
      .select({ id: pipelines.id, name: pipelines.name })
      .from(pipelines)
      .where(and(eq(pipelines.id, id), eq(pipelines.organizationId, auth.organizationId)));
    if (!pipeline) throw new NotFoundException({ code: 'PIPELINE_NOT_FOUND', message: 'Pipeline not found' });

    const filters: SQL[] = [eq(leads.pipelineId, id), isNull(leads.archivedAt)];
    if (q.owner === 'me') filters.push(eq(leads.ownerUserId, auth.userId));
    else if (q.owner === 'unassigned') filters.push(isNull(leads.ownerUserId));
    else if (q.owner) filters.push(eq(leads.ownerUserId, q.owner));

    const stages = await this.handle.db
      .select({
        id: pipelineStages.id,
        key: pipelineStages.key,
        name: pipelineStages.name,
        color: pipelineStages.color,
        outcome: pipelineStages.outcome,
        probability: pipelineStages.probability,
      })
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, id))
      .orderBy(asc(pipelineStages.position));
    const counts = await this.handle.db
      .select({ stageId: leads.stageId, n: count() })
      .from(leads)
      .where(and(eq(leads.organizationId, auth.organizationId), ...filters))
      .groupBy(leads.stageId);

    const columns = await Promise.all(
      stages.map(async (stage) => ({
        ...stage,
        count: Number(counts.find((c) => c.stageId === stage.id)?.n ?? 0),
        leads: await this.reader.find(auth, { where: and(eq(leads.stageId, stage.id), ...filters), limit: q.perStage }),
      })),
    );
    return { pipeline, stages: columns };
  }
}
