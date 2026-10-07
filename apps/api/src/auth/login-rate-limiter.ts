import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { VALKEY } from '../infra/tokens';

const WINDOW_SECONDS = 15 * 60;
const MAX_PER_ACCOUNT = 10;
const MAX_PER_IP = 50;

/**
 * Counts failed logins in Valkey so the limit holds across API instances.
 * Fails open if Valkey is down: login stays available and Argon2 still bounds guessing speed.
 */
@Injectable()
export class LoginRateLimiter {
  private readonly logger = new Logger(LoginRateLimiter.name);

  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  private keys(ip: string | null, email: string) {
    const client = ip ?? 'unknown';
    return { account: `rl:login:${client}:${email}`, ip: `rl:login-ip:${client}` };
  }

  async assertAllowed(ip: string | null, email: string): Promise<void> {
    const k = this.keys(ip, email);
    let counts: (string | null)[];
    try {
      counts = await this.valkey.mget(k.account, k.ip);
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'login rate limiter unavailable; failing open');
      return;
    }
    if (Number(counts[0] ?? 0) >= MAX_PER_ACCOUNT || Number(counts[1] ?? 0) >= MAX_PER_IP) {
      throw new HttpException(
        { code: 'TOO_MANY_ATTEMPTS', message: 'Too many failed sign-in attempts. Try again in 15 minutes.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordFailure(ip: string | null, email: string): Promise<void> {
    const k = this.keys(ip, email);
    try {
      await this.valkey
        .multi()
        .incr(k.account)
        .expire(k.account, WINDOW_SECONDS, 'NX')
        .incr(k.ip)
        .expire(k.ip, WINDOW_SECONDS, 'NX')
        .exec();
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'failed to record login failure');
    }
  }

  async reset(ip: string | null, email: string): Promise<void> {
    await this.valkey.del(this.keys(ip, email).account).catch(() => undefined);
  }
}
