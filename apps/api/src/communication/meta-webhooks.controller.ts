import { createHash, timingSafeEqual } from 'node:crypto';
import { Controller, ForbiddenException, Get, Header, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Env } from '@leadora/config';
import { type DbHandle, inboxes, webhookEvents } from '@leadora/database';
import { decryptSecret, verifyMetaSignature } from '@leadora/domain';
import type { Queue } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import type { Request } from 'express';
import { Public } from '../auth/auth-context';
import { RateLimiter } from '../common/rate-limiter';
import { DB, ENV, MESSAGES_QUEUE } from '../infra/tokens';

const Id = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const META_CHANNELS = ['WHATSAPP', 'FACEBOOK', 'INSTAGRAM'] as const;

interface MetaConfig {
  appSecretEnc?: string;
  verifyTokenEnc?: string;
}

/** Spec §53/§89: Meta's handshake and signed deliveries. Verify → persist → queue; processing happens in the worker. */
@ApiTags('webhooks')
@Controller('webhooks/meta')
export class MetaWebhooksController {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
    @Inject(MESSAGES_QUEUE) private readonly queue: Queue,
    private readonly limiter: RateLimiter,
  ) {}

  private async inbox(id: string) {
    const [inbox] = await this.handle.db
      .select()
      .from(inboxes)
      .where(and(eq(inboxes.id, id), eq(inboxes.enabled, true), inArray(inboxes.channel, [...META_CHANNELS])));
    if (!inbox) throw new NotFoundException({ code: 'INBOX_NOT_FOUND', message: 'Inbox not found' });
    return { ...inbox, meta: inbox.config as MetaConfig };
  }

  /** Subscription handshake: echo hub.challenge only when hub.verify_token matches ours. */
  @Public()
  @Get(':inboxId')
  @Header('content-type', 'text/plain')
  async verify(@Param('inboxId', Id) inboxId: string, @Query() q: Record<string, string>) {
    const inbox = await this.inbox(inboxId);
    const expected = Buffer.from(inbox.meta.verifyTokenEnc ? decryptSecret(inbox.meta.verifyTokenEnc, this.env.DATA_ENCRYPTION_KEY) : '');
    const given = Buffer.from(String(q['hub.verify_token'] ?? ''));
    const ok = q['hub.mode'] === 'subscribe' && expected.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
    if (!ok) throw new ForbiddenException({ code: 'INVALID_VERIFY_TOKEN', message: 'Verification failed' });
    return String(q['hub.challenge'] ?? '');
  }

  @Public()
  @Post(':inboxId')
  @HttpCode(200)
  async receive(@Param('inboxId', Id) inboxId: string, @Req() req: Request & { rawBody?: Buffer }) {
    const inbox = await this.inbox(inboxId);
    const secret = inbox.meta.appSecretEnc ? decryptSecret(inbox.meta.appSecretEnc, this.env.DATA_ENCRYPTION_KEY) : '';
    if (!secret || !req.rawBody || !verifyMetaSignature(secret, req.rawBody, req.get('x-hub-signature-256'))) {
      throw new UnauthorizedException({ code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' });
    }
    await this.limiter.hit(`meta:${inboxId}`, 1200, 60);
    // Meta retries the same payload on failure; the body hash makes that a no-op.
    const externalId = createHash('sha256').update(req.rawBody).digest('hex');
    const [created] = await this.handle.db
      .insert(webhookEvents)
      .values({ organizationId: inbox.organizationId, inboxId, provider: 'meta', externalId, payload: req.body as object })
      .onConflictDoNothing({ target: [webhookEvents.inboxId, webhookEvents.externalId] })
      .returning({ id: webhookEvents.id });
    if (created) await this.queue.add('meta.process', { eventId: created.id }, { jobId: `meta-${created.id}`, attempts: 4, backoff: { type: 'custom' } });
    return { received: true, duplicate: !created, ...(created ? { eventId: created.id } : {}) };
  }
}
