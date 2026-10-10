import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RateLimit } from '../../common/rate-limit.guard';
import { type AuthContext, CurrentAuth, RequirePermission } from '../../auth/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { type QueryInput, querySchema } from './assistant.schemas';
import { AssistantService } from './assistant.service';

@ApiTags('ai')
@RateLimit('ai')
@Controller('ai/assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('query')
  @HttpCode(200)
  @RequirePermission('ai.use')
  query(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(querySchema)) body: QueryInput) {
    return this.assistant.query(auth, body.question);
  }

  @Get('history')
  @RequirePermission('ai.use')
  history(@CurrentAuth() auth: AuthContext) {
    return this.assistant.history(auth);
  }
}
