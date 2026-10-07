import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerParams } from './common/logging';
import { HealthModule } from './health/health.module';
import { InfraModule } from './infra/infra.module';

@Module({
  imports: [LoggerModule.forRoot(loggerParams(process.env.LOG_LEVEL ?? 'info')), InfraModule, HealthModule],
})
export class AppModule {}
