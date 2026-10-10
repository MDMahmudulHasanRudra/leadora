import { createHmac } from 'node:crypto';
import { type ChannelProvider, deliverMessage, processEmailStatusEvent } from '@leadora/domain';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { ORIGIN, registerAdmin } from '../support/fixtures';
import { createEmailInbox, startConversation } from '../support/inbox';
import { createLead } from '../support/leads';

describe('email delivery tracking (spec §90)', () => {
  let t: TestApp;
  let admin: TestAgent;
  let inboxId: string;
  let secret: string;
  let conversationId: string;
  let messageId: string;
  let leadId: string;

  const smtp: ChannelProvider = { send: async () => ({ externalMessageId: '<out-1@acme.test>' }) };
  const status = (payload: object, sign = secret) => {
    const raw = JSON.stringify(payload);
    const ts = String(Math.floor(Date.now() / 1000));
    return request(t.app.getHttpServer())
      .post(`/api/v1/webhooks/email-status/${inboxId}`)
      .set('content-type', 'application/json')
      .set('x-leadora-timestamp', ts)
      .set('x-leadora-signature', `v1=${createHmac('sha256', sign).update(`${ts}.${raw}`).digest('hex')}`)
      .send(raw);
  };
  const apply = async (payload: object) => {
    const { body } = await status(payload).expect(202);
    return processEmailStatusEvent(t.db, body.eventId);
  };
  const message = async () =>
    (await admin.get(`/api/v1/conversations/${conversationId}/messages`).expect(200)).body.items.find((m: { id: string }) => m.id === messageId);

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await registerAdmin(t)).agent;
    const me = (await admin.get('/api/v1/auth/me').expect(200)).body;
    ({ inbox: { id: inboxId }, webhookSecret: secret } = await createEmailInbox(admin));
    leadId = (await createLead(admin, { fullName: 'Sadia', email: 'sadia@shop.test', ownerUserId: me.user.id }).expect(201)).body.id;
    const { body } = await startConversation(admin, { inboxId, leadId, subject: 'Quote', body: 'Here is your quote.' }).expect(201);
    conversationId = body.conversation.id;
    messageId = body.message.id;
    await deliverMessage(t.db, messageId, { EMAIL: smtp }, { finalAttempt: true });
  });
  afterAll(async () => t.close());

  it('moves a sent email to delivered and opened, never backwards, and ignores repeats', async () => {
    await apply({ messageId: '<out-1@acme.test>', event: 'opened' });
    expect((await message()).status).toBe('READ');
    await apply({ messageId: '<out-1@acme.test>', event: 'delivered' });
    expect((await message()).status).toBe('READ');
    expect((await status({ messageId: '<out-1@acme.test>', event: 'opened' }).expect(200)).body.duplicate).toBe(true);
  });

  it('records bounces on the message, the lead and its timeline, and tells the owner', async () => {
    await apply({ messageId: '<out-1@acme.test>', event: 'bounced', reason: '550 mailbox does not exist' });
    expect(await message()).toMatchObject({ status: 'FAILED', error: 'Bounced: 550 mailbox does not exist' });
    const { body: acts } = await admin.get(`/api/v1/leads/${leadId}/activities`).expect(200);
    expect(acts.items[0]).toMatchObject({ type: 'email.bounced', payload: { email: 'sadia@shop.test' } });
    const { body: notes } = await admin.get('/api/v1/notifications').expect(200);
    expect(notes.items[0].title).toBe('Email to Sadia bounced');
  });

  it('rejects bad signatures and payloads, and skips messages that are not ours', async () => {
    await status({ messageId: '<out-1@acme.test>', event: 'delivered' }, 'whsec_wrong').expect(401);
    await status({ messageId: '<out-1@acme.test>', event: 'exploded' }).expect(422);
    expect(await apply({ messageId: '<someone-else@x.test>', event: 'delivered' })).toEqual({ status: 'SKIPPED' });
    await request(t.app.getHttpServer()).post(`/api/v1/webhooks/email-status/${inboxId}`).set('content-type', 'application/json').send('{}').expect(401);
    void ORIGIN;
  });
});
