import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Env } from '@leadora/config';
import { type DbHandle, webhookDeliveries, webhookEndpoints } from '@leadora/database';
import { assertFetchableUrl, createTestDelivery, encryptSecret, newWebhookSecret, webhookDeliveryJob } from '@leadora/domain';
import type { Queue } from 'bullmq';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth-context';
import type { RequestMeta } from '../common/request-meta';
import { DB, ENV, WEBHOOKS_QUEUE } from '../infra/tokens';

const notFound = () => new NotFoundException({ code: 'WEBHOOK_NOT_FOUND', message: 'Webhook endpoint not found' });

const publicFields = {
  id: webhookEndpoints.id,
  url: webhookEndpoints.url,
  description: webhookEndpoints.description,
  events: webhookEndpoints.events,
  enabled: webhookEndpoints.enabled,
  failureCount: webhookEndpoints.failureCount,
  disabledReason: webhookEndpoints.disabledReason,
  createdAt: webhookEndpoints.createdAt,
};

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
    @Inject(WEBHOOKS_QUEUE) private readonly queue: Queue,
    private readonly audit: AuditService,
  ) {}

  private async find(auth: AuthContext, id: string) {
    const [ep] = await this.handle.db.select(publicFields).from(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.organizationId, auth.organizationId)));
    if (!ep) throw notFound();
    return ep;
  }

  private async enqueue(deliveryId: string) {
    const job = webhookDeliveryJob(deliveryId);
    await this.queue.add(job.name, job.data, job.opts);
  }

  async list(auth: AuthContext) {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const items = await this.handle.db
      .select({
        ...publicFields,
        delivered7d: sql<number>`(select count(*)::int from ${webhookDeliveries} d where d.endpoint_id = ${webhookEndpoints.id} and d.status = 'SUCCEEDED' and d.created_at >= ${since})`,
        failed7d: sql<number>`(select count(*)::int from ${webhookDeliveries} d where d.endpoint_id = ${webhookEndpoints.id} and d.status = 'FAILED' and d.created_at >= ${since})`,
      })
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.organizationId, auth.organizationId))
      .orderBy(desc(webhookEndpoints.createdAt));
    return { items };
  }

  async create(auth: AuthContext, input: { url: string; description?: string; events: string[] }, meta: RequestMeta) {
    // Fast feedback for obviously internal targets; every delivery re-checks resolved addresses too.
    const url = assertFetchableUrl(input.url).toString();
    const secret = newWebhookSecret();
    return this.handle.db.transaction(async (tx) => {
      const [ep] = await tx
        .insert(webhookEndpoints)
        .values({
          organizationId: auth.organizationId,
          url,
          description: input.description ?? null,
          events: [...new Set(input.events)],
          secretEnc: encryptSecret(secret, this.env.DATA_ENCRYPTION_KEY),
          createdByUserId: auth.userId,
        })
        .returning(publicFields);
      await this.audit.record(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'webhook.created', resourceType: 'webhook_endpoint', resourceId: ep!.id, newValues: { url, events: input.events }, meta });
      // The only time the secret is returned (spec §93: consumers verify with it).
      return { ...ep!, secret };
    });
  }

  async update(auth: AuthContext, id: string, input: { url?: string; description?: string | null; events?: string[]; enabled?: boolean }, meta: RequestMeta) {
    const current = await this.find(auth, id);
    const url = input.url ? assertFetchableUrl(input.url).toString() : undefined;
    return this.handle.db.transaction(async (tx) => {
      const [ep] = await tx
        .update(webhookEndpoints)
        .set({
          ...(url ? { url } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.events ? { events: [...new Set(input.events)] } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          // Turning an endpoint back on starts its failure count afresh.
          ...(input.enabled === true ? { failureCount: 0, disabledReason: null } : {}),
        })
        .where(eq(webhookEndpoints.id, id))
        .returning(publicFields);
      await this.audit.record(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'webhook.updated',
        resourceType: 'webhook_endpoint',
        resourceId: id,
        oldValues: { url: current.url, events: current.events, enabled: current.enabled },
        newValues: { url: ep!.url, events: ep!.events, enabled: ep!.enabled },
        meta,
      });
      return ep!;
    });
  }

  async rotateSecret(auth: AuthContext, id: string, meta: RequestMeta) {
    await this.find(auth, id);
    const secret = newWebhookSecret();
    await this.handle.db.transaction(async (tx) => {
      await tx.update(webhookEndpoints).set({ secretEnc: encryptSecret(secret, this.env.DATA_ENCRYPTION_KEY) }).where(eq(webhookEndpoints.id, id));
      await this.audit.record(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'webhook.secret_rotated', resourceType: 'webhook_endpoint', resourceId: id, meta });
    });
    return { id, secret };
  }

  async remove(auth: AuthContext, id: string, meta: RequestMeta) {
    const current = await this.find(auth, id);
    await this.handle.db.transaction(async (tx) => {
      await tx.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id));
      await this.audit.record(tx, { organizationId: auth.organizationId, actorUserId: auth.userId, action: 'webhook.deleted', resourceType: 'webhook_endpoint', resourceId: id, oldValues: { url: current.url }, meta });
    });
  }

  async deliveries(auth: AuthContext, id: string) {
    await this.find(auth, id);
    const items = await this.handle.db
      .select({
        id: webhookDeliveries.id,
        eventType: webhookDeliveries.eventType,
        status: webhookDeliveries.status,
        attempts: webhookDeliveries.attempts,
        lastStatusCode: webhookDeliveries.lastStatusCode,
        lastError: webhookDeliveries.lastError,
        deliveredAt: webhookDeliveries.deliveredAt,
        createdAt: webhookDeliveries.createdAt,
      })
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.endpointId, id), gte(webhookDeliveries.createdAt, new Date(Date.now() - 30 * 86_400_000))))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(100);
    return { items };
  }

  async test(auth: AuthContext, id: string) {
    await this.find(auth, id);
    const deliveryId = await createTestDelivery(this.handle.db, auth.organizationId, id);
    await this.enqueue(deliveryId);
    return { deliveryId };
  }

  async redeliver(auth: AuthContext, deliveryId: string) {
    const [d] = await this.handle.db
      .select({ id: webhookDeliveries.id, status: webhookDeliveries.status })
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.organizationId, auth.organizationId)));
    if (!d) throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery not found' });
    if (d.status === 'PENDING') throw new ConflictException({ code: 'DELIVERY_PENDING', message: 'This delivery is still being attempted' });
    await this.handle.db.update(webhookDeliveries).set({ status: 'PENDING', lastError: null }).where(eq(webhookDeliveries.id, deliveryId));
    // A redelivery reuses the queue job id, so remove a finished/failed job first.
    await (await this.queue.getJob(webhookDeliveryJob(deliveryId).opts.jobId))?.remove().catch(() => undefined);
    await this.enqueue(deliveryId);
    return { id: deliveryId, status: 'PENDING' as const };
  }
}
