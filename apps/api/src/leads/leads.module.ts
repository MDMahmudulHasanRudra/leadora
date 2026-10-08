import { Module } from '@nestjs/common';
import { BoardController } from './board.controller';
import { LeadImportsController } from './lead-imports.controller';
import { LeadImportsService } from './lead-imports.service';
import { LeadReader } from './lead-reader.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  controllers: [LeadsController, LeadImportsController, BoardController],
  providers: [LeadsService, LeadReader, LeadImportsService],
  exports: [LeadReader],
})
export class LeadsModule {}
