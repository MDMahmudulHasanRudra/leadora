import { type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Env } from '@leadora/config';
import type { Request } from 'express';
import type { AuthedRequest } from '../auth/auth-context';
import { ENV } from '../infra/tokens';
import { RateLimiter } from './rate-limiter';

/**
 * Spec §69: separate limits per kind of work. Authentication, public ingestion and webhooks have their own
 * limiters next to the code they protect; this guard covers authenticated traffic.
 */
export type RateCategory = 'api' | 'ai' | 'export' | 'bulk';
export const RATE_CATEGORY = 'rate:category';
export const RateLimit = (category: RateCategory) => SetMetadata(RATE_CATEGORY, category);

/** Per user (or API key) per minute; AI is stricter because every call costs money (spec §69, §75). */
export const RATE_LIMITS: Record<RateCategory, (env: Env) => { limit: number; windowSeconds: number }> = {
  api: (env) => ({ limit: env.RATE_LIMIT_API_PER_MIN, windowSeconds: 60 }),
  ai: (env) => ({ limit: env.RATE_LIMIT_AI_PER_MIN, windowSeconds: 60 }),
  export: () => ({ limit: 10, windowSeconds: 3600 }),
  bulk: () => ({ limit: 20, windowSeconds: 60 }),
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<Request & AuthedRequest>();
    // Public routes (no auth context) are limited by their own handlers.
    if (!req.auth) return true;
    const category = this.reflector.getAllAndOverride<RateCategory>(RATE_CATEGORY, [ctx.getHandler(), ctx.getClass()]) ?? 'api';
    const { limit, windowSeconds } = RATE_LIMITS[category](this.env);
    const who = req.auth.apiKeyId ? `key:${req.auth.apiKeyId}` : `user:${req.auth.userId}`;
    await this.limiter.hit(`${category}:${who}`, limit, windowSeconds);
    return true;
  }
}
