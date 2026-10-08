import { Module } from '@nestjs/common';
import { LeadIngestionService } from './lead-ingestion.service';
import { LeadReader } from './lead-reader.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  controllers: [LeadsController],
  providers: [LeadsService, LeadIngestionService, LeadReader],
  exports: [LeadIngestionService, LeadReader],
})
export class LeadsModule {}
