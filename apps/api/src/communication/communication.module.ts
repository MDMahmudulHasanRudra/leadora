import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  controllers: [ConversationsController, WebhooksController],
  providers: [ConversationsService],
})
export class CommunicationModule {}
