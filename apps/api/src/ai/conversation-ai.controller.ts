import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RateLimit } from '../common/rate-limit.guard';
import { type AuthContext, CurrentAuth, RequirePermission } from '../auth/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { type ReplyRequest, replyRequestSchema } from './ai.schemas';
import { ConversationAiService } from './conversation-ai.service';

const Id = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('ai')
@RateLimit('ai')
@Controller('ai/conversations')
export class ConversationAiController {
  constructor(private readonly service: ConversationAiService) {}

  @Post(':id/analyze')
  @HttpCode(200)
  @RequirePermission('ai.use', 'conversation.view')
  analyze(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return this.service.analyze(auth, id);
  }

  @Get(':id/analysis')
  @RequirePermission('conversation.view')
  analysis(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string) {
    return this.service.latest(auth, id);
  }

  @Post(':id/reply')
  @HttpCode(200)
  @RequirePermission('ai.use', 'conversation.reply')
  reply(@CurrentAuth() auth: AuthContext, @Param('id', Id) id: string, @Body(new ZodPipe(replyRequestSchema)) body: ReplyRequest) {
    return this.service.reply(auth, id, body);
  }
}
