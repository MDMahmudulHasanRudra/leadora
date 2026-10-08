import { createHmac, randomBytes } from 'node:crypto';
import {
  type Database,
  type DomainEvent,
  leadSources,
  leads,
  pipelineStages,
  type Transaction,
  webhookDeliveries,
  webhookEndpoints,
} from '@leadora/database';
import { and, arrayContains, eq, or, sql } from 'drizzle-orm';
import { EVENT_TYPES } from '../automation/events';
import { DomainError } from '../errors';
import { type Lookup, safePost } from '../knowledge/safe-fetch';
import { notify } from '../notifications';
import { decryptSecret } from '../secrets';

export const WEBHOOK_EVENTS = [...EVENT_TYPES, 'webhook.test'] as const;
/** After this many consecutive failed deliveries an endpoint is switched off and its creator told. */
export const WEBHOOK_FAILURE_LIMIT = 20;

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

/** Spec §93: `v1=hex(HMAC_SHA256(secret, "<timestamp>.<body>"))` — the same scheme as our inbound webhooks. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

async function leadSummary(tx: Transaction, leadId: string) {
  const [l] = await tx
    .select({
      id: leads.id,
      fullName: leads.fullName,
      email: leads.email,
      phone: leads.phone,
      companyName: leads.companyName,
      score: leads.score,
      temperature: leads.temperature,
      stage: pipelineStages.key,
      source: leadSources.type,
      ownerUserId: leads.ownerUserId,
    })
    .from(leads)
    .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
    .innerJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .where(eq(leads.id, leadId));
  return l ?? null;
}

/** Creates one delivery per subscribed, enabled endpoint (unique per endpoint and event). Returns new ids. */
export async function fanOutWebhooks(tx: Transaction, e: DomainEvent): Promise<string[]> {
  const endpoints = await tx
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.organizationId, e.organizationId),
        eq(webhookEndpoints.enabled, true),
        or(arrayContains(webhookEndpoints.events, [e.type]), arrayContains(webhookEndpoints.events, ['*'])),
      ),
    );
  if (endpoints.length === 0) return [];
  const lead = e.leadId ? await leadSummary(tx, e.leadId) : null;
  const payload = { id: e.id, type: e.type, createdAt: e.occurredAt.toISOString(), data: { ...e.payload, lead } };
  const rows = await tx
    .insert(webhookDeliveries)
    .values(endpoints.map((ep) => ({ organizationId: e.organizationId, endpointId: ep.id, eventId: e.id, eventType: e.type, payload })))
    .onConflictDoNothing()
    .returning({ id: webhookDeliveries.id });
  return rows.map((r) => r.id);
}

/** A ping so integrators can check their endpoint and signature verification. */
export async function createTestDelivery(db: Database, organizationId: string, endpointId: string) {
  const [row] = await db
    .insert(webhookDeliveries)
    .values({
      organizationId,
      endpointId,
      eventType: 'webhook.test',
      payload: { id: crypto.randomUUID(), type: 'webhook.test', createdAt: new Date().toISOString(), data: { message: 'Hello from Leadora' } },
    })
    .returning({ id: webhookDeliveries.id });
  return row!.id;
}

export interface WebhookDeliveryOpts {
  encryptionKey: string;
  finalAttempt: boolean;
  /** Test-only overrides for the SSRF-safe client. */
  lookup?: Lookup;
  ports?: string[];
}

/**
 * Sends one delivery. 2xx = delivered. Otherwise the error is recorded and rethrown so the queue retries
 * (1m/5m/15m); the final failure counts against the endpoint, which is disabled at WEBHOOK_FAILURE_LIMIT.
 */
