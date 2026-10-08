import { deliverMessage, webChatProvider } from '@leadora/domain';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { ORIGIN, registerAdmin } from '../support/fixtures';
import { sendMessage } from '../support/inbox';

const SITE = 'https://shop.example';

describe('website chat (spec §111)', () => {
  let t: TestApp;
  let admin: TestAgent;
  let widgetKey: string;
  let inboxId: string;
  let ip = 10;

  const api = () => request(t.app.getHttpServer());
  const start = (body: object, origin: string | null = SITE) => {
    const r = api().post(`/api/v1/public/chat/${widgetKey}/sessions`).set('X-Forwarded-For', `198.51.100.${ip}`);
    return (origin ? r.set('Origin', origin) : r).send(body);
  };
  const say = (token: string, text: string) => api().post(`/api/v1/public/chat/${widgetKey}/messages`).set('Origin', SITE).set('X-Chat-Token', token).send({ text });
  const poll = (token: string, after = 0) => api().get(`/api/v1/public/chat/${widgetKey}/messages?after=${after}`).set('Origin', SITE).set('X-Chat-Token', token);

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    ip++;
    admin = (await registerAdmin(t)).agent;
    const { body } = await admin
      .post('/api/v1/inboxes')
      .set('Origin', ORIGIN)
      .send({ name: 'Website chat', channel: 'WEB_CHAT', config: { allowedOrigins: [SITE], title: 'Chat with us', greeting: 'Hi! How can we help?' } })
      .expect(201);
    widgetKey = body.widgetKey;
    inboxId = body.inbox.id;
    expect(body.embedCode).toContain(`data-widget-key="${widgetKey}"`);
  });
  afterAll(async () => t.close());

  it('turns a visitor into a lead and a conversation, and carries replies both ways', async () => {
    expect((await api().get(`/api/v1/public/chat/${widgetKey}`).expect(200)).body).toEqual({ title: 'Chat with us', greeting: 'Hi! How can we help?' });

    const { body: session } = await start({ name: 'Rina', email: 'rina@visitor.example', message: 'Do you ship to Chittagong?' }).expect(201);
    expect(session.token).toBeTruthy();
    expect(session.messages).toEqual([expect.objectContaining({ from: 'you', text: 'Do you ship to Chittagong?' })]);

    const { body: convs } = await admin.get('/api/v1/conversations').expect(200);
    expect(convs.items[0]).toMatchObject({ inbox: { id: inboxId, channel: 'WEB_CHAT' }, lead: { fullName: 'Rina', email: 'rina@visitor.example' }, lastMessagePreview: 'Do you ship to Chittagong?' });
    const conversationId = convs.items[0].id;

    // An agent replies in the normal inbox; the chat "provider" just marks it sent.
    const { body: reply } = await sendMessage(admin, conversationId, { body: 'Yes, 2-3 days.' }).expect(201);
    await sendMessage(admin, conversationId, { body: 'VIP customer', internal: true }).expect(201);
    expect(await deliverMessage(t.db, reply.id, { WEB_CHAT: webChatProvider }, { finalAttempt: true })).toMatchObject({ status: 'SENT' });

    const { body: seen } = await poll(session.token).expect(200);
    expect(seen.items.map((m: { from: string; text: string }) => `${m.from}: ${m.text}`)).toEqual(['you: Do you ship to Chittagong?', 'agent: Yes, 2-3 days.']);

    await say(session.token, 'Great, thanks!').expect(201);
    const { body: after } = await poll(session.token, seen.items.at(-1).seq).expect(200);
    expect(after.items.map((m: { text: string }) => m.text)).toEqual(['Great, thanks!']);
    const { body: msgs } = await admin.get(`/api/v1/conversations/${conversationId}/messages`).expect(200);
    expect(msgs.items.filter((m: { direction: string }) => m.direction === 'INBOUND')).toHaveLength(2);
  });

  it('keeps each chat session private, even for a repeat email', async () => {
    const { body: first } = await start({ name: 'Rina', email: 'rina@visitor.example', message: 'My order number is 4411' }).expect(201);
    const { body: second } = await start({ name: 'Someone else', email: 'rina@visitor.example', message: 'Hello' }).expect(201);
    const { body: seen } = await poll(second.token).expect(200);
    expect(seen.items.map((m: { text: string }) => m.text)).toEqual(['Hello']);
    // Same lead, separate conversations.
    expect((await admin.get('/api/v1/leads').expect(200)).body.items).toHaveLength(1);
    expect((await admin.get('/api/v1/conversations').expect(200)).body.items).toHaveLength(2);
    void first;
  });

  it('rejects bad tokens, foreign origins, empty messages and floods', async () => {
    const { body: session } = await start({ name: 'Rina', message: 'Hi' }).expect(201);
    await poll('nope').expect(401);
    await poll(session.token.slice(0, -2) + 'xx').expect(401);
    await say(session.token, '').expect(422);
    expect((await start({ name: 'X', message: 'Hi' }, 'https://evil.example').expect(403)).body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    await start({ name: 'X', email: 'not-an-email', message: 'Hi' }).expect(422);

    // A token for one widget does not work on another.
    const { body: other } = await admin
      .post('/api/v1/inboxes')
      .set('Origin', ORIGIN)
      .send({ name: 'Other chat', channel: 'WEB_CHAT', config: { allowedOrigins: [] } })
      .expect(201);
    await api().get(`/api/v1/public/chat/${other.widgetKey}/messages`).set('X-Chat-Token', session.token).expect(401);

    for (let i = 0; i < 4; i++) await start({ name: `V${i}`, message: 'Hi' }).expect(201);
    expect((await start({ name: 'Flood', message: 'Hi' }).expect(429)).body.error.code).toBe('RATE_LIMITED');
  });
});
