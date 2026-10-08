import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WEBHOOK_EVENTS } from '@leadora/domain';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ReqMeta, type RequestMeta } from '../common/request-meta';
import { ZodPipe } from '../common/zod.pipe';
import { WebhooksService } from './webhooks.service';

const Id = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const EVENTS = ['*', ...WEBHOOK_EVENTS.filter((e) => e !== 'webhook.test')] as [string, ...string[]];
const events = z.array(z.enum(EVENTS)).min(1, 'Choose at least one event').max(EVENTS.length);
const createSchema = z.object({ url: z.string().trim().min(1).max(2000), description: z.string().trim().max(300).optional(), events });
const updateSchema = z
  .object({ url: z.string().trim().min(1).max(2000), description: z.string().trim().max(300).nullable(), events, enabled: z.boolean() })
  .partial();

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get('events')
  @RequirePermission('settings.manage')
  events() {
    return { items: EVENTS };
  }

  @Get()
  @RequirePermission('settings.manage')
  list(@CurrentAuth() auth: AuthContext) {
    return this.webhooks.list(auth);
  }

  @Post()
  @RequirePermission('settings.manage')
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>, @ReqMeta() meta: RequestMeta) {
    return this.webhooks.create(auth, body, meta);
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  update(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>, @ReqMeta() meta: RequestMeta) {
    return this.webhooks.update(auth, id, body, meta);
  }

  @Post(':id/rotate-secret')
  @HttpCode(200)
  @RequirePermission('settings.manage')
  rotate(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @ReqMeta() meta: RequestMeta) {
    return this.webhooks.rotateSecret(auth, id, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @ReqMeta() meta: RequestMeta) {
    await this.webhooks.remove(auth, id, meta);
  }

  @Get(':id/deliveries')
  @RequirePermission('settings.manage')
  deliveries(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return this.webhooks.deliveries(auth, id);
  }

  @Post(':id/test')
  @HttpCode(202)
  @RequirePermission('settings.manage')
  test(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return this.webhooks.test(auth, id);
  }

  @Post('deliveries/:id/redeliver')
  @HttpCode(202)
  @RequirePermission('settings.manage')
  redeliver(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return this.webhooks.redeliver(auth, id);
  }
}
