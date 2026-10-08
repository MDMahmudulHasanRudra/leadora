import { sql } from 'drizzle-orm';
import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead } from '../support/leads';
import { createOtherOrg } from '../support/orgs';

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

describe('follow-ups', () => {
  let t: TestApp;
  let admin: TestAgent;
  let agent: TestAgent;
  let agentId: string;
  let lead: { id: string };

  const schedule = (as: TestAgent, leadId: string, body: object) =>
    as.post(`/api/v1/leads/${leadId}/followups`).set('Origin', ORIGIN).send(body);
  const patch = (as: TestAgent, id: string, body: object) => as.patch(`/api/v1/followups/${id}`).set('Origin', ORIGIN).send(body);
  const getLead = async (as: TestAgent, id: string) => (await as.get(`/api/v1/leads/${id}`).expect(200)).body;

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
    lead = (await createLead(agent).expect(201)).body;
  });
  afterAll(async () => t.close());

  it('schedules a follow-up for the lead owner and sets the lead’s next follow-up', async () => {
    const at = inHours(24);
    const res = await schedule(agent, lead.id, { type: 'CALL', scheduledAt: at, notes: 'Discuss pricing' }).expect(201);
    expect(res.body).toMatchObject({ type: 'CALL', status: 'PENDING', overdue: false, assignee: { id: agentId }, lead: { id: lead.id } });
    expect((await getLead(agent, lead.id)).nextFollowupAt).toBe(at);

    const { body } = await agent.get(`/api/v1/leads/${lead.id}/activities`).expect(200);
    expect(body.items[0]).toMatchObject({ type: 'followup.created', payload: { type: 'CALL' } });
  });

  it('lists my follow-ups by status, flagging overdue ones', async () => {
    await schedule(agent, lead.id, { type: 'CALL', scheduledAt: inHours(48) }).expect(201);
    const { body: late } = await schedule(agent, lead.id, { type: 'EMAIL', scheduledAt: inHours(1) }).expect(201);
    await t.db.execute(sql`update followups set scheduled_at = now() - interval '2 hours' where id = ${late.id}`);

    const overdue = (await agent.get('/api/v1/followups?assignee=me&status=overdue').expect(200)).body.items;
    expect(overdue.map((f: { id: string }) => f.id)).toEqual([late.id]);
    expect(overdue[0].overdue).toBe(true);

    const pending = (await agent.get('/api/v1/followups?assignee=me&status=pending').expect(200)).body.items;
    expect(pending.map((f: { type: string }) => f.type)).toEqual(['EMAIL', 'CALL']);
    expect((await admin.get('/api/v1/followups?assignee=me').expect(200)).body.items).toEqual([]);
  });

  it('completing updates last contact and moves next follow-up to the following one', async () => {
    const first = (await schedule(agent, lead.id, { type: 'CALL', scheduledAt: inHours(2) }).expect(201)).body;
    const second = inHours(72);
    await schedule(agent, lead.id, { type: 'MEETING', scheduledAt: second }).expect(201);

    const done = await patch(agent, first.id, { status: 'COMPLETED', outcome: 'Interested, sending quote' }).expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.completedAt).not.toBeNull();

    const after = await getLead(agent, lead.id);
    expect(after.nextFollowupAt).toBe(second);
    expect(after.lastContactedAt).not.toBeNull();

    expect((await patch(agent, first.id, { status: 'SKIPPED' }).expect(409)).body.error.code).toBe('FOLLOWUP_CLOSED');
    const { body } = await agent.get(`/api/v1/leads/${lead.id}/activities`).expect(200);
    expect(body.items[0]).toMatchObject({ type: 'followup.completed', payload: { outcome: 'Interested, sending quote' } });
  });

  it('rescheduling and cancelling keep the lead’s next follow-up correct', async () => {
    const f = (await schedule(agent, lead.id, { type: 'CALL', scheduledAt: inHours(5) }).expect(201)).body;
    const later = inHours(10);
    await patch(agent, f.id, { scheduledAt: later }).expect(200);
    expect((await getLead(agent, lead.id)).nextFollowupAt).toBe(later);
    await patch(agent, f.id, { status: 'CANCELLED' }).expect(200);
    expect((await getLead(agent, lead.id)).nextFollowupAt).toBeNull();
  });

  it('only lead.assign holders schedule follow-ups for someone else', async () => {
    const adminId = (await admin.get('/api/v1/auth/me').expect(200)).body.user.id;
    await schedule(agent, lead.id, { type: 'CALL', scheduledAt: inHours(1), assignedUserId: adminId }).expect(403);
    const res = await schedule(admin, lead.id, { type: 'CALL', scheduledAt: inHours(1), assignedUserId: agentId }).expect(201);
    expect(res.body.assignee.id).toBe(agentId);
  });

  it('validates input and isolates tenants', async () => {
    await schedule(agent, lead.id, { type: 'PIGEON', scheduledAt: inHours(1) }).expect(422);
    await schedule(agent, lead.id, { type: 'CALL', scheduledAt: 'tomorrow' }).expect(422);

    const rival = await createOtherOrg(t, 'rival');
    const rivalUser = (await rival.get('/api/v1/users').expect(200)).body.items[0].id;
    expect((await schedule(admin, lead.id, { type: 'CALL', scheduledAt: inHours(1), assignedUserId: rivalUser }).expect(422)).body.error.code).toBe(
      'INVALID_ASSIGNEE',
    );
    const f = (await schedule(agent, lead.id, { type: 'CALL', scheduledAt: inHours(1) }).expect(201)).body;
    await schedule(rival, lead.id, { type: 'CALL', scheduledAt: inHours(1) }).expect(404);
    await patch(rival, f.id, { status: 'COMPLETED' }).expect(404);
    expect((await rival.get('/api/v1/followups').expect(200)).body.items).toEqual([]);
  });

  it('does not let viewers schedule follow-ups', async () => {
    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'v@acme.test', fullName: 'Viewer', role: 'VIEWER', password: 'viewer strong password' })
      .expect(201);
    const { agent: viewer } = await login(t, 'v@acme.test', 'viewer strong password');
    await schedule(viewer, lead.id, { type: 'CALL', scheduledAt: inHours(1) }).expect(403);
  });
});
