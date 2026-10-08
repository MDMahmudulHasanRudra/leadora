import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ReqMeta, type RequestMeta } from '../common/request-meta';
import { ZodPipe } from '../common/zod.pipe';
import { API_KEY_SCOPES, type ApiKeyScope, ApiKeysService } from './api-keys.service';

const SCOPES = Object.keys(API_KEY_SCOPES) as [ApiKeyScope, ...ApiKeyScope[]];
const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(SCOPES)).min(1).max(SCOPES.length),
  expiresAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)).optional(),
});

@ApiTags('api-keys')
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get('scopes')
  @RequirePermission('settings.manage')
  scopes() {
    return { items: Object.entries(API_KEY_SCOPES).map(([key, permissions]) => ({ key, permissions })) };
  }

  @Get()
  @RequirePermission('settings.manage')
  list(@CurrentAuth() auth: AuthContext) {
    return this.keys.list(auth);
  }

  @Post()
  @RequirePermission('settings.manage')
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>, @ReqMeta() meta: RequestMeta) {
    return this.keys.create(auth, { ...body, scopes: [...new Set(body.scopes)] }, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('settings.manage')
  async revoke(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string, @ReqMeta() meta: RequestMeta) {
    await this.keys.revoke(auth, id, meta);
  }
}
