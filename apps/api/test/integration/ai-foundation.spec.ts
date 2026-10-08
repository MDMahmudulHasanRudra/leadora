import { AiProviderError, FakeAiProvider } from '@leadora/ai';
import { sql } from 'drizzle-orm';
import type TestAgent from 'supertest/lib/agent';
import { AI_PROVIDER_FACTORY, ENV } from '../../src/infra/tokens';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead } from '../support/leads';
import { createOtherOrg } from '../support/orgs';

const KEY = 'sk-test-abcdefghijklmnop1234';
const analysis = (over: object = {}) =>
  JSON.stringify({
    summary: 'Wholesale buyer asking for 300 units with a delivery deadline.',
    intent: 'PURCHASE',
    buyingSignal: 'STRONG',
    urgency: 'HIGH',
    score: 88,
    objections: ['price'],
    productInterest: ['blue model'],
    recommendedAction: 'SEND_PRICING',
    rationale: 'Specific quantity and deadline.',
    nextAction: { type: 'CALL', inHours: 4, note: 'Confirm quantity and send the price sheet.' },
    ...over,
  });

describe('AI foundation: settings, gateway, prompts, usage', () => {
  let t: TestApp;
  let admin: TestAgent;
  let fake: FakeAiProvider;
  const seen: { provider: string; apiKey: string }[] = [];

  const put = (as: TestAgent, body: object) => as.put('/api/v1/ai/settings').set('Origin', ORIGIN).send(body);
  const analyze = (as: TestAgent, leadId: string) => as.post(`/api/v1/ai/leads/${leadId}/analyze`).set('Origin', ORIGIN);
  const configure = () =>
    put(admin, {
      enabled: true,
      apiKey: KEY,
      models: { fast: 'model-fast', balanced: 'model-balanced', embedding: 'model-embed' },
      prices: { 'model-balanced': { input: 2, cachedInput: 0.5, output: 8 } },
    }).expect(200);

  beforeAll(async () => {
    t = await createTestApp([
      {
        token: AI_PROVIDER_FACTORY,
        value: (provider: string, apiKey: string) => {
          seen.push({ provider, apiKey });
          return fake;
        },
      },
    ]);
  });
  beforeEach(async () => {
    await t.reset();
    fake = new FakeAiProvider();
    seen.length = 0;
    admin = (await registerAdmin(t)).agent;
  });
  afterAll(async () => t.close());

  it('starts disabled with no key', async () => {
    const { body } = await admin.get('/api/v1/ai/settings').expect(200);
    expect(body).toMatchObject({ provider: 'openai', enabled: false, hasApiKey: false, apiKeyLast4: null, models: {} });
  });

  it('stores the API key encrypted and only ever shows its last 4 characters', async () => {
    const { body } = await configure();
    expect(body).toMatchObject({ enabled: true, hasApiKey: true, apiKeyLast4: '1234', models: { balanced: 'model-balanced' } });
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(JSON.stringify((await admin.get('/api/v1/ai/settings').expect(200)).body)).not.toContain(KEY);
    const { rows } = await t.db.execute<{ api_key_enc: string }>(sql`select api_key_enc from ai_settings`);
    expect(rows[0]!.api_key_enc).not.toContain(KEY);

    // Saving other settings keeps the key; an empty string removes it.
    await put(admin, { monthlyBudgetUsd: 50 }).expect(200);
    expect((await admin.get('/api/v1/ai/settings').expect(200)).body.hasApiKey).toBe(true);
    expect((await put(admin, { apiKey: '' }).expect(200)).body.hasApiKey).toBe(false);
  });

  it('tests the provider connection without enabling AI and reports provider failures', async () => {
    const test = () => admin.post('/api/v1/ai/settings/test').set('Origin', ORIGIN);
    expect((await test().expect(409)).body.error.code).toBe('AI_NOT_CONFIGURED');
    await configure();
    await put(admin, { enabled: false }).expect(200);

    fake.reply('OK');
    expect((await test().expect(200)).body).toMatchObject({ ok: true, model: 'model-fast' });
    expect(fake.requests[0]).toMatchObject({ model: 'model-fast', maxOutputTokens: 16 });

    fake.reply(new AiProviderError('AI_AUTH_FAILED', 'The AI provider rejected the API key', 401));
    expect((await test().expect(200)).body).toMatchObject({ ok: false, code: 'AI_AUTH_FAILED' });

    const { rows } = await t.db.execute<{ purpose: string; status: string }>(sql`select purpose, status from ai_runs order by created_at`);
    expect(rows).toEqual([
      { purpose: 'connection_test', status: 'SUCCEEDED' },
      { purpose: 'connection_test', status: 'FAILED' },
    ]);
  });

  it('restricts AI settings to ai.configure', async () => {
    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'm@acme.test', fullName: 'Manager', role: 'MANAGER', password: 'manager strong password' })
      .expect(201);
    const { agent: manager } = await login(t, 'm@acme.test', 'manager strong password');
    await manager.get('/api/v1/ai/settings').expect(403);
    await manager.post('/api/v1/ai/settings/test').set('Origin', ORIGIN).expect(403);
    await put(manager, { enabled: true }).expect(403);
  });

  it('refuses to analyze while AI is off or unconfigured, and the CRM keeps working', async () => {
    const lead = (await createLead(admin).expect(201)).body;
    expect((await analyze(admin, lead.id).expect(409)).body.error.code).toBe('AI_DISABLED');
    await put(admin, { enabled: true }).expect(200);
    expect((await analyze(admin, lead.id).expect(409)).body.error.code).toBe('AI_NOT_CONFIGURED');
    await admin.patch(`/api/v1/leads/${lead.id}`).set('Origin', ORIGIN).send({ priority: 'HIGH' }).expect(200);
  });

  it('reports the installation kill switch separately from the organization switch', async () => {
    await configure();
    const lead = (await createLead(admin).expect(201)).body;
    const env = t.app.get<{ ENABLE_AI: boolean }>(ENV);
    env.ENABLE_AI = false;
    try {
      expect((await analyze(admin, lead.id).expect(409)).body.error.code).toBe('AI_PLATFORM_DISABLED');
      expect((await admin.get('/api/v1/ai/settings').expect(200)).body.platformEnabled).toBe(false);
    } finally {
      env.ENABLE_AI = true;
    }
    expect(fake.requests).toHaveLength(0);
  });

  it('analyzes a lead, stores the result, updates the score and logs usage and cost', async () => {
    await configure();
    const lead = (await createLead(admin, { fullName: 'Tanha', email: 'tanha@shop.test', notes: 'Needs 300 units' }).expect(201)).body;
    fake.reply(analysis());

    const res = await analyze(admin, lead.id).expect(200);
    expect(res.body).toMatchObject({ score: 88, intent: 'PURCHASE', recommendedAction: 'SEND_PRICING', nextAction: { type: 'CALL', inHours: 4 } });
    expect(seen).toEqual([{ provider: 'openai', apiKey: KEY }]);

    const req = fake.requests[0]!;
    expect(req.model).toBe('model-balanced');
    expect(req.input).toContain('<data label="lead">');
    expect(req.input).toContain('Needs 300 units');

    const updated = (await admin.get(`/api/v1/leads/${lead.id}`).expect(200)).body;
    // Hybrid (spec §14): business email = 20 rule points, blended 50/50 with the AI's 88.
    expect(updated).toMatchObject({ aiScore: 88, ruleScore: 20, score: 54, temperature: 'WARM' });
    expect((await admin.get(`/api/v1/ai/leads/${lead.id}/analysis`).expect(200)).body.result.summary).toContain('300 units');
    const { body: acts } = await admin.get(`/api/v1/leads/${lead.id}/activities`).expect(200);
    expect(acts.items[0]).toMatchObject({ type: 'ai.analysis_completed', payload: { score: 88 } });

    const usage = (await admin.get('/api/v1/ai/usage').expect(200)).body;
    // FakeAiProvider usage: 1000 in (200 cached), 100 out → (800*2 + 200*0.5 + 100*8) / 1e6
    expect(usage.month).toMatchObject({ calls: 1, inputTokens: 1000, outputTokens: 100, costUsd: 0.0025 });
    expect(usage.byPurpose).toEqual([expect.objectContaining({ purpose: 'lead_analysis', calls: 1 })]);
  });

  it('retries once on invalid output, then gives up without touching the lead', async () => {
    await configure();
    const lead = (await createLead(admin).expect(201)).body;

    fake.reply('not json', analysis({ score: 40 }));
    expect((await analyze(admin, lead.id).expect(200)).body.score).toBe(40);
    expect(fake.requests[1]!.input).toContain('Your previous answer was rejected');

    fake.reply(analysis({ score: 999 }), analysis({ intent: 'BANANA' }));
    expect((await analyze(admin, lead.id).expect(502)).body.error.code).toBe('AI_INVALID_OUTPUT');
    expect((await admin.get(`/api/v1/leads/${lead.id}`).expect(200)).body.aiScore).toBe(40);

    const { rows } = await t.db.execute<{ status: string; attempts: number }>(sql`select status, attempts from ai_runs order by created_at`);
    expect(rows).toEqual([
      { status: 'SUCCEEDED', attempts: 2 },
      { status: 'FAILED', attempts: 2 },
    ]);
  });

  it('blocks calls once the monthly budget is used up', async () => {
    await configure();
    // 10x the test prices → 0.025 USD per call, over a 1-cent budget after the first call.
    await put(admin, { monthlyBudgetUsd: 0.01, prices: { 'model-balanced': { input: 20, cachedInput: 5, output: 80 } } }).expect(200);
    await put(admin, { monthlyBudgetUsd: 0.001 }).expect(422);
    const lead = (await createLead(admin).expect(201)).body;
    fake.reply(analysis());
    await analyze(admin, lead.id).expect(200);
    expect((await analyze(admin, lead.id).expect(409)).body.error.code).toBe('AI_BUDGET_EXCEEDED');
    expect(fake.requests).toHaveLength(1);
  });

  it('versions prompts: a new version is used only once activated', async () => {
    await configure();
    const lead = (await createLead(admin).expect(201)).body;
    const { body: list } = await admin.get('/api/v1/ai/prompts').expect(200);
    expect(list.items).toContainEqual(expect.objectContaining({ key: 'lead_analysis', activeVersion: 0 }));

    const v1 = (
      await admin
        .post('/api/v1/ai/prompts/lead_analysis/versions')
        .set('Origin', ORIGIN)
        .send({ systemPrompt: 'Custom analyst prompt v1', modelProfile: 'fast', maxOutputTokens: 500 })
        .expect(201)
    ).body;
    expect(v1).toMatchObject({ version: 1, active: false });

    fake.reply(analysis(), analysis());
    await analyze(admin, lead.id).expect(200);
    expect(fake.requests[0]!.system).not.toContain('Custom analyst prompt');

    await admin.post(`/api/v1/ai/prompts/lead_analysis/versions/1/activate`).set('Origin', ORIGIN).expect(200);
    await analyze(admin, lead.id).expect(200);
    expect(fake.requests[1]).toMatchObject({ system: 'Custom analyst prompt v1', model: 'model-fast' });
  });

  it('keeps settings and analyses per organization', async () => {
    await configure();
    const lead = (await createLead(admin).expect(201)).body;
    const rival = await createOtherOrg(t, 'rival');
    expect((await rival.get('/api/v1/ai/settings').expect(200)).body.hasApiKey).toBe(false);
    await analyze(rival, lead.id).expect(404);
  });
});
