import { Module } from '@nestjs/common';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService, RealtimePublisher],
})
export class CommunicationModule {}
