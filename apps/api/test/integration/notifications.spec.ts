import { processInboundEvent, processLeadImport, sendFollowupReminders } from '@leadora/domain';
import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createEmailInbox } from '../support/inbox';
import { createLead, patchLead } from '../support/leads';
import { postInbound } from '../support/webhook';

describe('notifications', () => {
  let t: TestApp;
  let admin: TestAgent;
  let agent: TestAgent;
  let agentId: string;

  const inbox = async (as: TestAgent, q = '') => (await as.get(`/api/v1/notifications${q}`).expect(200)).body;

  beforeAll(async () => {
    t = await createTestApp();
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
  });
  afterAll(async () => t.close());

  it('tells a user when a lead is assigned to them, but not the person who assigned it', async () => {
    const lead = (await createLead(admin).expect(201)).body;
    await patchLead(admin, lead.id, { ownerUserId: agentId }).expect(200);

    const mine = await inbox(agent);
    expect(mine.unreadCount).toBe(1);
    expect(mine.items[0]).toMatchObject({ type: 'lead_assigned', link: `/leads/${lead.id}`, readAt: null });
    expect(mine.items[0].title).toContain('Sadia Islam');
    expect((await inbox(admin)).items).toEqual([]);
  });

  it('notifies the conversation owner about inbound messages', async () => {
    const { inbox: box, webhookSecret } = await createEmailInbox(admin);
    await createLead(admin, { fullName: 'Nadia', email: 'nadia@customer.test', ownerUserId: agentId }).expect(201);
    const res = await postInbound(t, box.id, webhookSecret, {
      messageId: '<n1@customer.test>',
      from: { email: 'nadia@customer.test' },
      subject: 'Hello',
      text: 'Is it in stock?',
    }).expect(202);
    await processInboundEvent(t.db, res.body.eventId);
    const { items } = await inbox(agent);
    expect(items.find((n: { type: string }) => n.type === 'message_received')).toMatchObject({ link: expect.stringMatching(/^\/inbox\?c=/) });
  });

  it('sends one reminder for follow-ups coming due', async () => {
    const lead = (await createLead(agent).expect(201)).body;
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    await agent.post(`/api/v1/leads/${lead.id}/followups`).set('Origin', ORIGIN).send({ type: 'CALL', scheduledAt: soon }).expect(201);
    const later = new Date(Date.now() + 5 * 3600_000).toISOString();
    await agent.post(`/api/v1/leads/${lead.id}/followups`).set('Origin', ORIGIN).send({ type: 'EMAIL', scheduledAt: later }).expect(201);

    expect(await sendFollowupReminders(t.db, new Date())).toBe(1);
    expect(await sendFollowupReminders(t.db, new Date())).toBe(0);
    const { items } = await inbox(agent);
    expect(items.filter((n: { type: string }) => n.type === 'followup_due')).toHaveLength(1);
  });

  it('tells the importer when an import finishes', async () => {
    const { body: imp } = await admin
      .post('/api/v1/lead-imports')
      .set('Origin', ORIGIN)
      .attach('file', Buffer.from('Name,Email\nA,a@x.test\n'), 'a.csv')
      .expect(201);
    await admin.post(`/api/v1/lead-imports/${imp.id}/start`).set('Origin', ORIGIN).send({ mapping: { fullName: 'Name', email: 'Email' } }).expect(202);
    await processLeadImport(t.db, imp.id);
    expect((await inbox(admin)).items[0]).toMatchObject({ type: 'import_completed', link: `/leads/import?id=${imp.id}` });
  });

  it('marks one or all as read, and hides other users’ notifications', async () => {
    const a = (await createLead(admin).expect(201)).body;
    const b = (await createLead(admin, { fullName: 'B', email: 'b@x.test' }).expect(201)).body;
    await patchLead(admin, a.id, { ownerUserId: agentId }).expect(200);
    await patchLead(admin, b.id, { ownerUserId: agentId }).expect(200);

    const { items } = await inbox(agent);
    await admin.post(`/api/v1/notifications/${items[0].id}/read`).set('Origin', ORIGIN).expect(404);
    await agent.post(`/api/v1/notifications/${items[0].id}/read`).set('Origin', ORIGIN).expect(204);
    expect((await inbox(agent)).unreadCount).toBe(1);
    expect((await inbox(agent, '?unread=true')).items).toHaveLength(1);
    await agent.post('/api/v1/notifications/read-all').set('Origin', ORIGIN).expect(204);
    expect((await inbox(agent)).unreadCount).toBe(0);
  });
});
