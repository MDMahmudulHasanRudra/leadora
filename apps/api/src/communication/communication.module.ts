import { Module } from '@nestjs/common';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  controllers: [ConversationsController, WebhooksController],
  providers: [ConversationsService, RealtimePublisher],
})
export class CommunicationModule {}
