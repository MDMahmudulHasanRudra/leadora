import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { configureErrorReporting, flushErrorReports, type SentryEvent } from '@leadora/config';
import { LeadReader } from '../../src/leads/lead-reader.service';
import { createTestApp, type TestApp } from '../support/app';
import { ORIGIN, registerAdmin } from '../support/fixtures';

// Spec §70, §141: unexpected errors reach the error tracker (Sentry/GlitchTip envelope); API contract errors
// (4xx, domain errors) do not, and reports carry ids but no personal data.
describe('error tracking', () => {
  let t: TestApp;
  const events: SentryEvent[] = [];
  const receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      events.push(JSON.parse(body.trim().split('\n')[2]!));
      res.end('{}');
    });
  });

  beforeAll(async () => {
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    process.env.ERROR_TRACKING_DSN = `http://key@127.0.0.1:${(receiver.address() as AddressInfo).port}/1`;
    // A reader that fails the way a bug would.
    t = await createTestApp([{ token: LeadReader, value: { get: async () => Promise.reject(new TypeError('cannot read properties of undefined')) } }]);
  });
  afterAll(async () => {
    delete process.env.ERROR_TRACKING_DSN;
    configureErrorReporting(null);
    await t.close();
    receiver.close();
  });
  beforeEach(async () => {
    await t.reset();
    events.length = 0;
  });

  it('reports an unexpected error with request and tenant ids, and answers with the generic 500', async () => {
    const { agent, user, organization } = await registerAdmin(t);
    const res = await agent.get('/api/v1/leads/00000000-0000-4000-8000-000000000001?q=rahim@shop.test').set('Origin', ORIGIN).expect(500);
    expect(res.body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });

    await flushErrorReports();
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event!.exception.values[0]).toMatchObject({ type: 'TypeError', value: 'cannot read properties of undefined' });
    expect(event!.tags).toMatchObject({ service: 'api', requestId: res.body.error.requestId, organizationId: organization.id, route: '/api/v1/leads/:id' });
    expect(event!.user).toEqual({ id: user.id });
    expect(event!.request).toEqual({ method: 'GET', url: '/api/v1/leads/00000000-0000-4000-8000-000000000001' });
    expect(JSON.stringify(event)).not.toMatch(/rahim|acme\.test|cookie/i);
  });

  it('does not report client errors', async () => {
    const { agent } = await registerAdmin(t);
    await agent.get('/api/v1/users/00000000-0000-4000-8000-000000000001').expect(404);
    await agent.post('/api/v1/leads').set('Origin', ORIGIN).send({}).expect(422);
    await flushErrorReports();
    expect(events).toHaveLength(0);
  });
});
