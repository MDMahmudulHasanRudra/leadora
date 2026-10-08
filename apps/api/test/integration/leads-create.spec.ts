import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead, LEAD, stageId } from '../support/leads';
import { createOtherOrg } from '../support/orgs';

describe('creating and reading leads', () => {
  let t: TestApp;
  let admin: TestAgent;
  let adminId: string;
  let agent: TestAgent;
  let agentId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    const r = await registerAdmin(t);
    admin = r.agent;
    adminId = r.user.id;
    const created = await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'karim@acme.test', fullName: 'Karim Ahmed', role: 'AGENT', password: 'agent strong password' })
      .expect(201);
    agentId = created.body.id;
    agent = (await login(t, 'karim@acme.test', 'agent strong password')).agent;
  });
  afterAll(async () => t.close());

  it('creates a lead with normalized contact details and sensible defaults', async () => {
    const res = await createLead(agent).expect(201);
    expect(res.body).toMatchObject({
      fullName: 'Sadia Islam',
      email: 'sadia@example.com',
      phone: '+8801712345678',
      companyName: 'Rupali Traders',
      priority: 'MEDIUM',
      source: { type: 'MANUAL' },
      stage: { key: 'NEW', outcome: 'OPEN' },
      owner: { id: agentId, fullName: 'Karim Ahmed' },
      tags: [],
      archivedAt: null,
    });

    const fetched = await agent.get(`/api/v1/leads/${res.body.id}`).expect(200);
    expect(fetched.body).toEqual(res.body);
  });

  it('records a lead.created activity on the timeline', async () => {
    const { body: lead } = await createLead(agent).expect(201);
    const { body } = await agent.get(`/api/v1/leads/${lead.id}/activities`).expect(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ type: 'lead.created', actor: { id: agentId } });
  });

  it('flags a duplicate email regardless of case, pointing at the existing lead', async () => {
    const { body: first } = await createLead(agent).expect(201);
    const res = await createLead(agent, { fullName: 'Someone Else', email: 'SADIA@example.com' }).expect(409);
    expect(res.body.error).toMatchObject({ code: 'LEAD_DUPLICATE', details: { existingLeadId: first.id, matchedOn: 'email' } });
  });

  it('flags a duplicate phone written in a different format', async () => {
    const { body: first } = await createLead(agent).expect(201);
    const res = await createLead(agent, { fullName: 'Sadia I.', phone: '+880 1712 345678' }).expect(409);
    expect(res.body.error.details).toEqual({ existingLeadId: first.id, matchedOn: 'phone' });
  });

  it('requires a name and at least one way to reach the lead', async () => {
    const noContact = await createLead(agent, { fullName: 'Ghost' }).expect(422);
    expect(noContact.body.error.code).toBe('VALIDATION_FAILED');
    await createLead(agent, { email: 'x@example.com' }).expect(422);
  });

  it('rejects an invalid phone number', async () => {
    const res = await createLead(agent, { fullName: 'Bad Phone', phone: '12' }).expect(422);
    expect(res.body.error.details[0].path).toBe('phone');
  });

  it('only lets lead.assign holders give a lead to someone else', async () => {
    await createLead(agent, { ...LEAD, ownerUserId: adminId }).expect(403);
    const res = await createLead(admin, { ...LEAD, ownerUserId: agentId }).expect(201);
    expect(res.body.owner.id).toBe(agentId);
  });

  it('accepts a starting stage and deduplicates tags case-insensitively', async () => {
    const res = await createLead(admin, { ...LEAD, stageId: await stageId(admin, 'QUALIFIED'), tags: ['VIP', 'vip ', 'Dhaka'] }).expect(201);
    expect(res.body.stage.key).toBe('QUALIFIED');
    expect(res.body.tags).toEqual(['Dhaka', 'VIP']);
  });

  it('rejects owner, stage and source ids from another organization', async () => {
    const rival = await createOtherOrg(t, 'rival');
    const rivalStage = await stageId(rival, 'NEW');
    const rivalSource = (await rival.get('/api/v1/lead-sources').expect(200)).body.items[0].id;
    const rivalUser = (await rival.get('/api/v1/users').expect(200)).body.items[0].id;

    expect((await createLead(admin, { ...LEAD, stageId: rivalStage }).expect(422)).body.error.code).toBe('INVALID_STAGE');
    expect((await createLead(admin, { ...LEAD, sourceId: rivalSource }).expect(422)).body.error.code).toBe('INVALID_SOURCE');
    expect((await createLead(admin, { ...LEAD, ownerUserId: rivalUser }).expect(422)).body.error.code).toBe('INVALID_OWNER');
  });

  it('hides leads of other organizations', async () => {
    const { body: lead } = await createLead(admin).expect(201);
    const rival = await createOtherOrg(t, 'rival');
    await rival.get(`/api/v1/leads/${lead.id}`).expect(404);
    await rival.get(`/api/v1/leads/${lead.id}/activities`).expect(404);
  });

  it('does not let viewers create leads', async () => {
    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'view@acme.test', fullName: 'Viewer', role: 'VIEWER', password: 'viewer strong password' })
      .expect(201);
    const { agent: viewer } = await login(t, 'view@acme.test', 'viewer strong password');
    await createLead(viewer).expect(403);
  });
});
