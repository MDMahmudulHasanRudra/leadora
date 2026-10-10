import { runLeadExport } from '@leadora/domain';
import type { StorageProvider } from '@leadora/storage';
import type TestAgent from 'supertest/lib/agent';
import { STORAGE } from '../../src/infra/tokens';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead, patchLead } from '../support/leads';
import { grant } from '../support/orgs';

// Product decision (2026-10-10): agents see their own leads and the unassigned pool; roles with lead.view_all
// (admin, manager, analyst, viewer) see every lead in the organization. A lead an agent cannot see behaves as if
// it did not exist (404), on every route that names it.
describe('lead visibility for agents', () => {
  let t: TestApp;
  let admin: TestAgent;
  let agent: TestAgent;
  let manager: TestAgent;
  let mine: string;
  let unassigned: string;
  let others: string;

  const addUser = async (email: string, role: string) =>
    (
      await admin
        .post('/api/v1/users')
        .set('Origin', ORIGIN)
        .send({ email, fullName: email.split('@')[0], role, password: 'a strong password here' })
        .expect(201)
    ).body.id as string;

  const ids = (body: { items: { id: string }[] }) => body.items.map((l) => l.id).sort();

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.reset();
    admin = (await registerAdmin(t)).agent;
    const agentId = await addUser('karim@acme.test', 'AGENT');
    await addUser('nadia@acme.test', 'MANAGER');
    agent = (await login(t, 'karim@acme.test', 'a strong password here')).agent;
    manager = (await login(t, 'nadia@acme.test', 'a strong password here')).agent;

    mine = (await createLead(admin, { fullName: 'Mine', email: 'mine@x.test', ownerUserId: agentId }).expect(201)).body.id;
    unassigned = (await createLead(admin, { fullName: 'Pool', email: 'pool@x.test', ownerUserId: null }).expect(201)).body.id;
    others = (await createLead(admin, { fullName: 'Admin owned', email: 'admin@x.test' }).expect(201)).body.id;
  });

  it('lists only the agent’s own and unassigned leads', async () => {
    expect(ids((await agent.get('/api/v1/leads').expect(200)).body)).toEqual([mine, unassigned].sort());
  });

  it('cannot widen the list with an owner filter', async () => {
    const adminId = (await admin.get('/api/v1/auth/me').expect(200)).body.user.id;
    expect((await agent.get(`/api/v1/leads?owner=${adminId}`).expect(200)).body.items).toEqual([]);
  });

  it('gets 404 for another user’s lead on every route that names it', async () => {
    await agent.get(`/api/v1/leads/${others}`).expect(404);
    await agent.get(`/api/v1/leads/${others}/activities`).expect(404);
    await patchLead(agent, others, { companyName: 'Hijacked' }).expect(404);
    await agent.post(`/api/v1/leads/${others}/notes`).set('Origin', ORIGIN).send({ body: 'peek' }).expect(404);
    await agent
      .post(`/api/v1/leads/${others}/followups`)
      .set('Origin', ORIGIN)
      .send({ type: 'CALL', scheduledAt: new Date(Date.now() + 3_600_000).toISOString() })
      .expect(404);
    await agent.post(`/api/v1/leads/${others}/convert`).set('Origin', ORIGIN).send({}).expect(404);
    // Tasks report an unknown lead as 422 INVALID_LEAD; an invisible one looks the same.
    await agent.post('/api/v1/tasks').set('Origin', ORIGIN).send({ title: 'Call', leadId: others }).expect(422);
  });

  it('still works on the agent’s own and unassigned leads', async () => {
    await agent.get(`/api/v1/leads/${mine}`).expect(200);
    await patchLead(agent, unassigned, { companyName: 'Picked up' }).expect(200);
    await agent.post(`/api/v1/leads/${mine}/notes`).set('Origin', ORIGIN).send({ body: 'called' }).expect(201);
  });

  it('hides other users’ leads from the board and the follow-up list', async () => {
    const pipelineId = (await admin.get('/api/v1/pipelines').expect(200)).body.items[0].id;
    const board = (await agent.get(`/api/v1/pipelines/${pipelineId}/board`).expect(200)).body;
    const onBoard = board.stages.flatMap((s: { leads: { id: string }[] }) => s.leads.map((l) => l.id)).sort();
    expect(onBoard).toEqual([mine, unassigned].sort());

    const when = new Date(Date.now() + 3_600_000).toISOString();
    for (const id of [mine, others]) {
      await admin.post(`/api/v1/leads/${id}/followups`).set('Origin', ORIGIN).send({ type: 'CALL', scheduledAt: when }).expect(201);
    }
    const followups = (await agent.get('/api/v1/followups').expect(200)).body.items as { lead: { id: string } }[];
    expect(followups.map((f) => f.lead.id)).toEqual([mine]);
  });

  it('exports only what the agent may see, even if they try to set the visibility field', async () => {
    await grant(t, 'AGENT', 'lead.export');
    const adminId = (await admin.get('/api/v1/auth/me').expect(200)).body.user.id;
    const { body: job } = await agent
      .post('/api/v1/exports')
      .set('Origin', ORIGIN)
      .send({ entity: 'leads', format: 'CSV', fields: ['fullName'], filters: { visibleTo: adminId } })
      .expect(202);
    expect(await runLeadExport(t.db, t.app.get<StorageProvider>(STORAGE), job.id)).toEqual({ status: 'SUCCEEDED', rows: 2 });
  });

  it('lets managers and admins see every lead', async () => {
    const all = [mine, unassigned, others].sort();
    expect(ids((await manager.get('/api/v1/leads').expect(200)).body)).toEqual(all);
    expect(ids((await admin.get('/api/v1/leads').expect(200)).body)).toEqual(all);
    await manager.get(`/api/v1/leads/${others}`).expect(200);
  });
});
