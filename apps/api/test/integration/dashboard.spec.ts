import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead, stageId } from '../support/leads';
import { createOtherOrg } from '../support/orgs';

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

describe('dashboard metrics and pipeline board', () => {
  let t: TestApp;
  let admin: TestAgent;
  let agent: TestAgent;
  let agentId: string;

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

    const qualified = await stageId(admin, 'QUALIFIED');
    const converted = await stageId(admin, 'CONVERTED');
    const lost = await stageId(admin, 'LOST');
    await createLead(admin, { fullName: 'N1', email: 'n1@x.test', budget: 1000 }).expect(201);
    await createLead(admin, { fullName: 'Q1', email: 'q1@x.test', budget: 2000, stageId: qualified, ownerUserId: agentId }).expect(201);
    const w = (await createLead(admin, { fullName: 'W1', email: 'w1@x.test', budget: 5000, ownerUserId: agentId }).expect(201)).body;
    await admin.patch(`/api/v1/leads/${w.id}`).set('Origin', ORIGIN).send({ stageId: converted }).expect(200);
    const l = (await createLead(admin, { fullName: 'L1', email: 'l1@x.test', budget: 700 }).expect(201)).body;
    await admin.patch(`/api/v1/leads/${l.id}`).set('Origin', ORIGIN).send({ stageId: lost }).expect(200);
    await agent.post(`/api/v1/leads/${w.id}/followups`).set('Origin', ORIGIN).send({ type: 'CALL', scheduledAt: inHours(2) }).expect(201);
  });
  afterAll(async () => t.close());

  it('summarizes the organization for analysts and admins', async () => {
    const { body } = await admin.get('/api/v1/analytics/dashboard').expect(200);
    expect(body.scope).toBe('organization');
    expect(body.totals).toMatchObject({ leads: 4, open: 2, won: 1, lost: 1, newInPeriod: 4, convertedInPeriod: 1, followupsDueNext24h: 1, overdueFollowups: 0 });
    expect(body.totals.conversionRate).toBeCloseTo(0.25);
    expect(body.value).toMatchObject({ won: 5000, pipeline: 3000, weightedPipeline: 1000 * 0.05 + 2000 * 0.25 });
    expect(body.byStage.find((s: { key: string }) => s.key === 'QUALIFIED')).toMatchObject({ count: 1, value: 2000 });
    expect(body.bySource).toEqual([expect.objectContaining({ type: 'MANUAL', leads: 4, won: 1 })]);
    const karim = body.team.find((m: { userId: string }) => m.userId === agentId);
    expect(karim).toMatchObject({ fullName: 'Karim Ahmed', leads: 2, won: 1, open: 1 });
  });

  it('scopes agents to their own leads and hides the team table', async () => {
    const { body } = await agent.get('/api/v1/analytics/dashboard').expect(200);
    expect(body.scope).toBe('mine');
    expect(body.totals).toMatchObject({ leads: 2, open: 1, won: 1, lost: 0 });
    expect(body.team).toBeUndefined();
  });

  it('returns the pipeline board grouped by stage', async () => {
    const pipelineId = (await admin.get('/api/v1/pipelines').expect(200)).body.items[0].id;
    const { body } = await admin.get(`/api/v1/pipelines/${pipelineId}/board`).expect(200);
    expect(body.stages.map((s: { key: string; count: number }) => [s.key, s.count])).toEqual([
      ['NEW', 1],
      ['CONTACTED', 0],
      ['QUALIFIED', 1],
      ['INTERESTED', 0],
      ['NEGOTIATION', 0],
      ['FOLLOW_UP', 0],
      ['CONVERTED', 1],
      ['LOST', 1],
    ]);
    expect(body.stages[2].leads[0]).toMatchObject({ fullName: 'Q1', owner: { id: agentId } });
    const mine = (await admin.get(`/api/v1/pipelines/${pipelineId}/board?owner=${agentId}`).expect(200)).body;
    expect(mine.stages.reduce((n: number, s: { count: number }) => n + s.count, 0)).toBe(2);
  });

  it('isolates organizations', async () => {
    const rival = await createOtherOrg(t, 'rival');
    expect((await rival.get('/api/v1/analytics/dashboard').expect(200)).body.totals.leads).toBe(0);
    const pipelineId = (await admin.get('/api/v1/pipelines').expect(200)).body.items[0].id;
    await rival.get(`/api/v1/pipelines/${pipelineId}/board`).expect(404);
  });
});
