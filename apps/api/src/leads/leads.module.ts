import { Module } from '@nestjs/common';
import { LeadReader } from './lead-reader.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  controllers: [LeadsController],
  providers: [LeadsService, LeadReader],
  exports: [LeadReader],
})
export class LeadsModule {}
