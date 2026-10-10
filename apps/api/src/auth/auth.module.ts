import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeysController } from '../api-keys/api-keys.controller';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { AuditModule } from '../audit/audit.module';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { RateLimiter } from '../common/rate-limiter';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { IdentityService } from './identity.service';
import { LoginRateLimiter } from './login-rate-limiter';
import { OriginGuard } from './origin.guard';
import { SessionsService } from './sessions.service';

@Global()
@Module({
  imports: [AuditModule],
  controllers: [AuthController, ApiKeysController],
  providers: [
    AuthService,
    SessionsService,
    IdentityService,
    LoginRateLimiter,
    ApiKeysService,
    // Order matters: reject foreign origins before doing any session work.
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    // After AuthGuard, so limits can be keyed by user or API key.
    RateLimiter,
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [SessionsService, IdentityService, RateLimiter],
})
export class AuthModule {}
