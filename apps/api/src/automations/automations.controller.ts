import {
  Body,
  type CanActivate,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Env } from '@leadora/config';
import type { z } from 'zod';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ReqMeta, type RequestMeta } from '../common/request-meta';
import { ZodPipe } from '../common/zod.pipe';
import { ENV } from '../infra/tokens';
import { type RuleInput, ruleSchema, runsQuerySchema, testSchema, toggleSchema } from './automations.schemas';
import { AutomationsService } from './automations.service';

const Id = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@Injectable()
class AutomationEnabledGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}
  canActivate() {
    if (!this.env.ENABLE_AUTOMATION) throw new ConflictException({ code: 'AUTOMATION_DISABLED', message: 'Automations are turned off for this installation' });
    return true;
  }
}

@ApiTags('automations')
@Controller('automations')
@UseGuards(AutomationEnabledGuard)
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get('meta')
  @RequirePermission('automation.view')
  meta() {
    return this.automations.meta();
  }

  @Get('runs')
  @RequirePermission('automation.view')
  runs(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(runsQuerySchema)) q: z.infer<typeof runsQuerySchema>) {
    return this.automations.runs(auth, q);
  }

  @Get('runs/:id')
  @RequirePermission('automation.view')
  run(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return this.automations.run(auth, id);
  }

  @Post('runs/:id/retry')
  @HttpCode(202)
  @RequirePermission('automation.manage')
  retry(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @ReqMeta() meta: RequestMeta) {
    return this.automations.retry(auth, id, meta);
  }

  @Get()
  @RequirePermission('automation.view')
  list(@CurrentAuth() auth: AuthContext) {
    return this.automations.list(auth);
  }

  @Post()
  @RequirePermission('automation.manage')
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(ruleSchema)) body: RuleInput, @ReqMeta() meta: RequestMeta) {
    return this.automations.create(auth, body, meta);
  }

  @Get(':id')
  @RequirePermission('automation.view')
  get(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return this.automations.get(auth, id);
  }

  @Put(':id')
  @RequirePermission('automation.manage')
  update(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @Body(new ZodPipe(ruleSchema)) body: RuleInput, @ReqMeta() meta: RequestMeta) {
    return this.automations.update(auth, id, body, meta);
  }

  @Patch(':id')
  @RequirePermission('automation.manage')
  toggle(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @Body(new ZodPipe(toggleSchema)) body: z.infer<typeof toggleSchema>, @ReqMeta() meta: RequestMeta) {
    return this.automations.setEnabled(auth, id, body.enabled, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('automation.manage')
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @ReqMeta() meta: RequestMeta) {
    await this.automations.remove(auth, id, meta);
  }

  @Post(':id/test')
  @HttpCode(200)
  @RequirePermission('automation.view')
  test(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @Body(new ZodPipe(testSchema)) body: z.infer<typeof testSchema>) {
    return this.automations.test(auth, id, body.leadId);
  }
}
