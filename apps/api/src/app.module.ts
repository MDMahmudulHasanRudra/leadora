import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { loggerParams } from './common/logging';
import { HealthModule } from './health/health.module';
import { InfraModule } from './infra/infra.module';
import { TeamsModule } from './teams/teams.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    LoggerModule.forRoot(loggerParams(process.env.LOG_LEVEL ?? 'info')),
    InfraModule,
    HealthModule,
    AuditModule,
    AuthModule,
    UsersModule,
    TeamsModule,
  ],
})
export class AppModule {}
