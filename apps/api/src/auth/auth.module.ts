import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [AuthService, SessionsService],
  exports: [SessionsService],
})
export class AuthModule {}
