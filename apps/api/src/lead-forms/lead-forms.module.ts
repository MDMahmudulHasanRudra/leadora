import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RateLimiter } from '../common/rate-limiter';
import { CAPTCHA_VERIFIER } from '../infra/tokens';
import { LeadFormsController, PublicFormsController } from './lead-forms.controller';
import { defaultCaptchaVerifier, LeadFormsService } from './lead-forms.service';

@Module({
  imports: [AuditModule],
  controllers: [LeadFormsController, PublicFormsController],
  providers: [LeadFormsService, RateLimiter, { provide: CAPTCHA_VERIFIER, useValue: defaultCaptchaVerifier }],
  exports: [RateLimiter],
})
export class LeadFormsModule {}