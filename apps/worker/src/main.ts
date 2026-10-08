import http from 'node:http';
import { Worker, type Job } from 'bullmq';
import pino from 'pino';
import { baseLoggerOptions, loadEnv } from '@leadora/config';
import { createDb } from '@leadora/database';
import { type ChannelProviders, deliverMessage, markLeadImportFailed, processLeadImport, REALTIME_CHANNEL } from '@leadora/domain';
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
const providers: ChannelProviders = email ? { EMAIL: email } : {};
const publish = async (organizationId: string, type: string, data: Record<string, unknown>) => {
  await publisher.publish(REALTIME_CHANNEL, JSON.stringify({ organizationId, type, data })).catch(() => undefined);
};

// Handlers are registered per queue as features land; unknown job names fail loudly.
const handlers: Partial<Record<QueueName, Record<string, (job: Job) => Promise<unknown>>>> = {
  default: {
    'system.ping': async (job) => ({ pong: true, at: new Date().toISOString(), id: job.id }),
  },
  messages: {
    'message.send': (job) =>
      handleMessageSend({ deliver: (id, finalAttempt) => deliverMessage(db, id, providers, { finalAttempt }), publish }, job),
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
  worker.on('completed', (job) => log.info({ queue: name, jobId: job.id, job: job.name }, 'job.completed'));
  worker.on('failed', (job, err) =>
    log.error({ queue: name, jobId: job?.id, job: job?.name, attempts: job?.attemptsMade, err: err.message }, 'job.failed'),
  );
  worker.on('error', (err) => log.error({ queue: name, err: err.message }, 'worker.error'));
  return worker;
});

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
  await Promise.allSettled(workers.map((w) => w.close()));
  await pool.end();
  email?.close();
  publisher.disconnect();
  log.info('worker.stopped');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
