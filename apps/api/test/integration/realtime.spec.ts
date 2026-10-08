import type { AddressInfo } from 'node:net';
import request from 'supertest';
import WebSocket from 'ws';
import type TestAgent from 'supertest/lib/agent';
import { RealtimePublisher } from '../../src/realtime/realtime.publisher';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createOtherOrg } from '../support/orgs';

describe('realtime websocket', () => {
  let t: TestApp;
  let url: string;
  let admin: TestAgent;
  let adminCookie: string;
  let orgId: string;
  let adminId: string;

  function connect(cookie?: string, origin = ORIGIN) {
    const ws = new WebSocket(url, { headers: { ...(cookie ? { cookie } : {}), origin } });
    const events: { type: string; data: Record<string, unknown> }[] = [];
    let ready: () => void;
    const opened = new Promise<void>((resolve) => (ready = resolve));
    ws.on('message', (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === 'ready') ready();
      else events.push(event);
    });
    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
    return { ws, events, opened, closed };
  }
  const until = async (cond: () => boolean, ms = 3000) => {
    const start = Date.now();
    while (!cond() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 25));
  };
  async function cookieFor(email: string, password: string) {
    const { res } = await login(t, email, password);
    return String(res.headers['set-cookie']).split(';')[0]!;
  }

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.listen(0, '127.0.0.1');
    const { port } = t.app.getHttpServer().address() as AddressInfo;
    url = `ws://127.0.0.1:${port}/api/v1/realtime`;
  });
  beforeEach(async () => {
    await t.reset();
    const r = await registerAdmin(t);
    admin = r.agent;
    orgId = r.organization.id;
    adminId = r.user.id;
    adminCookie = await cookieFor('rahim@acme.test', 'correct horse battery');
  });
  afterAll(async () => t.close());

  it('refuses connections without a session', async () => {
    const c = connect();
    expect(await c.closed).toBe(4401);
  });

  it('refuses connections from a foreign origin (cross-site WebSocket hijacking)', async () => {
    const c = connect(adminCookie, 'https://evil.example');
    expect(await c.closed).toBe(4403);
  });

  it('delivers organization events only to that organization', async () => {
    const mine = connect(adminCookie);
    await createOtherOrg(t, 'rival');
    const rival = connect(await cookieFor('admin@rival.test', 'another strong password'));
    await Promise.all([mine.opened, rival.opened]);

    await t.app.get(RealtimePublisher).publish(orgId, 'lead.updated', { leadId: 'x' });
    await until(() => mine.events.length > 0);
    expect(mine.events).toEqual([{ type: 'lead.updated', data: { leadId: 'x' } }]);
    await new Promise((r) => setTimeout(r, 200));
    expect(rival.events).toEqual([]);
    mine.ws.close();
    rival.ws.close();
  });

  it('delivers user-targeted events only to that user', async () => {
    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'karim@acme.test', fullName: 'Karim', role: 'AGENT', password: 'agent strong password' })
      .expect(201);
    const me = connect(adminCookie);
    const colleague = connect(await cookieFor('karim@acme.test', 'agent strong password'));
    await Promise.all([me.opened, colleague.opened]);

    await t.app.get(RealtimePublisher).publish(orgId, 'notification.created', { id: 'n1' }, adminId);
    await until(() => me.events.length > 0);
    expect(me.events[0]).toMatchObject({ type: 'notification.created' });
    await new Promise((r) => setTimeout(r, 200));
    expect(colleague.events).toEqual([]);
    me.ws.close();
    colleague.ws.close();
  });

  it('closes sockets after logout', async () => {
    const c = connect(adminCookie);
    await c.opened;
    // A plain request (not the agent, whose cookie jar holds a different session) ends the socket's session.
    await request(t.app.getHttpServer()).post('/api/v1/auth/logout').set('Origin', ORIGIN).set('cookie', adminCookie).expect(204);
    await t.app.get(RealtimePublisher).publish(orgId, 'ping', {});
    expect(await c.closed).toBe(4401);
  });
});
