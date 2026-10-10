import { Module } from '@nestjs/common';
import { RateLimiter } from '../common/rate-limiter';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { MetaWebhooksController } from './meta-webhooks.controller';
import { WebChatController } from './web-chat.controller';
import { WebChatService } from './web-chat.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  controllers: [ConversationsController, WebhooksController, WebChatController, MetaWebhooksController],
  providers: [ConversationsService, WebChatService, RateLimiter],
})
export class CommunicationModule {}