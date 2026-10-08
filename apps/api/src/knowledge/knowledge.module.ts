import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuditModule } from '../audit/audit.module';
import { KnowledgeRagService } from './knowledge-rag.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

@Module({
  imports: [AiModule, AuditModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, KnowledgeRagService],
  exports: [KnowledgeRagService],
})
export class KnowledgeModule {}
