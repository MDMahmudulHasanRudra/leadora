import http from 'node:http';
import { Queue, Worker, type Job } from 'bullmq';
import pino from 'pino';
import { baseLoggerOptions, loadEnv } from '@leadora/config';
import { OpenAiProvider } from '@leadora/ai';
import { createDb } from '@leadora/database';
import {
  type ChannelProviders,
  automationRunJob,
  deliverMessage,
  deliverWebhook,
  dispatchEvents,
  dispatchInactiveLeads,
  emitOverdueFollowupEvents,
  executeRun,
  indexDocument,
  MetaGraphProvider,
  markLeadImportFailed,
  processInboundEvent,
  processEmailStatusEvent,
  processLeadImport,
  processMetaEvent,
  purgeProcessedEvents,
  REALTIME_CHANNEL,
  organizationsNeedingRescore,
  rescoreOrganization,
  sendFollowupReminders,
  stalePendingDeliveries,
  staleQueuedRuns,
  webChatProvider,
  webhookDeliveryJob,
} from '@leadora/domain';
import { createStorage } from '@leadora/storage';
import Redis from 'ioredis';
import { handleLeadImport } from './handlers/lead-import';
import { handleMessageSend } from './handlers/message-send';
import { SmtpEmailProvider } from './providers/email';
import { QUEUES, retryDelay, type QueueName } from './queues';

const env = loadEnv();
const log = pino(baseLoggerOptions('worker', env.LOG_LEVEL));
const { db, pool } = createDb(env.DATABASE_URL);

