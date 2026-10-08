import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Env } from '@leadora/config';
import { apiKeys, type DbHandle } from '@leadora/database';
import { and, desc, eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth-context';
import type { Permission } from '../auth/permissions';
import type { RequestMeta } from '../common/request-meta';
import { DB, ENV, VALKEY } from '../infra/tokens';

/** Spec §92 scopes, each a fixed set of permissions. A key never gets more than its creator has. */
export const API_KEY_SCOPES = {
  'leads:read': ['lead.view'],
  'leads:write': ['lead.view', 'lead.create', 'lead.update'],
  'conversations:read': ['conversation.view'],
  'followups:read': ['followup.view'],
  'followups:write': ['followup.view', 'followup.create', 'followup.complete'],
  'analytics:read': ['analytics.view'],
} as const satisfies Record<string, Permission[]>;
export type ApiKeyScope = keyof typeof API_KEY_SCOPES;

const KEY_PATTERN = /^lk_([a-z0-9]{12})_([A-Za-z0-9_-]{43})$/;
const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const scopePermissions = (scopes: string[]) => new Set(scopes.flatMap((s) => (API_KEY_SCOPES as Record<string, readonly Permission[]>)[s] ?? []));

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
    @Inject(VALKEY) private readonly valkey: Redis,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext) {
    const rows = await this.handle.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyId: apiKeys.keyId,
        scopes: apiKeys.scopes,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
        createdByUserId: apiKeys.createdByUserId,
      })
      .from(apiKeys)
      .where(eq(apiKeys.organizationId, auth.organizationId))
      .orderBy(desc(apiKeys.createdAt));
    return { items: rows.map(({ keyId, ...r }) => ({ ...r, prefix: `lk_${keyId}` })) };
  }

  async create(auth: AuthContext, input: { name: string; scopes: ApiKeyScope[]; expiresAt?: Date }, meta: RequestMeta) {
    if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
      throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: 'The expiry must be in the future', details: [{ path: 'expiresAt', message: 'Must be in the future' }] });
    }
    const exceeding = [...scopePermissions(input.scopes)].filter((p) => !auth.permissions.has(p));
    if (exceeding.length) {
      throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: 'A key cannot do more than you can', details: [{ path: 'scopes', message: `You lack ${exceeding.join(', ')}` }] });
    }
    const keyId = Array.from(randomBytes(12), (b) => ALPHABET[b % ALPHABET.length]).join('');
    const secret = randomBytes(32).toString('base64url');
    return this.handle.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(apiKeys)
        .values({ organizationId: auth.organizationId, name: input.name, keyId, secretHash: hash(secret), scopes: input.scopes, createdByUserId: auth.userId, expiresAt: input.expiresAt ?? null })
        .returning({ id: apiKeys.id, name: apiKeys.name, scopes: apiKeys.scopes, expiresAt: apiKeys.expiresAt, createdAt: apiKeys.createdAt });
      await this.audit.record(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'api_key.created',
        resourceType: 'api_key',
        resourceId: row!.id,
        newValues: { name: input.name, scopes: input.scopes, expiresAt: input.expiresAt ?? null, prefix: `lk_${keyId}` },
        meta,
      });
      // The only time the full key is ever returned.
      return { ...row!, prefix: `lk_${keyId}`, key: `lk_${keyId}_${secret}` };
    });
  }

  async revoke(auth: AuthContext, id: string, meta: RequestMeta) {
    await this.handle.db.transaction(async (tx) => {
      const [row] = await tx
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, id), eq(apiKeys.organizationId, auth.organizationId)))
        .returning({ name: apiKeys.name });
      if (!row) throw new NotFoundException({ code: 'API_KEY_NOT_FOUND', message: 'API key not found' });
      await this.audit.record(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'api_key.revoked', resourceType: 'api_key', resourceId: id, oldValues: { name: row.name }, meta });
    });
  }

  /** Returns the key row for a presented bearer token, or null. Constant-time comparison of the secret hash. */
  async authenticate(raw: string) {
    const m = KEY_PATTERN.exec(raw);
    if (!m) return null;
    const [row] = await this.handle.db.select().from(apiKeys).where(eq(apiKeys.keyId, m[1]!));
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) return null;
    const presented = Buffer.from(hash(m[2]!), 'hex');
    if (!timingSafeEqual(presented, Buffer.from(row.secretHash, 'hex'))) return null;
    // Last-used is advisory; update at most once a minute and never fail the request over it.
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      void this.handle.db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, row.id))
        .catch((err: Error) => this.logger.warn({ err: err.message }, 'api_key.touch_failed'));
    }
    return row;
  }

  /** Fixed one-minute windows in Valkey, shared by all API instances. Fails open if Valkey is down. */
  async assertWithinRate(keyId: string) {
    const window = Math.floor(Date.now() / 60_000);
    const k = `rl:apikey:${keyId}:${window}`;
    let n: number;
    try {
      n = await this.valkey.incr(k);
      if (n === 1) await this.valkey.expire(k, 120);
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'api key rate limiter unavailable; failing open');
      return;
    }
    if (n > this.env.API_KEY_RATE_LIMIT_PER_MIN) {
      throw new HttpException({ code: 'RATE_LIMITED', message: 'Too many requests for this API key. Slow down and retry next minute.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
