import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

@Module({
  imports: [AuditModule],
  controllers: [TeamsController],
  providers: [TeamsService],
})
export class TeamsModule {}
