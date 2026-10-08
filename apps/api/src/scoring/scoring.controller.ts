import { Body, Controller, Get, Inject, Put, UnprocessableEntityException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type DbHandle, scoringSettings } from '@leadora/database';
import { loadScoringConfig, RULE_KEYS, RULE_LABELS, type ScoringConfig } from '@leadora/domain';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DEFAULT_QUEUE } from '../infra/tokens';

const ruleSchema = z.strictObject({ enabled: z.boolean(), points: z.number().int().min(-100).max(100) });
const weight = z.number().int().min(0).max(100);
const threshold = z.number().int().min(1).max(100);

const updateSchema = z
  .strictObject({
    ruleWeight: weight,
    aiWeight: weight,
    hotThreshold: threshold,
    warmThreshold: threshold,
    rules: z.partialRecord(z.enum(RULE_KEYS), ruleSchema),
  })
  .partial();
type UpdateInput = z.infer<typeof updateSchema>;

const view = (c: ScoringConfig) => ({
  ruleWeight: c.ruleWeight,
  aiWeight: c.aiWeight,
  hotThreshold: c.hotThreshold,
  warmThreshold: c.warmThreshold,
  rules: RULE_KEYS.map((key) => ({ key, label: RULE_LABELS[key], ...c.rules[key] })),
});

@ApiTags('scoring')
@Controller('scoring')
export class ScoringController {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(DEFAULT_QUEUE) private readonly queue: Queue,
  ) {}

  @Get('settings')
  @RequirePermission('settings.manage')
  async get(@CurrentAuth() auth: AuthContext) {
    return view(await loadScoringConfig(this.handle.db, auth.organizationId));
  }

  @Put('settings')
  @RequirePermission('settings.manage')
  async update(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(updateSchema)) body: UpdateInput) {
    const current = await loadScoringConfig(this.handle.db, auth.organizationId);
    const next = { ...current, ...body, rules: { ...current.rules, ...body.rules } };
    if (next.warmThreshold >= next.hotThreshold) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: [{ path: 'warmThreshold', message: 'The warm threshold must be below the hot threshold' }],
      });
    }
    const values = {
      rules: next.rules,
      ruleWeight: next.ruleWeight,
      aiWeight: next.aiWeight,
      hotThreshold: next.hotThreshold,
      warmThreshold: next.warmThreshold,
      updatedByUserId: auth.userId,
      updatedAt: new Date(),
    };
    await this.handle.db
      .insert(scoringSettings)
      .values({ organizationId: auth.organizationId, ...values })
      .onConflictDoUpdate({ target: scoringSettings.organizationId, set: values });
    // Every lead's score may move; recompute in the background. Same jobId → a burst of saves runs once.
    await this.queue.add('scoring.rescore_org', { organizationId: auth.organizationId }, { jobId: `rescore-${auth.organizationId}`, delay: 2000, removeOnComplete: true });
    return view(next);
  }
}
