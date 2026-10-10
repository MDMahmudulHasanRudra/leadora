import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Env } from '@leadora/config';
import { type DbHandle, inboxes, webhookEvents } from '@leadora/database';
import { decryptSecret, emailStatusSchema, inboundEmailSchema } from '@leadora/domain';
import type { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { Public } from '../auth/auth-context';
import { DB, ENV, MESSAGES_QUEUE, VALKEY } from '../infra/tokens';

const TOLERANCE_SECONDS = 300;
const RATE_PER_MINUTE = 300;

/** Constant-time check of `v1=hex(HMAC_SHA256(secret, "<timestamp>.<raw body>"))` within ±5 minutes. */
export function verifySignature(secret: string, rawBody: Buffer, timestamp: string | undefined, signature: string | undefined, now = Date.now()) {
  if (!timestamp || !signature?.startsWith('v1=') || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  const given = Buffer.from(signature.slice(3), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Spec §53: verify → idempotency → persist → queue. No processing inside the request. */
@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
    @Inject(MESSAGES_QUEUE) private readonly queue: Queue,
    @Inject(VALKEY) private readonly valkey: Redis,
  ) {}

  @Public()
  @Post('inbound/:inboxId')
  @HttpCode(202)
  async inbound(
    @Param('inboxId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) inboxId: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Res({ passthrough: true }) res: Response,
  ) {
    const [inbox] = await this.handle.db.select().from(inboxes).where(and(eq(inboxes.id, inboxId), eq(inboxes.enabled, true)));
    if (!inbox) throw new NotFoundException({ code: 'INBOX_NOT_FOUND', message: 'Inbox not found' });

    const secret = decryptSecret(inbox.webhookSecretEnc, this.env.DATA_ENCRYPTION_KEY);
    if (!req.rawBody || !verifySignature(secret, req.rawBody, req.get('x-leadora-timestamp'), req.get('x-leadora-signature'))) {
      throw new UnauthorizedException({ code: 'INVALID_SIGNATURE', message: 'Invalid or expired webhook signature' });
    }

    const key = `rl:webhook:${inboxId}:${Math.floor(Date.now() / 60_000)}`;
    const hits = await this.valkey.multi().incr(key).expire(key, 120).exec().catch(() => null);
    if (Number(hits?.[0]?.[1] ?? 0) > RATE_PER_MINUTE) {
      throw new HttpException({ code: 'RATE_LIMITED', message: 'Too many webhook deliveries' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const parsed = inboundEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const [created] = await this.handle.db
      .insert(webhookEvents)
      .values({ organizationId: inbox.organizationId, inboxId, provider: 'email', externalId: parsed.data.messageId, payload: parsed.data })
      .onConflictDoNothing({ target: [webhookEvents.inboxId, webhookEvents.externalId] })
      .returning({ id: webhookEvents.id });
    if (!created) {
      const [existing] = await this.handle.db
        .select({ id: webhookEvents.id })
        .from(webhookEvents)
        .where(and(eq(webhookEvents.inboxId, inboxId), eq(webhookEvents.externalId, parsed.data.messageId)));
      res.status(200);
      return { received: true, duplicate: true, eventId: existing!.id };
    }
    await this.queue.add('inbound.process', { eventId: created.id }, { jobId: `inbound-${created.id}`, attempts: 4, backoff: { type: 'custom' } });
    return { received: true, duplicate: false, eventId: created.id };
  }

  /** Spec §90: delivered / opened / bounced / complained, posted by the mail relay and signed like inbound email. */
  @Public()
  @Post('email-status/:inboxId')
  @HttpCode(202)
  async emailStatus(
    @Param('inboxId', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) inboxId: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Res({ passthrough: true }) res: Response,
  ) {
    const [inbox] = await this.handle.db.select().from(inboxes).where(and(eq(inboxes.id, inboxId), eq(inboxes.enabled, true), eq(inboxes.channel, 'EMAIL')));
    if (!inbox) throw new NotFoundException({ code: 'INBOX_NOT_FOUND', message: 'Inbox not found' });
    const secret = decryptSecret(inbox.webhookSecretEnc, this.env.DATA_ENCRYPTION_KEY);
    if (!req.rawBody || !verifySignature(secret, req.rawBody, req.get('x-leadora-timestamp'), req.get('x-leadora-signature'))) {
      throw new UnauthorizedException({ code: 'INVALID_SIGNATURE', message: 'Invalid or expired webhook signature' });
    }
    const parsed = emailStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const externalId = `status:${parsed.data.messageId}:${parsed.data.event}`;
    const [created] = await this.handle.db
      .insert(webhookEvents)
      .values({ organizationId: inbox.organizationId, inboxId, provider: 'email-status', externalId, payload: parsed.data })
      .onConflictDoNothing({ target: [webhookEvents.inboxId, webhookEvents.externalId] })
      .returning({ id: webhookEvents.id });
    if (!created) {
      res.status(200);
      return { received: true, duplicate: true };
    }
    await this.queue.add('email.status', { eventId: created.id }, { jobId: `email-status-${created.id}`, attempts: 4, backoff: { type: 'custom' } });
    return { received: true, duplicate: false, eventId: created.id };
  }
}