import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { loggerParams } from './common/logging';
import { HealthModule } from './health/health.module';
import { InfraModule } from './infra/infra.module';
import { QueuesModule } from './infra/queues.module';
import { LeadsModule } from './leads/leads.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { TeamsModule } from './teams/teams.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    LoggerModule.forRoot(loggerParams(process.env.LOG_LEVEL ?? 'info')),
    InfraModule,
    QueuesModule,
    HealthModule,
    AuditModule,
    AuthModule,
    UsersModule,
    TeamsModule,
    OrganizationsModule,
    LeadsModule,
  ],
})
export class AppModule {}
