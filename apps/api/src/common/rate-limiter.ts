import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { VALKEY } from '../infra/tokens';

/**
 * Fixed-window counters in Valkey, shared by every API instance. Fails open when Valkey is unavailable:
 * public endpoints keep working and the other defenses (honeypot, CAPTCHA, validation) still apply.
 */
@Injectable()
export class RateLimiter {
  private readonly logger = new Logger(RateLimiter.name);

  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  async hit(key: string, limit: number, windowSeconds: number) {
    const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
    let n: number;
    try {
      n = await this.valkey.incr(bucket);
      if (n === 1) await this.valkey.expire(bucket, windowSeconds * 2);
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'rate limiter unavailable; failing open');
      return;
    }
    if (n > limit) {
      throw new HttpException({ code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
