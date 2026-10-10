import { createHmac } from 'node:crypto';
import { deliverMessage, MetaGraphProvider, processMetaEvent } from '@leadora/domain';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { ORIGIN, registerAdmin } from '../support/fixtures';
import { sendMessage } from '../support/inbox';

const APP_SECRET = 'meta-app-secret-0123456789';
const TOKEN = 'EAAG-test-access-token-abcdefghijklmnop';

const wa = (messages: object[], statuses: object[] = []) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '1098765432' }, contacts: [{ wa_id: '8801711000222', profile: { name: 'Karim' } }], messages, statuses } }] }],
});
const messenger = (mid: string, text: string, psid = '24681357') => ({
  object: 'page',
  entry: [{ id: '5550001', time: 1, messaging: [{ sender: { id: psid }, recipient: { id: '5550001' }, timestamp: 1, message: { mid, text } }] }],
});

describe('Meta channels: WhatsApp, Messenger, Instagram (spec §89)', () => {
  let t: TestApp;
  let admin: TestAgent;
  const graphCalls: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
  let graphReply: { status: number; json: object } = { status: 200, json: { messages: [{ id: 'wamid.OUT1' }] } };

  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    graphCalls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(graphReply.json), { status: graphReply.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const provider = () => new MetaGraphProvider({ encryptionKey: process.env.DATA_ENCRYPTION_KEY!, graphUrl: 'https://graph.test/v21.0', fetch: fakeFetch });

  const createInbox = async (channel: 'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM', accountId: string) =>
    (
      await admin
        .post('/api/v1/inboxes')
        .set('Origin', ORIGIN)
        .send({ name: `${channel} inbox`, channel, config: { accountId, appSecret: APP_SECRET, accessToken: TOKEN } })
        .expect(201)
    ).body as { inbox: { id: string }; webhookUrl: string; verifyToken: string };
  const post = (inboxId: string, payload: object, secret = APP_SECRET) => {
    const raw = JSON.stringify(payload);
    return request(t.app.getHttpServer())
      .post(`/api/v1/webhooks/meta/${inboxId}`)
      .set('content-type', 'application/json')
      .set('X-Hub-Signature-256', `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`)
      .send(raw);
  };

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    graphCalls.length = 0;
    graphReply = { status: 200, json: { messages: [{ id: 'wamid.OUT1' }] } };
    admin = (await registerAdmin(t)).agent;
  });
  afterAll(async () => t.close());

  it('completes the webhook handshake only with the right verify token, and never returns credentials', async () => {
    const created = await createInbox('WHATSAPP', '1098765432');
    expect(created.webhookUrl).toContain(`/api/v1/webhooks/meta/${created.inbox.id}`);
    expect(JSON.stringify(await admin.get('/api/v1/inboxes').expect(200).then((r) => r.body))).not.toContain(TOKEN);

    const url = `/api/v1/webhooks/meta/${created.inbox.id}`;
    const ok = await request(t.app.getHttpServer()).get(url).query({ 'hub.mode': 'subscribe', 'hub.verify_token': created.verifyToken, 'hub.challenge': '12345' }).expect(200);
    expect(ok.text).toBe('12345');
    await request(t.app.getHttpServer()).get(url).query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' }).expect(403);
  });

  it('receives WhatsApp messages once, replies through the Graph API, and tracks delivery and read', async () => {
    const { inbox } = await createInbox('WHATSAPP', '1098765432');
    const payload = wa([{ id: 'wamid.IN1', from: '8801711000222', timestamp: '1', type: 'text', text: { body: 'Price for 300 units?' } }]);
    await post(inbox.id, payload, 'wrong-secret-wrong-secret').expect(401);
    const { body: first } = await post(inbox.id, payload).expect(200);
    expect((await post(inbox.id, payload).expect(200)).body.duplicate).toBe(true);
    await processMetaEvent(t.db, first.eventId);

    const { body: convs } = await admin.get('/api/v1/conversations').expect(200);
    expect(convs.items[0]).toMatchObject({ inbox: { channel: 'WHATSAPP' }, lead: { fullName: 'Karim', phone: '+8801711000222' }, lastMessagePreview: 'Price for 300 units?' });
    expect((await admin.get('/api/v1/leads').expect(200)).body.items[0].source.type).toBe('WHATSAPP');

    // The same message id in a different payload is still recorded once.
    const again = wa([{ id: 'wamid.IN1', from: '8801711000222', timestamp: '2', type: 'text', text: { body: 'Price for 300 units?' } }]);
    await processMetaEvent(t.db, (await post(inbox.id, again).expect(200)).body.eventId);
    const conversationId = convs.items[0].id;
    expect((await admin.get(`/api/v1/conversations/${conversationId}/messages`).expect(200)).body.items).toHaveLength(1);

    const { body: reply } = await sendMessage(admin, conversationId, { body: '120 BDT per unit.' }).expect(201);
    expect(await deliverMessage(t.db, reply.id, { WHATSAPP: provider() }, { finalAttempt: true })).toMatchObject({ status: 'SENT' });
    expect(graphCalls[0]).toEqual({
      url: 'https://graph.test/v21.0/1098765432/messages',
      auth: `Bearer ${TOKEN}`,
      body: { messaging_product: 'whatsapp', to: '8801711000222', type: 'text', text: { body: '120 BDT per unit.', preview_url: false } },
    });

    for (const status of ['read', 'delivered']) {
      const { body } = await post(inbox.id, wa([], [{ id: 'wamid.OUT1', status, recipient_id: '8801711000222' }])).expect(200);
      await processMetaEvent(t.db, body.eventId);
    }
    const msgs = (await admin.get(`/api/v1/conversations/${conversationId}/messages`).expect(200)).body.items;
    // "delivered" arriving after "read" must not move the status backwards.
    expect(msgs.find((m: { id: string }) => m.id === reply.id).status).toBe('READ');
  });

  it('shows Graph errors such as the 24-hour window on the failed message', async () => {
    const { inbox } = await createInbox('WHATSAPP', '1098765432');
    const { body } = await post(inbox.id, wa([{ id: 'wamid.IN9', from: '8801711000222', timestamp: '1', type: 'image', image: { caption: 'this one' } }])).expect(200);
    await processMetaEvent(t.db, body.eventId);
    const [conv] = (await admin.get('/api/v1/conversations').expect(200)).body.items;
    expect(conv.lastMessagePreview).toBe('[image] this one');

    graphReply = { status: 400, json: { error: { message: 'Re-engagement message: more than 24 hours have passed', code: 131047 } } };
    const { body: reply } = await sendMessage(admin, conv.id, { body: 'Hello again' }).expect(201);
    await expect(deliverMessage(t.db, reply.id, { WHATSAPP: provider() }, { finalAttempt: true })).rejects.toThrow(/24 hours/);
    const msg = (await admin.get(`/api/v1/conversations/${conv.id}/messages`).expect(200)).body.items.find((m: { id: string }) => m.id === reply.id);
    expect(msg).toMatchObject({ status: 'FAILED', error: expect.stringContaining('131047') });
  });

  it('recognises Messenger and Instagram senders by their page-scoped id and replies to them', async () => {
    const { inbox } = await createInbox('FACEBOOK', '5550001');
    await processMetaEvent(t.db, (await post(inbox.id, messenger('m_1', 'Hi there')).expect(200)).body.eventId);
    await processMetaEvent(t.db, (await post(inbox.id, messenger('m_2', 'Still there?')).expect(200)).body.eventId);
    const { body: leads } = await admin.get('/api/v1/leads').expect(200);
    expect(leads.items).toHaveLength(1);
    expect(leads.items[0]).toMatchObject({ fullName: 'Messenger contact', source: { type: 'FACEBOOK' } });

    const [conv] = (await admin.get('/api/v1/conversations').expect(200)).body.items;
    graphReply = { status: 200, json: { recipient_id: '24681357', message_id: 'm_OUT' } };
    const { body: reply } = await sendMessage(admin, conv.id, { body: 'Yes! How can we help?' }).expect(201);
    expect(await deliverMessage(t.db, reply.id, { FACEBOOK: provider() }, { finalAttempt: true })).toMatchObject({ status: 'SENT' });
    expect(graphCalls[0]!.body).toEqual({ recipient: { id: '24681357' }, messaging_type: 'RESPONSE', message: { text: 'Yes! How can we help?' } });

    const ig = await createInbox('INSTAGRAM', '178414000');
    const igPayload = { object: 'instagram', entry: [{ id: '178414000', time: 1, messaging: [{ sender: { id: '999' }, recipient: { id: '178414000' }, timestamp: 1, message: { mid: 'ig_1', text: 'Is this available?' } }] }] };
    await processMetaEvent(t.db, (await post(ig.inbox.id, igPayload).expect(200)).body.eventId);
    expect((await admin.get('/api/v1/leads').expect(200)).body.items.map((l: { source: { type: string } }) => l.source.type).sort()).toEqual(['FACEBOOK', 'INSTAGRAM']);
  });
});
