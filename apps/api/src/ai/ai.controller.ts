import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RateLimit } from '../common/rate-limit.guard';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { type PromptVersionInput, promptVersionSchema, type UpdateSettingsInput, updateSettingsSchema } from './ai.schemas';
import { AiService } from './ai.service';

const Id = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('settings')
  @RequirePermission('ai.configure')
  settings(@CurrentAuth() auth: AuthContext) {
    return this.ai.getSettings(auth);
  }

  @Put('settings')
  @RequirePermission('ai.configure')
  update(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(updateSettingsSchema)) body: UpdateSettingsInput) {
    return this.ai.updateSettings(auth, body);
  }

  @Post('settings/test')
  @RateLimit('ai')
  @HttpCode(200)
  @RequirePermission('ai.configure')
  test(@CurrentAuth() auth: AuthContext) {
    return this.ai.testConnection(auth);
  }

  @Post('leads/:id/analyze')
  @RateLimit('ai')
  @HttpCode(200)
  @RequirePermission('ai.use', 'lead.view')
  analyze(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return this.ai.analyzeLead(auth, id);
  }

  @Get('leads/:id/analysis')
  @RequirePermission('lead.view')
  analysis(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return this.ai.latestAnalysis(auth, id);
  }

  @Get('usage')
  @RequirePermission('analytics.view')
  usage(@CurrentAuth() auth: AuthContext) {
    return this.ai.usage(auth);
  }

  @Get('prompts')
  @RequirePermission('ai.configure')
  async prompts(@CurrentAuth() auth: AuthContext) {
    return { items: await this.ai.prompts(auth) };
  }

  @Post('prompts/:key/versions')
  @HttpCode(201)
  @RequirePermission('ai.configure')
  addVersion(@CurrentAuth() auth: AuthContext, @Param('key') key: string, @Body(new ZodPipe(promptVersionSchema)) body: PromptVersionInput) {
    return this.ai.addPromptVersion(auth, key, body);
  }

  @Post('prompts/:key/versions/:version/activate')
  @HttpCode(200)
  @RequirePermission('ai.configure')
  activate(@CurrentAuth() auth: AuthContext, @Param('key') key: string, @Param('version', ParseIntPipe) version: number) {
    return this.ai.activatePromptVersion(auth, key, version);
  }
}
