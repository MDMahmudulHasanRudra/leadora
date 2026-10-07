import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Env } from '@leadora/config';
import { type DbHandle, sessions, type Transaction } from '@leadora/database';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { RequestMeta } from '../common/request-meta';
import { DB, ENV } from '../infra/tokens';

export const SESSION_COOKIE = 'leadora_session';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionsService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get ttlMs(): number {
    return this.env.SESSION_TTL_HOURS * 3600_000;
  }

  /** Returns the raw token for the cookie; only its hash is persisted. */
  async create(tx: Transaction, userId: string, organizationId: string, meta: RequestMeta): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await tx.insert(sessions).values({
      tokenHash: hashToken(token),
      userId,
      organizationId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      expiresAt: new Date(Date.now() + this.ttlMs),
    });
    return token;
  }

  async findActive(token: string) {
    const [row] = await this.handle.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return row ?? null;
  }

  async revoke(token: string): Promise<void> {
    await this.handle.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
  }

  async revokeAllForUser(tx: Transaction, userId: string): Promise<void> {
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  cookieOptions() {
    return {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: this.ttlMs,
    };
  }
}
