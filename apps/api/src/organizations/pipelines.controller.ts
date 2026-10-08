import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type DbHandle, leadSources, pipelineStages, pipelines } from '@leadora/database';
import { asc, desc, eq } from 'drizzle-orm';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { DB } from '../infra/tokens';

@ApiTags('pipelines')
@Controller()
export class PipelinesController {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  @Get('pipelines')
  @RequirePermission('lead.view')
  async pipelines(@CurrentAuth() auth: AuthContext) {
    const rows = await this.handle.db
      .select({ id: pipelines.id, name: pipelines.name, isDefault: pipelines.isDefault })
      .from(pipelines)
      .where(eq(pipelines.organizationId, auth.organizationId))
      .orderBy(desc(pipelines.isDefault), asc(pipelines.name));
    const stages = await this.handle.db
      .select({
        id: pipelineStages.id,
        pipelineId: pipelineStages.pipelineId,
        key: pipelineStages.key,
        name: pipelineStages.name,
        position: pipelineStages.position,
        probability: pipelineStages.probability,
        outcome: pipelineStages.outcome,
        color: pipelineStages.color,
      })
      .from(pipelineStages)
      .where(eq(pipelineStages.organizationId, auth.organizationId))
      .orderBy(asc(pipelineStages.position));

    return {
      items: rows.map((p) => ({
        ...p,
        stages: stages.filter((s) => s.pipelineId === p.id).map(({ pipelineId: _p, ...s }) => s),
      })),
    };
  }

  @Get('lead-sources')
  @RequirePermission('lead.view')
  async sources(@CurrentAuth() auth: AuthContext) {
    const items = await this.handle.db
      .select({ id: leadSources.id, type: leadSources.type, name: leadSources.name, enabled: leadSources.enabled })
      .from(leadSources)
      .where(eq(leadSources.organizationId, auth.organizationId))
      .orderBy(asc(leadSources.name));
    return { items };
  }
}
