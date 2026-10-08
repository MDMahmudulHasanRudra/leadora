import { type ChannelProvider, deliverMessage, processInboundEvent } from '@leadora/domain';
import { Queue } from 'bullmq';
import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { ORIGIN, registerAdmin } from '../support/fixtures';
import { createEmailInbox, startConversation } from '../support/inbox';
import { createLead } from '../support/leads';
import { testEnv } from '../support/test-env';
import { postInbound } from '../support/webhook';

const email = (over: object = {}) => ({
  messageId: '<in-1@customer.test>',
  from: { email: 'Nadia@Customer.test', name: 'Nadia Karim' },
  to: 'sales@acme.test',
  subject: 'Price for 500 units?',
  text: 'Hi, what is your price for 500 units?',
  ...over,
});

describe('inbound email webhook', () => {
  let t: TestApp;
  let admin: TestAgent;
  let inboxId: string;
  let secret: string;
  let queue: Queue;

  const conversations = async (view = 'all') => (await admin.get(`/api/v1/conversations?view=${view}`).expect(200)).body.items;

  beforeAll(async () => {
    t = await createTestApp();
    queue = new Queue('messages', { connection: { url: testEnv().valkeyUrl } });
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await registerAdmin(t)).agent;
    ({ inbox: { id: inboxId }, webhookSecret: secret } = await createEmailInbox(admin, 'Sales', 'sales@acme.test'));
  });
  afterAll(async () => {
    await queue.close();
    await t.close();
  });

  async function deliver(payload: object) {
    const res = await postInbound(t, inboxId, secret, payload).expect(202);
    await processInboundEvent(t.db, res.body.eventId);
    return res.body;
  }

  it('accepts a signed email, queues it, and turns an unknown sender into a lead and conversation', async () => {
    const res = await postInbound(t, inboxId, secret, email()).expect(202);
    expect(res.body).toMatchObject({ received: true, duplicate: false });
    expect(await queue.getJob(`inbound-${res.body.eventId}`)).toBeTruthy();

    await processInboundEvent(t.db, res.body.eventId);
    const [conv] = await conversations();
    expect(conv).toMatchObject({ subject: 'Price for 500 units?', unread: true, waitingOn: 'AGENT', lead: { fullName: 'Nadia Karim', email: 'nadia@customer.test' } });

    const lead = (await admin.get(`/api/v1/leads/${conv.lead.id}`).expect(200)).body;
    expect(lead.source.type).toBe('EMAIL');
    const msgs = (await admin.get(`/api/v1/conversations/${conv.id}/messages`).expect(200)).body.items;
    expect(msgs).toEqual([expect.objectContaining({ direction: 'INBOUND', status: 'RECEIVED', content: 'Hi, what is your price for 500 units?' })]);
    const { body } = await admin.get(`/api/v1/leads/${lead.id}/activities`).expect(200);
    expect(body.items[0]).toMatchObject({ type: 'message.received', payload: { channel: 'EMAIL' } });
  });

  it('threads a reply into the conversation it answers', async () => {
    const lead = (await createLead(admin).expect(201)).body;
    const started = (await startConversation(admin, { inboxId, leadId: lead.id, subject: 'Quote', body: 'Here is the quote' }).expect(201)).body;
    const fake: ChannelProvider = { send: async () => ({ externalMessageId: '<out-1@acme.test>' }) };
    await deliverMessage(t.db, started.message.id, { EMAIL: fake }, { finalAttempt: false });

    await deliver(email({ messageId: '<in-2@x>', from: { email: 'sadia@example.com' }, subject: 'Re: Quote', inReplyTo: '<out-1@acme.test>' }));
    const all = await conversations();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: started.conversation.id, waitingOn: 'AGENT', unread: true });
    expect((await admin.get('/api/v1/leads?limit=100').expect(200)).body.items).toHaveLength(1);
  });

  it('reopens a resolved conversation when the customer writes again', async () => {
    await deliver(email());
    const [conv] = await conversations();
    await admin.patch(`/api/v1/conversations/${conv.id}`).set('Origin', ORIGIN).send({ status: 'RESOLVED' }).expect(200);
    await deliver(email({ messageId: '<in-3@customer.test>', inReplyTo: '<in-1@customer.test>', text: 'One more question' }));
    expect((await conversations())[0]).toMatchObject({ id: conv.id, status: 'OPEN' });
  });

  it('treats a redelivered email as a duplicate', async () => {
    const first = await deliver(email());
    const again = await postInbound(t, inboxId, secret, email()).expect(200);
    expect(again.body).toEqual({ received: true, duplicate: true, eventId: first.eventId });
    await processInboundEvent(t.db, first.eventId);
    const [conv] = await conversations();
    expect((await admin.get(`/api/v1/conversations/${conv.id}/messages`).expect(200)).body.items).toHaveLength(1);
  });

  it('rejects bad signatures, stale timestamps, unknown inboxes and malformed payloads', async () => {
    expect((await postInbound(t, inboxId, secret, email(), { badSignature: true }).expect(401)).body.error.code).toBe('INVALID_SIGNATURE');
    const stale = Math.floor(Date.now() / 1000) - 3600;
    expect((await postInbound(t, inboxId, secret, email(), { timestamp: stale }).expect(401)).body.error.code).toBe('INVALID_SIGNATURE');
    await postInbound(t, '00000000-0000-0000-0000-000000000000', secret, email()).expect(404);
    await postInbound(t, inboxId, secret, { messageId: 'x' }).expect(422);
    expect(await conversations()).toEqual([]);
  });
});
