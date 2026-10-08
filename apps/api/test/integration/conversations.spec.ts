import { Queue } from 'bullmq';
import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createEmailInbox, sendMessage, startConversation } from '../support/inbox';
import { createLead } from '../support/leads';
import { createOtherOrg } from '../support/orgs';
import { testEnv } from '../support/test-env';

describe('inboxes and conversations', () => {
  let t: TestApp;
  let admin: TestAgent;
  let agent: TestAgent;
  let agentId: string;
  let inboxId: string;
  let lead: { id: string };
  let messages: Queue;

  beforeAll(async () => {
    t = await createTestApp();
    messages = new Queue('messages', { connection: { url: testEnv().valkeyUrl } });
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await registerAdmin(t)).agent;
    agentId = (
      await admin
        .post('/api/v1/users')
        .set('Origin', ORIGIN)
        .send({ email: 'karim@acme.test', fullName: 'Karim Ahmed', role: 'AGENT', password: 'agent strong password' })
        .expect(201)
    ).body.id;
    agent = (await login(t, 'karim@acme.test', 'agent strong password')).agent;
    inboxId = (await createEmailInbox(admin)).inbox.id;
    lead = (await createLead(admin).expect(201)).body;
  });
  afterAll(async () => {
    await messages.close();
    await t.close();
  });

  it('creates an inbox and shows its webhook secret only once', async () => {
    const created = await createEmailInbox(admin, 'Support', 'support@acme.test');
    expect(created.webhookSecret).toMatch(/^whsec_[A-Za-z0-9_-]{32,}$/);
    const { body } = await agent.get('/api/v1/inboxes').expect(200);
    expect(body.items.map((i: { name: string }) => i.name).sort()).toEqual(['Sales email', 'Support']);
    expect(JSON.stringify(body)).not.toContain(created.webhookSecret);
    expect(JSON.stringify(body)).not.toMatch(/secret/i);
  });

  it('starts an email conversation and queues the first message for sending', async () => {
    const res = await startConversation(agent, { inboxId, leadId: lead.id, subject: 'Your quote', body: 'Hello Sadia, here is the quote.' }).expect(201);
    expect(res.body.conversation).toMatchObject({ subject: 'Your quote', status: 'OPEN', waitingOn: 'CUSTOMER', lead: { id: lead.id } });
    expect(res.body.message).toMatchObject({ direction: 'OUTBOUND', status: 'QUEUED', content: 'Hello Sadia, here is the quote.', sender: { id: agentId } });
    expect(await messages.getJob(res.body.message.id)).toBeTruthy();
  });

  it('requires an email address to start an email conversation', async () => {
    const phoneOnly = (await createLead(admin, { fullName: 'No Email', phone: '01811-000222' }).expect(201)).body;
    const res = await startConversation(agent, { inboxId, leadId: phoneOnly.id, subject: 'Hi', body: 'Hi' }).expect(422);
    expect(res.body.error.code).toBe('LEAD_HAS_NO_ADDRESS');
  });

  it('adds replies and internal notes in order; notes are never sent', async () => {
    const { conversation } = (await startConversation(agent, { inboxId, leadId: lead.id, subject: 'Q', body: 'First' }).expect(201)).body;
    const note = (await sendMessage(agent, conversation.id, { body: 'Customer prefers WhatsApp', internal: true }).expect(201)).body;
    expect(note).toMatchObject({ direction: 'INTERNAL', status: 'SENT' });
    expect(await messages.getJob(note.id)).toBeFalsy();
    await sendMessage(agent, conversation.id, { body: 'Second' }).expect(201);

    const { body } = await agent.get(`/api/v1/conversations/${conversation.id}/messages`).expect(200);
    expect(body.items.map((m: { content: string }) => m.content)).toEqual(['First', 'Customer prefers WhatsApp', 'Second']);
  });

  it('filters inbox views and lets only conversation.assign holders assign', async () => {
    const { conversation } = (await startConversation(admin, { inboxId, leadId: lead.id, subject: 'Q', body: 'x' }).expect(201)).body;
    expect((await agent.get('/api/v1/conversations?view=unassigned').expect(200)).body.items).toHaveLength(1);
    expect((await agent.get('/api/v1/conversations?view=mine').expect(200)).body.items).toHaveLength(0);

    await agent.patch(`/api/v1/conversations/${conversation.id}`).set('Origin', ORIGIN).send({ assignedUserId: agentId }).expect(403);
    const res = await admin.patch(`/api/v1/conversations/${conversation.id}`).set('Origin', ORIGIN).send({ assignedUserId: agentId }).expect(200);
    expect(res.body.assignee.id).toBe(agentId);
    expect((await agent.get('/api/v1/conversations?view=mine').expect(200)).body.items).toHaveLength(1);

    await agent.patch(`/api/v1/conversations/${conversation.id}`).set('Origin', ORIGIN).send({ status: 'RESOLVED' }).expect(200);
    expect((await agent.get('/api/v1/conversations?view=mine').expect(200)).body.items).toHaveLength(0);
    expect((await agent.get('/api/v1/conversations?view=resolved').expect(200)).body.items).toHaveLength(1);
  });

  it('lists conversations for a lead', async () => {
    await startConversation(admin, { inboxId, leadId: lead.id, subject: 'Q', body: 'x' }).expect(201);
    expect((await admin.get(`/api/v1/conversations?view=all&leadId=${lead.id}`).expect(200)).body.items).toHaveLength(1);
  });

  it('enforces permissions and tenancy', async () => {
    const { conversation } = (await startConversation(admin, { inboxId, leadId: lead.id, subject: 'Q', body: 'x' }).expect(201)).body;
    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'v@acme.test', fullName: 'Viewer', role: 'VIEWER', password: 'viewer strong password' })
      .expect(201);
    const { agent: viewer } = await login(t, 'v@acme.test', 'viewer strong password');
    await viewer.get(`/api/v1/conversations/${conversation.id}/messages`).expect(200);
    await sendMessage(viewer, conversation.id, { body: 'hi' }).expect(403);
    await agent.post('/api/v1/inboxes').set('Origin', ORIGIN).send({ name: 'x', channel: 'EMAIL', address: 'x@acme.test' }).expect(403);

    const rival = await createOtherOrg(t, 'rival');
    await rival.get(`/api/v1/conversations/${conversation.id}/messages`).expect(404);
    await sendMessage(rival, conversation.id, { body: 'hi' }).expect(404);
    expect((await rival.get('/api/v1/conversations?view=all').expect(200)).body.items).toEqual([]);
    const rivalLead = (await createLead(rival, { fullName: 'R', email: 'r@x.test' }).expect(201)).body;
    expect((await startConversation(rival, { inboxId, leadId: rivalLead.id, subject: 'x', body: 'x' }).expect(422)).body.error.code).toBe('INVALID_INBOX');
  });
});