export async function deliverWebhook(db: Database, deliveryId: string, opts: WebhookDeliveryOpts) {
  const [row] = await db
    .select({ d: webhookDeliveries, ep: webhookEndpoints })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .where(eq(webhookDeliveries.id, deliveryId));
  if (!row || row.d.status !== 'PENDING') return { status: 'SKIPPED' as const };
  if (!row.ep.enabled) {
    await db.update(webhookDeliveries).set({ status: 'FAILED', lastError: 'The endpoint is disabled' }).where(eq(webhookDeliveries.id, deliveryId));
    return { status: 'FAILED' as const };
  }

  const body = JSON.stringify(row.d.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const secret = decryptSecret(row.ep.secretEnc, opts.encryptionKey);
  let status = 0;
  let error: string | null = null;
  try {
    const res = await safePost(row.ep.url, body, {
      headers: {
        'x-webhook-id': row.d.id,
        'x-webhook-timestamp': String(timestamp),
        'x-webhook-signature': signWebhook(secret, timestamp, body),
        'x-webhook-event': row.d.eventType,
      },
      lookup: opts.lookup,
      ports: opts.ports,
    });
    status = res.status;
    if (status < 200 || status >= 300) error = `HTTP ${status}${res.body ? `: ${res.body.slice(0, 200)}` : ''}`;
  } catch (err) {
    error = (err as Error).message.slice(0, 300);
  }

  const attempts = sql`${webhookDeliveries.attempts} + 1`;
  if (!error) {
    await db.transaction(async (tx) => {
      await tx.update(webhookDeliveries).set({ status: 'SUCCEEDED', attempts, lastStatusCode: status, lastError: null, deliveredAt: new Date() }).where(eq(webhookDeliveries.id, deliveryId));
      await tx.update(webhookEndpoints).set({ failureCount: 0 }).where(eq(webhookEndpoints.id, row.ep.id));
    });
    return { status: 'SUCCEEDED' as const, statusCode: status };
  }
  if (!opts.finalAttempt) {
    await db.update(webhookDeliveries).set({ attempts, lastStatusCode: status || null, lastError: error }).where(eq(webhookDeliveries.id, deliveryId));
    throw new DomainError('upstream', 'WEBHOOK_DELIVERY_FAILED', error);
  }
  await db.transaction(async (tx) => {
    await tx.update(webhookDeliveries).set({ status: 'FAILED', attempts, lastStatusCode: status || null, lastError: error }).where(eq(webhookDeliveries.id, deliveryId));
    const [ep] = await tx
      .update(webhookEndpoints)
      .set({ failureCount: sql`${webhookEndpoints.failureCount} + 1` })
      .where(eq(webhookEndpoints.id, row.ep.id))
      .returning({ failureCount: webhookEndpoints.failureCount });
    if (ep && ep.failureCount >= WEBHOOK_FAILURE_LIMIT) {
      await tx
        .update(webhookEndpoints)
        .set({ enabled: false, disabledReason: `Disabled after ${ep.failureCount} failed deliveries in a row. Last error: ${error}` })
        .where(eq(webhookEndpoints.id, row.ep.id));
      if (row.ep.createdByUserId) {
        await notify(tx, {
          organizationId: row.ep.organizationId,
          userId: row.ep.createdByUserId,
          type: 'automation_failed',
          title: 'A webhook endpoint was switched off',
          body: `${row.ep.url} failed ${ep.failureCount} times in a row. Fix it, then re-enable it in Settings → Webhooks.`,
          link: '/settings/webhooks',
        });
      }
    }
  });
  return { status: 'FAILED' as const, error };
}

/** Deliveries whose enqueue was lost are picked up again by the sweep. */
export async function stalePendingDeliveries(db: Database, olderThanMs = 120_000) {
  const rows = await db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.status, 'PENDING'), eq(webhookDeliveries.attempts, 0), sql`${webhookDeliveries.createdAt} < ${new Date(Date.now() - olderThanMs)}`))
    .limit(200);
  return rows.map((r) => r.id);
}

export const webhookDeliveryJob = (deliveryId: string) => ({
  name: 'webhook.deliver',
  data: { deliveryId },
  opts: { jobId: `wh-${deliveryId}`, attempts: 4, backoff: { type: 'custom' as const }, removeOnComplete: true, removeOnFail: 500 },
});
