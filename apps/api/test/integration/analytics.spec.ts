import { sql } from 'drizzle-orm';
import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead, patchLead, stageId } from '../support/leads';

describe('analytics: overview, sources, team, forecast (spec §45–46)', () => {
  let t: TestApp;
  let admin: TestAgent;
  let me: { user: { id: string } };

  const lead = async (name: string, over: object = {}) =>
    (await createLead(admin, { fullName: name, email: `${name.toLowerCase().replace(/\s/g, '')}@shop.test`, ownerUserId: me.user.id, ...over }).expect(201)).body;
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await registerAdmin(t)).agent;
    me = (await admin.get('/api/v1/auth/me').expect(200)).body;
  });
  afterAll(async () => t.close());

  it('computes the overview for a period, including response time, sales cycle and revenue', async () => {
    const won = await lead('Won Deal', { budget: 50000 });
    const qualified = await lead('Qualified One', { budget: 20000 });
    await lead('Just New');
    const old = await lead('Old Lead');
    // Old Lead was created before the period.
    await t.db.execute(sql`update leads set created_at = ${ago(60)} where id = ${old.id}`);
    // Won Deal: created 10 days ago, first contacted 2 hours later, won 4 days later.
    await patchLead(admin, won.id, { stageId: await stageId(admin, 'CONVERTED') }).expect(200);
    await t.db.execute(sql`update leads set created_at = ${ago(10)}, converted_at = ${ago(6)}, last_contacted_at = ${ago(10)} where id = ${won.id}`);
    await t.db.execute(sql`insert into activities (organization_id, lead_id, type, payload, created_at)
      select organization_id, id, 'followup.completed', '{"type":"CALL"}'::jsonb, created_at + interval '2 hours' from leads where id = ${won.id}`);
    await patchLead(admin, qualified.id, { stageId: await stageId(admin, 'QUALIFIED') }).expect(200);

    const { body } = await admin.get('/api/v1/analytics/overview?days=30').expect(200);
    expect(body.totals).toMatchObject({ newLeads: 3, contacted: 1, qualified: 2, converted: 1, lost: 0, revenue: 50000, conversionRate: 1 / 3 });
    expect(body.totals.avgResponseHours).toBeCloseTo(2, 1);
    expect(body.totals.avgSalesCycleDays).toBeCloseTo(4, 1);
    expect(body.series.length).toBe(30);
    expect(body.series.reduce((n: number, d: { newLeads: number }) => n + d.newLeads, 0)).toBe(3);
    expect(body.series.reduce((n: number, d: { conversions: number }) => n + d.conversions, 0)).toBe(1);
  });

  it('breaks results down by source and by salesperson', async () => {
    const a = await lead('A', { budget: 1000 });
    await lead('B');
    await patchLead(admin, a.id, { stageId: await stageId(admin, 'CONVERTED') }).expect(200);
    const { body: sources } = await admin.get('/api/v1/analytics/sources?days=30').expect(200);
    expect(sources.items).toContainEqual(expect.objectContaining({ name: 'Manual entry', leads: 2, converted: 1, qualified: 1, conversionRate: 0.5, revenue: 1000 }));

    const { body: team } = await admin.get('/api/v1/analytics/team?days=30').expect(200);
    expect(team.items).toContainEqual(expect.objectContaining({ userId: me.user.id, assigned: 2, converted: 1, conversionRate: 0.5 }));
  });

  it('forecasts the pipeline from stage probabilities without AI touching the numbers', async () => {
    const a = await lead('Negotiating', { budget: 10000 });
    const b = await lead('Interested', { budget: 4000 });
    const c = await lead('Lost one', { budget: 3000 });
    await patchLead(admin, a.id, { stageId: await stageId(admin, 'NEGOTIATION') }).expect(200);
    await patchLead(admin, b.id, { stageId: await stageId(admin, 'INTERESTED') }).expect(200);
    await patchLead(admin, c.id, { stageId: await stageId(admin, 'LOST') }).expect(200);
    const { body } = await admin.get('/api/v1/analytics/forecast').expect(200);
    // NEGOTIATION 60%, INTERESTED 40%
    expect(body.totals).toEqual({ pipelineValue: 14000, weightedPipeline: 7600, wonValue: 0, lostValue: 3000, openDeals: 2 });
    expect(body.stages.find((s: { key: string }) => s.key === 'NEGOTIATION')).toMatchObject({ count: 1, value: 10000, probability: 60, weighted: 6000 });
  });

  it('generates traceable insights with severity, evidence and a recommended action', async () => {
    const hot = await lead('Hot Buyer', { budget: 90000 });
    await t.db.execute(sql`update leads set temperature = 'HOT' where id = ${hot.id}`);
    const quiet = await lead('Quiet One', { ownerUserId: null });
    await t.db.execute(sql`update leads set created_at = ${ago(20)} where id = ${quiet.id}`);
    await admin.post(`/api/v1/leads/${hot.id}/followups`).set('Origin', ORIGIN).send({ type: 'CALL', scheduledAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(201);
    await t.db.execute(sql`update followups set scheduled_at = now() - interval '2 hours'`);

    const { body } = await admin.post('/api/v1/analytics/insights/refresh').set('Origin', ORIGIN).expect(200);
    const byKey = Object.fromEntries(body.items.map((i: { key: string }) => [i.key, i]));
    expect(byKey.top_opportunities).toMatchObject({ severity: 'INFO', evidence: { items: [expect.objectContaining({ label: 'Hot Buyer', link: `/leads/${hot.id}` })] } });
    expect(byKey.stale_leads).toMatchObject({ severity: 'WARNING', title: expect.stringContaining('1 open lead') });
    expect(byKey.unassigned_leads.title).toContain('1 open lead');
    expect(byKey.followup_risk).toMatchObject({ title: '1 follow-up is overdue', recommendedAction: expect.any(String) });
    // Warnings come before information.
    expect(body.items[0].severity).toBe('WARNING');
    expect((await admin.get('/api/v1/analytics/insights').expect(200)).body.items).toHaveLength(body.items.length);
  });

  it('requires analytics.view and validates the period', async () => {
    await admin.get('/api/v1/analytics/overview?days=0').expect(422);
    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'a@acme.test', fullName: 'Agent', role: 'AGENT', password: 'agent strong password' })
      .expect(201);
    const { agent } = await login(t, 'a@acme.test', 'agent strong password');
    await agent.get('/api/v1/analytics/overview').expect(403);
    await agent.get('/api/v1/analytics/team').expect(403);
  });
});