const connection = { url: env.VALKEY_URL, maxRetriesPerRequest: null };
const publisher = new Redis(env.VALKEY_URL, { maxRetriesPerRequest: 2 });
const email = env.SMTP_URL ? new SmtpEmailProvider(env.SMTP_URL) : null;
const meta = new MetaGraphProvider({ encryptionKey: env.DATA_ENCRYPTION_KEY, graphUrl: env.META_GRAPH_URL });
const providers: ChannelProviders = { WEB_CHAT: webChatProvider, WHATSAPP: meta, FACEBOOK: meta, INSTAGRAM: meta, ...(email ? { EMAIL: email } : {}) };
const storage = createStorage(env);
// Same provider wiring as the API's AI module; the org's own key comes from ai_settings per call.
const aiDeps = {
  platformEnabled: env.ENABLE_AI,
  encryptionKey: env.DATA_ENCRYPTION_KEY,
  providerFor: (provider: string, apiKey: string) => {
    if (provider === 'openai') return new OpenAiProvider({ apiKey });
    throw new Error(`Unsupported AI provider ${provider}`);
  },
};
const automationsQueue = new Queue('automations', { connection });
const messagesQueue = new Queue('messages', { connection });
const webhooksQueue = new Queue('webhooks', { connection });
const enqueueDelivery = async (deliveryId: string) => {
  const job = webhookDeliveryJob(deliveryId);
  await webhooksQueue.add(job.name, job.data, job.opts);
};
const enqueueRun = async (runId: string) => {
  const job = automationRunJob(runId);
  await automationsQueue.add(job.name, job.data, job.opts);
};
const automationDeps = {
  ai: aiDeps,
  // Same job shape as a human reply, so automated emails get the same retries and threading.
  enqueueMessage: async (messageId: string) => {
    await messagesQueue.add('message.send', { messageId }, { jobId: messageId, attempts: 4, backoff: { type: 'custom' } });
  },
  knowledgeEnabled: env.ENABLE_KNOWLEDGE_BASE,
};
const isFinal = (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
// Frequent housekeeping jobs log only when they fail.
const QUIET_JOBS = new Set(['events.dispatch', 'automations.sweep']);

const publish = async (organizationId: string, type: string, data: Record<string, unknown>, userId?: string) => {
  await publisher.publish(REALTIME_CHANNEL, JSON.stringify({ organizationId, type, data, ...(userId ? { userId } : {}) })).catch(() => undefined);
};

// Handlers are registered per queue as features land; unknown job names fail loudly.
const handlers: Partial<Record<QueueName, Record<string, (job: Job) => Promise<unknown>>>> = {
  default: {
    'system.ping': async (job) => ({ pong: true, at: new Date().toISOString(), id: job.id }),
    'followups.remind': async () => ({ reminded: await sendFollowupReminders(db, new Date()) }),
    'scoring.rescore_org': async (job) => ({ changed: await rescoreOrganization(db, job.data.organizationId) }),
  },
  messages: {
    'email.status': async (job) => {
      const result = await processEmailStatusEvent(db, job.data.eventId);
      if (result.status === 'PROCESSED') await publish(result.organizationId, 'message.updated', { conversationId: result.conversationId });
    },
    'meta.process': async (job) => {
      const result = await processMetaEvent(db, job.data.eventId);
      if (result.status === 'PROCESSED') {
        for (const conversationId of result.conversations) await publish(result.organizationId!, 'conversation.updated', { conversationId });
      }
    },
    'message.send': (job) =>
      handleMessageSend({ deliver: (id, finalAttempt) => deliverMessage(db, id, providers, { finalAttempt }), publish }, job),
    'inbound.process': async (job) => {
      const result = await processInboundEvent(db, job.data.eventId);
      if (result.status === 'PROCESSED' && result.organizationId) {
        await publish(result.organizationId, 'conversation.updated', { conversationId: result.conversationId });
        if (result.notifyUserId) await publish(result.organizationId, 'notification.created', {}, result.notifyUserId);
      }
    },
  },
  embeddings: {
    'kb.index': (job) => indexDocument(db, { ai: aiDeps, storage }, job.data.documentId, { finalAttempt: isFinal(job) }),
  },
  automations: {
    // Spec §40-41: outbox → rules → runs. Runs on every instance; SKIP LOCKED keeps them from sharing events.
    'events.dispatch': () => dispatchEvents(db, { enqueueRun, enqueueDelivery, rulesEnabled: env.ENABLE_AUTOMATION }),
    'automation.run': (job) => executeRun(db, automationDeps, job.data.runId, { finalAttempt: isFinal(job) }),
    'automations.sweep': async () => {
      const overdue = await emitOverdueFollowupEvents(db);
      const stale = await staleQueuedRuns(db);
      for (const id of stale) await enqueueRun(id);
      const staleDeliveries = await stalePendingDeliveries(db);
      for (const id of staleDeliveries) await enqueueDelivery(id);
      return { overdue, requeued: stale.length + staleDeliveries.length };
    },
    'automations.inactive': async () => ({ runs: env.ENABLE_AUTOMATION ? (await dispatchInactiveLeads(db, { enqueueRun })).length : 0 }),
    'events.purge': async () => ({ purged: await purgeProcessedEvents(db) }),
  },
  webhooks: {
    'webhook.deliver': (job) => deliverWebhook(db, job.data.deliveryId, { encryptionKey: env.DATA_ENCRYPTION_KEY, finalAttempt: isFinal(job) }),
  },
  imports: {
    'lead.import': (job) =>
      handleLeadImport(
        { process: (id) => processLeadImport(db, id), markFailed: (id, msg) => markLeadImportFailed(db, id, msg) },
        job,
      ),
  },
};

const workers = (Object.keys(QUEUES) as QueueName[]).map((name) => {
  const worker = new Worker(
    name,
    async (job) => {
      const handler = handlers[name]?.[job.name];
      if (!handler) throw new Error(`No handler for ${name}:${job.name}`);
      return handler(job);
    },
    {
      connection,
      concurrency: QUEUES[name].concurrency,
      settings: { backoffStrategy: (attemptsMade: number) => retryDelay(attemptsMade) },
    },
  );
  worker.on('completed', (job) => {
    if (!QUIET_JOBS.has(job.name)) log.info({ queue: name, jobId: job.id, job: job.name }, 'job.completed');
  });
  worker.on('failed', (job, err) =>
    log.error({ queue: name, jobId: job?.id, job: job?.name, attempts: job?.attemptsMade, err: err.message }, 'job.failed'),
  );
  worker.on('error', (err) => log.error({ queue: name, err: err.message }, 'worker.error'));
  return worker;
});

// Every worker instance upserts the same scheduler id, so the job exists once cluster-wide.
const scheduler = new Queue('default', { connection });
void Promise.all([
  scheduler.upsertJobScheduler('followup-reminders', { every: 60_000 }, { name: 'followups.remind' }),
  automationsQueue.upsertJobScheduler('events-dispatch', { every: 2_000 }, { name: 'events.dispatch' }),
  automationsQueue.upsertJobScheduler('automations-sweep', { every: 60_000 }, { name: 'automations.sweep' }),
  automationsQueue.upsertJobScheduler('automations-inactive', { every: 3_600_000 }, { name: 'automations.inactive' }),
  automationsQueue.upsertJobScheduler('events-purge', { every: 86_400_000 }, { name: 'events.purge' }),
]).catch((err: Error) => log.error({ err: err.message }, 'scheduler.failed'));

// Leads that predate scoring (or a failed rescore) have no scored_at; queue their orgs once on boot.
// The jobId dedupes across worker instances.
void organizationsNeedingRescore(db)
  .then((orgs) =>
    Promise.all(orgs.map((organizationId) => scheduler.add('scoring.rescore_org', { organizationId }, { jobId: `rescore-${organizationId}`, removeOnComplete: true }))),
  )
  .catch((err: Error) => log.error({ err: err.message }, 'scoring.backfill_failed'));

const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 3002);
const server = http.createServer((req, res) => {
  if (req.url === '/health/live') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
    return;
  }
  if (req.url === '/health/ready') {
    const ready = workers.every((w) => w.isRunning());
    res
      .writeHead(ready ? 200 : 503, { 'content-type': 'application/json' })
      .end(JSON.stringify({ status: ready ? 'ok' : 'error', queues: workers.length }));
    return;
  }
  res.writeHead(404).end();
});
server.listen(healthPort, '0.0.0.0', () =>
  log.info({ queues: Object.keys(QUEUES), healthPort }, 'worker.started'),
);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'worker.stopping');
  server.close();
  await Promise.allSettled([...workers.map((w) => w.close()), scheduler.close(), automationsQueue.close(), messagesQueue.close(), webhooksQueue.close()]);
  await pool.end();
  email?.close();
  publisher.disconnect();
  log.info('worker.stopped');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
