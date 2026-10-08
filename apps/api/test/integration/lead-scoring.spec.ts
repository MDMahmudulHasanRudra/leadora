import { processInboundEvent, rescoreOrganization } from '@leadora/domain';
import { Queue } from 'bullmq';
import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createEmailInbox } from '../support/inbox';
import { createLead, LEAD, patchLead } from '../support/leads';
import { createOtherOrg } from '../support/orgs';
import { testEnv } from '../support/test-env';
import { postInbound } from '../support/webhook';

describe('hybrid lead scoring (spec §14–15)', () => {
  let t: TestApp;
  let admin: TestAgent;
  let queue: Queue;

  const getLead = async (id: string) => (await admin.get(`/api/v1/leads/${id}`).expect(200)).body;
  const putSettings = (as: TestAgent, body: object) => as.put('/api/v1/scoring/settings').set('Origin', ORIGIN).send(body);

  beforeAll(async () => {
    t = await createTestApp();
    queue = new Queue('default', { connection: { url: testEnv().valkeyUrl } });
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await registerAdmin(t)).agent;
  });
  afterAll(async () => {
    await queue.close();
    await t.close();
  });

  it('scores a new lead from explainable rules', async () => {
    // LEAD has a company-domain email and a phone number.
    const lead = (await createLead(admin).expect(201)).body;
    expect(lead).toMatchObject({ score: 25, ruleScore: 25, aiScore: null, temperature: 'COLD' });
    expect(lead.scoreBreakdown.rules).toEqual([
      { key: 'business_email', points: 20 },
      { key: 'has_phone', points: 5 },
    ]);
    const free = (await createLead(admin, { fullName: 'Free Mail', email: 'someone@gmail.com' }).expect(201)).body;
    expect(free).toMatchObject({ score: 0, temperature: 'COLD' });
  });

  it('rescores when the lead changes and when the customer writes in', async () => {
    const lead = (await createLead(admin).expect(201)).body;
    expect((await patchLead(admin, lead.id, { budget: 50000 }).expect(200)).body.score).toBe(35);

    const { inbox, webhookSecret } = await createEmailInbox(admin);
    const res = await postInbound(t, inbox.id, webhookSecret, {
      messageId: '<price-1@customer.test>',
      from: { email: LEAD.email, name: LEAD.fullName },
      to: 'sales@acme.test',
      subject: 'Quote',
      text: 'Hi, what is your price for 300 units?',
    }).expect(202);
    await processInboundEvent(t.db, res.body.eventId);

    // +15 customer messaged us, +20 asked about pricing
    expect(await getLead(lead.id)).toMatchObject({ score: 70, temperature: 'WARM' });
  });

  it('exposes defaults and lets an admin tune weights, thresholds and rules, then rescores the organization', async () => {
    const { body: defaults } = await admin.get('/api/v1/scoring/settings').expect(200);
    expect(defaults).toMatchObject({ ruleWeight: 50, aiWeight: 50, hotThreshold: 80, warmThreshold: 50 });
    expect(defaults.rules).toContainEqual({ key: 'pricing_inquiry', label: expect.any(String), enabled: true, points: 20 });

    const lead = (await createLead(admin).expect(201)).body;
    const { body } = await putSettings(admin, {
      hotThreshold: 60,
      warmThreshold: 20,
      rules: { business_email: { enabled: true, points: 60 } },
    }).expect(200);
    expect(body).toMatchObject({ hotThreshold: 60, warmThreshold: 20 });
    expect(body.rules).toContainEqual(expect.objectContaining({ key: 'business_email', points: 60 }));
    expect(await queue.getJobs(['waiting', 'delayed', 'prioritized'])).toContainEqual(expect.objectContaining({ name: 'scoring.rescore_org' }));

    const { body: me } = await admin.get('/api/v1/auth/me').expect(200);
    await rescoreOrganization(t.db, me.organization.id);
    expect(await getLead(lead.id)).toMatchObject({ score: 65, temperature: 'HOT' });
  });

  it('validates settings and restricts them to settings.manage', async () => {
    expect((await putSettings(admin, { hotThreshold: 40, warmThreshold: 60 }).expect(422)).body.error.code).toBe('VALIDATION_FAILED');
    await putSettings(admin, { rules: { nonsense: { enabled: true, points: 5 } } }).expect(422);
    await putSettings(admin, { rules: { has_phone: { enabled: true, points: 500 } } }).expect(422);

    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'a@acme.test', fullName: 'Agent', role: 'AGENT', password: 'agent strong password' })
      .expect(201);
    const { agent } = await login(t, 'a@acme.test', 'agent strong password');
    await agent.get('/api/v1/scoring/settings').expect(403);
    await putSettings(agent, { aiWeight: 0 }).expect(403);
  });

  it('keeps scoring settings per organization', async () => {
    await putSettings(admin, { hotThreshold: 60, warmThreshold: 20 }).expect(200);
    const rival = await createOtherOrg(t, 'rival');
    expect((await rival.get('/api/v1/scoring/settings').expect(200)).body.hotThreshold).toBe(80);
  });
});
