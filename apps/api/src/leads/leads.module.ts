import { Module } from '@nestjs/common';
import { LeadImportsController } from './lead-imports.controller';
import { LeadImportsService } from './lead-imports.service';
import { LeadReader } from './lead-reader.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  controllers: [LeadsController, LeadImportsController],
  providers: [LeadsService, LeadReader, LeadImportsService],
  exports: [LeadReader],
})
export class LeadsModule {}
