import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead, LEAD, patchLead, stageId } from '../support/leads';
import { createOtherOrg } from '../support/orgs';

describe('updating and archiving leads', () => {
  let t: TestApp;
  let admin: TestAgent;
  let agent: TestAgent;
  let agentId: string;
  let lead: { id: string };

  const activityTypes = async (as: TestAgent, id: string) =>
    (await as.get(`/api/v1/leads/${id}/activities`).expect(200)).body.items.map((a: { type: string }) => a.type);

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

  it('updates fields and records what changed', async () => {
    const res = await patchLead(agent, lead.id, { companyName: 'Meghna Group', priority: 'HIGH' }).expect(200);
    expect(res.body).toMatchObject({ companyName: 'Meghna Group', priority: 'HIGH' });

    const { body } = await agent.get(`/api/v1/leads/${lead.id}/activities`).expect(200);
    expect(body.items[0]).toMatchObject({
      type: 'lead.updated',
      payload: { changes: { companyName: { from: 'Rupali Traders', to: 'Meghna Group' }, priority: { from: 'MEDIUM', to: 'HIGH' } } },
    });
  });

  it('normalizes a new phone and refuses one that belongs to another lead', async () => {
    await createLead(agent, { fullName: 'Other', phone: '01911-222333' }).expect(201);
    const ok = await patchLead(agent, lead.id, { phone: '01712 999 888' }).expect(200);
    expect(ok.body.phone).toBe('+8801712999888');
    const dup = await patchLead(agent, lead.id, { phone: '+880 1911 222333' }).expect(409);
    expect(dup.body.error.code).toBe('LEAD_DUPLICATE');
  });

  it('does not log an update when nothing actually changed', async () => {
    await patchLead(agent, lead.id, { companyName: 'Rupali Traders' }).expect(200);
    expect(await activityTypes(agent, lead.id)).toEqual(['lead.created']);
  });

  it('moves the lead through the pipeline and stamps conversion', async () => {
    const res = await patchLead(agent, lead.id, { stageId: await stageId(agent, 'CONVERTED') }).expect(200);
    expect(res.body.stage.key).toBe('CONVERTED');
    expect(res.body.convertedAt).not.toBeNull();

    const back = await patchLead(agent, lead.id, { stageId: await stageId(agent, 'NEGOTIATION') }).expect(200);
    expect(back.body.convertedAt).toBeNull();

    const { body } = await agent.get(`/api/v1/leads/${lead.id}/activities`).expect(200);
    expect(body.items[0]).toMatchObject({ type: 'lead.stage_changed', payload: { from: 'CONVERTED', to: 'NEGOTIATION' } });
  });

  it('rejects a stage from another organization', async () => {
    const rival = await createOtherOrg(t, 'rival');
    const res = await patchLead(admin, lead.id, { stageId: await stageId(rival, 'NEW') }).expect(422);
    expect(res.body.error.code).toBe('INVALID_STAGE');
  });

  it('only lets lead.assign holders reassign, and records it', async () => {
    const r = await registerAdminIdOf(admin);
    await patchLead(agent, lead.id, { ownerUserId: r }).expect(403);
    const res = await patchLead(admin, lead.id, { ownerUserId: null }).expect(200);
    expect(res.body.owner).toBeNull();
    const { body } = await admin.get(`/api/v1/leads/${lead.id}/activities`).expect(200);
    expect(body.items[0]).toMatchObject({ type: 'lead.assigned', payload: { from: agentId, to: null } });
  });

  it('keeps the timeline in the order events happened, even within one request', async () => {
    for (let i = 0; i < 5; i++) {
      await patchLead(admin, lead.id, { priority: i % 2 ? 'LOW' : 'HIGH', ownerUserId: i % 2 ? agentId : null }).expect(200);
    }
    const types = await activityTypes(admin, lead.id);
    expect(types).toEqual([...Array(5).fill(['lead.assigned', 'lead.updated']).flat(), 'lead.created']);
  });

  it('replaces tags', async () => {
    await patchLead(agent, lead.id, { tags: ['Hot', 'Dhaka'] }).expect(200);
    const res = await patchLead(agent, lead.id, { tags: ['Dhaka'] }).expect(200);
    expect(res.body.tags).toEqual(['Dhaka']);
  });

  it('clears an optional field when sent empty', async () => {
    const res = await patchLead(agent, lead.id, { companyName: '', jobTitle: null }).expect(200);
    expect(res.body.companyName).toBeNull();
    expect(res.body.jobTitle).toBeNull();
  });

  it('rejects an empty update', async () => {
    await patchLead(agent, lead.id, {}).expect(422);
  });

  it('archives and restores, hiding archived leads from the default list', async () => {
    await agent.delete(`/api/v1/leads/${lead.id}`).set('Origin', ORIGIN).expect(403);
    await admin.delete(`/api/v1/leads/${lead.id}`).set('Origin', ORIGIN).expect(204);

    expect((await admin.get('/api/v1/leads').expect(200)).body.items).toEqual([]);
    expect((await admin.get('/api/v1/leads?archived=true').expect(200)).body.items).toHaveLength(1);
    expect((await patchLead(admin, lead.id, { priority: 'LOW' }).expect(409)).body.error.code).toBe('LEAD_ARCHIVED');

    await admin.post(`/api/v1/leads/${lead.id}/restore`).set('Origin', ORIGIN).expect(200);
    expect((await admin.get('/api/v1/leads').expect(200)).body.items).toHaveLength(1);
    expect(await activityTypes(admin, lead.id)).toEqual(['lead.restored', 'lead.archived', 'lead.created']);
  });

  it('still detects duplicates against archived leads', async () => {
    await admin.delete(`/api/v1/leads/${lead.id}`).set('Origin', ORIGIN).expect(204);
    await createLead(agent, LEAD).expect(409);
  });

  it('hides other organizations’ leads from updates and archiving', async () => {
    const rival = await createOtherOrg(t, 'rival');
    await patchLead(rival, lead.id, { priority: 'LOW' }).expect(404);
    await rival.delete(`/api/v1/leads/${lead.id}`).set('Origin', ORIGIN).expect(404);
  });
});

async function registerAdminIdOf(admin: TestAgent): Promise<string> {
  return (await admin.get('/api/v1/auth/me').expect(200)).body.user.id;
}
