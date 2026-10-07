import { Inject, Injectable } from '@nestjs/common';
import type { DbHandle } from '@leadora/database';
import type Redis from 'ioredis';
import { DB, VALKEY } from '../infra/tokens';

export type CheckStatus = 'up' | 'down';

export interface ReadinessReport {
  status: 'ok' | 'error';
  checks: Record<string, { status: CheckStatus; latencyMs: number; error?: string }>;
}

const CHECK_TIMEOUT_MS = 2000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(VALKEY) private readonly valkey: Redis,
  ) {}

  async readiness(): Promise<ReadinessReport> {
    const [postgres, valkey] = await Promise.all([
      this.check(() => this.db.pool.query('SELECT 1')),
      this.check(() => this.valkey.ping()),
    ]);
    const checks = { postgres, valkey };
    const ok = Object.values(checks).every((c) => c.status === 'up');
    return { status: ok ? 'ok' : 'error', checks };
  }

  private async check(fn: () => Promise<unknown>) {
    const started = performance.now();
    try {
      await withTimeout(fn(), CHECK_TIMEOUT_MS);
      return { status: 'up' as const, latencyMs: Math.round(performance.now() - started) };
    } catch (err) {
      return {
        status: 'down' as const,
        latencyMs: Math.round(performance.now() - started),
        error: err instanceof Error ? err.message : 'unknown error',
      };
    }
  }
}
