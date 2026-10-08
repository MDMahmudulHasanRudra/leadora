import { createHmac } from 'node:crypto';
import type { LookupAddress } from 'node:dns';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { deliverWebhook, dispatchEvents, WEBHOOK_FAILURE_LIMIT } from '@leadora/domain';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead } from '../support/leads';
import { testEnv } from '../support/test-env';

interface Received {
  headers: http.IncomingHttpHeaders;
  body: string;
}

describe('outbound webhooks (spec §93)', () => {
  let t: TestApp;
  let admin: TestAgent;
  let server: http.Server;
  let port: number;
  let queue: Queue;
  const received: Received[] = [];
  let respondWith = 200;

  // Stand-in for a public host: "hooks.test" resolves to the local receiver (test-only resolver).
  const lookup = ((_h: string, o: { all?: boolean }, cb: (e: Error | null, a: string | LookupAddress[], f?: number) => void) =>
    o.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)) as never;
  const deliver = (id: string, finalAttempt = true) =>
    deliverWebhook(t.db, id, { encryptionKey: process.env.DATA_ENCRYPTION_KEY!, finalAttempt, lookup, ports: [String(port)] });
  const createEndpoint = async (events: string[]) => {
    const { body } = await admin.post('/api/v1/webhooks').set('Origin', ORIGIN).send({ url: 'https://hooks.example/leadora', events }).expect(201);
    // Point it at the local receiver (the API only accepts standard ports).
    await t.db.execute(sql`update webhook_endpoints set url = ${`http://hooks.test:${port}/in`} where id = ${body.id}`);
    return body as { id: string; secret: string };
  };
  const dispatch = () => dispatchEvents(t.db, { enqueueRun: async () => undefined, enqueueDelivery: async () => undefined });

  beforeAll(async () => {
    t = await createTestApp();
    queue = new Queue('webhooks', { connection: { url: testEnv().valkeyUrl } });
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.writeHead(respondWith).end(respondWith === 200 ? 'ok' : 'nope');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  beforeEach(async () => {
    await t.reset();
    received.length = 0;
    respondWith = 200;
    admin = (await registerAdmin(t)).agent;
  });
  afterAll(async () => {
    server.close();
    await queue.close();
    await t.close();
  });

  it('signs and delivers subscribed events with a stable id, and only subscribed ones', async () => {
    const ep = await createEndpoint(['lead.created']);
    expect(ep.secret).toMatch(/^whsec_/);
    expect(JSON.stringify((await admin.get('/api/v1/webhooks').expect(200)).body)).not.toContain(ep.secret);

    const lead = (await createLead(admin, { fullName: 'Hooked Lead', email: 'hook@shop.test' }).expect(201)).body;
    const { deliveries } = await dispatch();
    expect(deliveries).toHaveLength(1);
    // Re-dispatching the same event never creates a second delivery.
    await t.db.execute(sql`update domain_events set processed_at = null`);
    expect((await dispatch()).deliveries).toEqual([]);

    expect(await deliver(deliveries[0]!)).toMatchObject({ status: 'SUCCEEDED', statusCode: 200 });
    const [hit] = received;
    const body = JSON.parse(hit!.body);
    expect(body).toMatchObject({ type: 'lead.created', data: { lead: { id: lead.id, fullName: 'Hooked Lead', email: 'hook@shop.test' } } });
    const ts = hit!.headers['x-webhook-timestamp'];
    const expected = `v1=${createHmac('sha256', ep.secret).update(`${ts}.${hit!.body}`).digest('hex')}`;
    expect(hit!.headers['x-webhook-signature']).toBe(expected);
    expect(hit!.headers['x-webhook-id']).toBe(deliveries[0]);
    expect(hit!.headers['x-webhook-event']).toBe('lead.created');

    // Not subscribed to stage changes → nothing sent.
    await admin.patch(`/api/v1/leads/${lead.id}`).set('Origin', ORIGIN).send({ priority: 'HIGH' }).expect(200);
    expect((await dispatch()).deliveries).toEqual([]);

    const { body: log } = await admin.get(`/api/v1/webhooks/${ep.id}/deliveries`).expect(200);
    expect(log.items[0]).toMatchObject({ eventType: 'lead.created', status: 'SUCCEEDED', lastStatusCode: 200, attempts: 1 });
  });

  it('retries failures, records them, and disables an endpoint that keeps failing', async () => {
    const ep = await createEndpoint(['*']);
    respondWith = 500;
    await createLead(admin).expect(201);
    const [id] = (await dispatch()).deliveries;

    await expect(deliver(id!, false)).rejects.toThrow(/HTTP 500/);
    expect(await deliver(id!, true)).toMatchObject({ status: 'FAILED' });
    // The same X-Webhook-ID on every attempt lets receivers deduplicate.
    expect(new Set(received.map((r) => r.headers['x-webhook-id']))).toEqual(new Set([id]));

    await t.db.execute(sql`update webhook_endpoints set failure_count = ${WEBHOOK_FAILURE_LIMIT - 1}`);
    await createLead(admin, { fullName: 'Another', email: 'another@shop.test' }).expect(201);
    const [next] = (await dispatch()).deliveries;
    await deliver(next!, true);
    const { body } = await admin.get('/api/v1/webhooks').expect(200);
    expect(body.items[0]).toMatchObject({ enabled: false, disabledReason: expect.stringContaining('failed deliveries') });
    const { body: notes } = await admin.get('/api/v1/notifications').expect(200);
    expect(notes.items[0].title).toMatch(/webhook/i);

    // Re-enabling resets the failure count; a redelivery succeeds once the receiver recovers.
    respondWith = 200;
    expect((await admin.patch(`/api/v1/webhooks/${ep.id}`).set('Origin', ORIGIN).send({ enabled: true }).expect(200)).body).toMatchObject({ enabled: true, failureCount: 0 });
    await admin.post(`/api/v1/webhooks/deliveries/${next}/redeliver`).set('Origin', ORIGIN).expect(202);
    expect(await queue.getJob(`wh-${next}`)).toBeTruthy();
    expect(await deliver(next!)).toMatchObject({ status: 'SUCCEEDED' });
  });

  it('sends a signed test ping and rotates the secret', async () => {
    const ep = await createEndpoint(['lead.created']);
    const { body: ping } = await admin.post(`/api/v1/webhooks/${ep.id}/test`).set('Origin', ORIGIN).expect(202);
    expect(await deliver(ping.deliveryId)).toMatchObject({ status: 'SUCCEEDED' });
    expect(JSON.parse(received[0]!.body).type).toBe('webhook.test');

    const { body: rotated } = await admin.post(`/api/v1/webhooks/${ep.id}/rotate-secret`).set('Origin', ORIGIN).expect(200);
    expect(rotated.secret).not.toBe(ep.secret);
    const { body: ping2 } = await admin.post(`/api/v1/webhooks/${ep.id}/test`).set('Origin', ORIGIN).expect(202);
    await deliver(ping2.deliveryId);
    const hit = received[1]!;
    expect(hit.headers['x-webhook-signature']).toBe(`v1=${createHmac('sha256', rotated.secret).update(`${hit.headers['x-webhook-timestamp']}.${hit.body}`).digest('hex')}`);
  });

  it('refuses private URLs and unknown events, and restricts management', async () => {
    const post = (body: object) => admin.post('/api/v1/webhooks').set('Origin', ORIGIN).send(body);
    expect((await post({ url: 'http://169.254.169.254/latest', events: ['lead.created'] }).expect(422)).body.error.code).toBe('URL_NOT_ALLOWED');
    expect((await post({ url: 'http://localhost:3001/x', events: ['lead.created'] }).expect(422)).body.error.code).toBe('URL_NOT_ALLOWED');
    await post({ url: 'https://hooks.example/x', events: ['lead.exploded'] }).expect(422);
    await post({ url: 'https://hooks.example/x', events: [] }).expect(422);

    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'a@acme.test', fullName: 'Agent', role: 'AGENT', password: 'agent strong password' })
      .expect(201);
    const { agent } = await login(t, 'a@acme.test', 'agent strong password');
    await agent.get('/api/v1/webhooks').expect(403);
  });
});
