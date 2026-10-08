import { type ChannelProvider, deliverMessage, type OutboundEnvelope } from '@leadora/domain';
import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { registerAdmin } from '../support/fixtures';
import { createEmailInbox, sendMessage, startConversation } from '../support/inbox';
import { createLead } from '../support/leads';

class FakeEmail implements ChannelProvider {
  sent: OutboundEnvelope[] = [];
  failWith: Error | null = null;
  async send(envelope: OutboundEnvelope) {
    if (this.failWith) throw this.failWith;
    this.sent.push(envelope);
    return { externalMessageId: `<m${this.sent.length}@acme.test>` };
  }
}

describe('outbound message delivery (worker)', () => {
  let t: TestApp;
  let admin: TestAgent;
  let email: FakeEmail;
  let start: { conversation: { id: string }; message: { id: string } };
  let leadId: string;
  const providers = () => ({ EMAIL: email });

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await registerAdmin(t)).agent;
    email = new FakeEmail();
    const inboxId = (await createEmailInbox(admin, 'Sales', 'sales@acme.test')).inbox.id;
    leadId = (await createLead(admin).expect(201)).body.id;
    start = (await startConversation(admin, { inboxId, leadId, subject: 'Your quote', body: 'Hello Sadia' }).expect(201)).body;
  });
  afterAll(async () => t.close());

  const messagesOf = async () => (await admin.get(`/api/v1/conversations/${start.conversation.id}/messages`).expect(200)).body.items;

  it('sends through the channel provider and records the result', async () => {
    await deliverMessage(t.db, start.message.id, providers(), { finalAttempt: false });

    expect(email.sent).toEqual([
      expect.objectContaining({ from: 'sales@acme.test', to: 'sadia@example.com', subject: 'Your quote', text: 'Hello Sadia', inReplyTo: null }),
    ]);
    const [m] = await messagesOf();
    expect(m).toMatchObject({ status: 'SENT' });
    expect(m.sentAt).not.toBeNull();

    const lead = (await admin.get(`/api/v1/leads/${leadId}`).expect(200)).body;
    expect(lead.lastContactedAt).not.toBeNull();
    const { body } = await admin.get(`/api/v1/leads/${leadId}/activities`).expect(200);
    expect(body.items[0]).toMatchObject({ type: 'message.sent', payload: { channel: 'EMAIL', conversationId: start.conversation.id } });
  });

  it('threads replies to the previous message', async () => {
    await deliverMessage(t.db, start.message.id, providers(), { finalAttempt: false });
    const reply = (await sendMessage(admin, start.conversation.id, { body: 'Following up' }).expect(201)).body;
    await deliverMessage(t.db, reply.id, providers(), { finalAttempt: false });
    expect(email.sent[1]).toMatchObject({ subject: 'Re: Your quote', inReplyTo: '<m1@acme.test>', references: ['<m1@acme.test>'] });
  });

  it('is idempotent: a delivered message is not sent again', async () => {
    await deliverMessage(t.db, start.message.id, providers(), { finalAttempt: false });
    await deliverMessage(t.db, start.message.id, providers(), { finalAttempt: false });
    expect(email.sent).toHaveLength(1);
  });

  it('rethrows provider errors for retry, and marks FAILED on the last attempt', async () => {
    email.failWith = new Error('SMTP 421 try later');
    await expect(deliverMessage(t.db, start.message.id, providers(), { finalAttempt: false })).rejects.toThrow('421');
    expect((await messagesOf())[0].status).toBe('QUEUED');

    await expect(deliverMessage(t.db, start.message.id, providers(), { finalAttempt: true })).rejects.toThrow();
    expect((await messagesOf())[0]).toMatchObject({ status: 'FAILED', error: 'SMTP 421 try later' });
  });

  it('skips messages that no longer exist or have no provider', async () => {
    await deliverMessage(t.db, '00000000-0000-0000-0000-000000000000', providers(), { finalAttempt: false });
    await expect(deliverMessage(t.db, start.message.id, {}, { finalAttempt: true })).rejects.toThrow(/No provider/);
    expect((await messagesOf())[0].status).toBe('FAILED');
  });
});
