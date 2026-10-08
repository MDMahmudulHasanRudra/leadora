import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead } from '../support/leads';
import { createOtherOrg } from '../support/orgs';

describe('tasks', () => {
  let t: TestApp;
  let admin: TestAgent;
  let agent: TestAgent;
  let agentId: string;

  const create = (as: TestAgent, body: object) => as.post('/api/v1/tasks').set('Origin', ORIGIN).send(body);
  const patch = (as: TestAgent, id: string, body: object) => as.patch(`/api/v1/tasks/${id}`).set('Origin', ORIGIN).send(body);

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

  it('creates a task with a checklist, assigned to the creator by default', async () => {
    const res = await create(agent, {
      title: 'Prepare quotation',
      dueAt: '2026-12-01T09:00:00.000Z',
      priority: 'HIGH',
      checklist: ['Get prices', 'Apply discount'],
    }).expect(201);
    expect(res.body).toMatchObject({
      title: 'Prepare quotation',
      status: 'OPEN',
      priority: 'HIGH',
      assignee: { id: agentId },
      checklist: [
        { text: 'Get prices', done: false },
        { text: 'Apply discount', done: false },
      ],
      lead: null,
    });
  });

  it('links a task to a lead and lists it under that lead', async () => {
    const lead = (await createLead(agent).expect(201)).body;
    const { body: task } = await create(agent, { title: 'Send brochure', leadId: lead.id }).expect(201);
    expect(task.lead).toEqual({ id: lead.id, fullName: 'Sadia Islam' });
    expect((await agent.get(`/api/v1/tasks?leadId=${lead.id}`).expect(200)).body.items.map((x: { id: string }) => x.id)).toEqual([task.id]);
  });

  it('ticks checklist items and completes and reopens a task', async () => {
    const { body: task } = await create(agent, { title: 'Onboard', checklist: ['A', 'B'] }).expect(201);
    const ticked = await patch(agent, task.id, { checklist: [{ text: 'A', done: true }, { text: 'B', done: false }] }).expect(200);
    expect(ticked.body.checklist[0].done).toBe(true);

    const done = await patch(agent, task.id, { status: 'DONE' }).expect(200);
    expect(done.body.completedAt).not.toBeNull();
    expect((await agent.get('/api/v1/tasks?assignee=me&status=open').expect(200)).body.items).toEqual([]);
    expect((await agent.get('/api/v1/tasks?assignee=me&status=done').expect(200)).body.items).toHaveLength(1);

    const reopened = await patch(agent, task.id, { status: 'OPEN' }).expect(200);
    expect(reopened.body.completedAt).toBeNull();
  });

  it('only lead.assign holders give tasks to someone else', async () => {
    const adminId = (await admin.get('/api/v1/auth/me').expect(200)).body.user.id;
    await create(agent, { title: 'Delegate', assignedUserId: adminId }).expect(403);
    expect((await create(admin, { title: 'For Karim', assignedUserId: agentId }).expect(201)).body.assignee.id).toBe(agentId);
  });

  it('deletes a task', async () => {
    const { body: task } = await create(agent, { title: 'Temp' }).expect(201);
    await agent.delete(`/api/v1/tasks/${task.id}`).set('Origin', ORIGIN).expect(204);
    expect((await agent.get('/api/v1/tasks?status=all').expect(200)).body.items).toEqual([]);
  });

  it('validates and isolates tenants', async () => {
    await create(agent, { title: '' }).expect(422);
    const rival = await createOtherOrg(t, 'rival');
    const lead = (await createLead(agent).expect(201)).body;
    expect((await create(rival, { title: 'x', leadId: lead.id }).expect(422)).body.error.code).toBe('INVALID_LEAD');
    const { body: task } = await create(agent, { title: 'Mine' }).expect(201);
    await patch(rival, task.id, { status: 'DONE' }).expect(404);
    await rival.delete(`/api/v1/tasks/${task.id}`).set('Origin', ORIGIN).expect(404);
    expect((await rival.get('/api/v1/tasks?status=all').expect(200)).body.items).toEqual([]);
  });
});
