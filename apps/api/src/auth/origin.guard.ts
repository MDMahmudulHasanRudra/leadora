import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Env } from '@leadora/config';
import type { Request } from 'express';
import { ENV } from '../infra/tokens';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense alongside SameSite=Lax cookies. Browsers always send Origin on cross-site
 * state-changing requests, so a mismatch is rejected; requests without Origin come from
 * non-browser clients that cannot ride a victim's cookies.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: Set<string>;

  constructor(@Inject(ENV) env: Env) {
    this.allowed = new Set(env.APP_ORIGINS);
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    const origin = req.get('origin');
    if (origin === undefined || this.allowed.has(origin)) return true;
    throw new ForbiddenException({ code: 'ORIGIN_NOT_ALLOWED', message: 'Request origin is not allowed' });
  }
}
