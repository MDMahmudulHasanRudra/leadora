import { FakeAiProvider } from '@leadora/ai';
import { type AutomationDeps, dispatchEvents, dispatchInactiveLeads, emitOverdueFollowupEvents, executeRun } from '@leadora/domain';
import { sql } from 'drizzle-orm';
import type TestAgent from 'supertest/lib/agent';
import { AiService } from '../../src/ai/ai.service';
import { AI_PROVIDER_FACTORY, ENV } from '../../src/infra/tokens';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead, patchLead, stageId } from '../support/leads';

const analysis = JSON.stringify({
  summary: 'Ready to buy.',
  intent: 'PURCHASE',
  buyingSignal: 'STRONG',
  urgency: 'HIGH',
  score: 90,
  objections: [],
  productInterest: [],
  recommendedAction: 'CALL_NOW',
  rationale: 'Clear intent.',
  nextAction: { type: 'CALL', inHours: 1, note: 'Call now' },
});

describe('automations: triggers, conditions, actions, idempotency, retries (spec §40–41, §110)', () => {
  let t: TestApp;
  let admin: TestAgent;
  let me: { user: { id: string }; organization: { id: string } };
  let fake: FakeAiProvider;
  const enqueued: string[] = [];

  const rule = (body: object) => admin.post('/api/v1/automations').set('Origin', ORIGIN).send({ name: 'Rule', ...body });
  const deps = (): AutomationDeps => ({ ai: t.app.get(AiService).deps(), enqueueMessage: async () => undefined, knowledgeEnabled: false });
  const dispatch = () => dispatchEvents(t.db, { enqueueRun: async (id) => void enqueued.push(id) });
  const execute = (id: string, finalAttempt = true) => executeRun(t.db, deps(), id, { finalAttempt });
  /** Dispatch and execute until no new runs appear, like the worker does continuously. */
  const settle = async () => {
    for (let i = 0; i < 10; i++) {
      const { runs } = await dispatch();
      if (runs.length === 0) return;
      for (const id of runs) await execute(id);
    }
  };
  const runs = async () => (await admin.get('/api/v1/automations/runs').expect(200)).body.items;

  beforeAll(async () => {
    t = await createTestApp([{ token: AI_PROVIDER_FACTORY, value: () => fake }]);
  });
  beforeEach(async () => {
    await t.reset();
    enqueued.length = 0;
    fake = new FakeAiProvider();
    admin = (await registerAdmin(t)).agent;
    me = (await admin.get('/api/v1/auth/me').expect(200)).body;
  });
  afterAll(async () => t.close());

  it('runs a multi-step workflow for a lead event exactly once, however often it is dispatched or executed', async () => {
    await rule({
      trigger: 'lead.created',
      conditions: [{ field: 'lead.source', op: 'eq', value: 'MANUAL' }],
      actions: [
        { type: 'add_tag', params: { tag: 'auto-new' } },
        { type: 'change_priority', params: { priority: 'HIGH' } },
        { type: 'create_followup', params: { type: 'CALL', inHours: 2, notes: 'Call {{lead.firstName}}' } },
        { type: 'send_notification', params: { to: 'owner', title: 'New lead: {{lead.fullName}}' } },
      ],
    }).expect(201);
    const lead = (await createLead(admin, { fullName: 'Sadia Islam', email: 'sadia@shop.test', ownerUserId: me.user.id }).expect(201)).body;

    const first = await dispatch();
    expect(first.runs).toHaveLength(1);
    // The event is processed: dispatching again finds nothing new.
    expect((await dispatch()).runs).toEqual([]);
    // Even if the same event were delivered again, the idempotency key blocks a second run.
    await t.db.execute(sql`update domain_events set processed_at = null`);
    expect((await dispatch()).runs).toEqual([]);

    const runId = first.runs[0]!;
    expect(await execute(runId)).toEqual({ status: 'SUCCEEDED' });
    expect(await execute(runId)).toEqual({ status: 'SKIPPED' });

    const updated = (await admin.get(`/api/v1/leads/${lead.id}`).expect(200)).body;
    expect(updated).toMatchObject({ priority: 'HIGH', tags: ['auto-new'] });
    const { body: fus } = await admin.get(`/api/v1/followups?leadId=${lead.id}&status=all`).expect(200);
    expect(fus.items).toHaveLength(1);
    expect(fus.items[0]).toMatchObject({ type: 'CALL', notes: 'Call Sadia' });
    const { body: notes } = await admin.get('/api/v1/notifications').expect(200);
    expect(notes.items.filter((n: { type: string }) => n.type === 'automation')).toHaveLength(1);

    const [run] = await runs();
    expect(run).toMatchObject({ status: 'SUCCEEDED', ruleVersion: 1, trigger: 'lead.created', leadName: 'Sadia Islam' });
    expect(run.steps.map((s: { type: string; status: string }) => `${s.type}:${s.status}`)).toEqual([
      'add_tag:SUCCEEDED',
      'change_priority:SUCCEEDED',
      'create_followup:SUCCEEDED',
      'send_notification:SUCCEEDED',
    ]);
  });

  it('only runs when every condition holds', async () => {
    await rule({ trigger: 'lead.created', conditions: [{ field: 'lead.source', op: 'eq', value: 'WEBSITE' }], actions: [{ type: 'add_tag', params: { tag: 'web' } }] }).expect(201);
    await createLead(admin).expect(201);
    expect((await dispatch()).runs).toEqual([]);
  });

  it('stops rules that trigger each other', async () => {
    const qualified = await stageId(admin, 'QUALIFIED');
    await rule({ name: 'A', trigger: 'lead.stage_changed', conditions: [{ field: 'event.to', op: 'eq', value: 'qualified' }], actions: [{ type: 'change_stage', params: { stageKey: 'contacted' } }] }).expect(201);
    await rule({ name: 'B', trigger: 'lead.stage_changed', conditions: [{ field: 'event.to', op: 'eq', value: 'contacted' }], actions: [{ type: 'change_stage', params: { stageKey: 'qualified' } }] }).expect(201);
    const lead = (await createLead(admin).expect(201)).body;
    await patchLead(admin, lead.id, { stageId: qualified }).expect(200);

    await settle();
    // user change (depth 0) → A → B → A, then the depth limit stops the chain.
    const all = await runs();
    expect(all.map((r: { ruleName: string; depth: number }) => `${r.ruleName}@${r.depth}`).reverse()).toEqual(['A@0', 'B@1', 'A@2']);
    const { rows } = await t.db.execute<{ n: number }>(sql`select count(*)::int as n from domain_events where processed_at is null`);
    expect(rows[0]!.n).toBe(0);
  });

  it('records skipped steps, fails cleanly, and a retry resumes without repeating finished steps', async () => {
    const { body: inbox } = await admin.post('/api/v1/inboxes').set('Origin', ORIGIN).send({ name: 'Sales', channel: 'EMAIL', address: 'sales@acme.test' }).expect(201);
    await rule({
      trigger: 'lead.created',
      actions: [
        { type: 'add_tag', params: { tag: 'step-1' } },
        { type: 'send_email', params: { inboxId: inbox.inbox.id, subject: 'Hi', body: 'Hello {{lead.firstName}}' } },
        { type: 'run_ai_analysis', params: {} },
      ],
    }).expect(201);
    const lead = (await createLead(admin, { fullName: 'No Email', phone: '01711000111' }).expect(201)).body;
    const [runId] = (await dispatch()).runs;

    // AI is not configured yet: a permanent error fails the run on that step.
    expect(await execute(runId!)).toMatchObject({ status: 'FAILED' });
    let run = (await admin.get(`/api/v1/automations/runs/${runId}`).expect(200)).body;
    expect(run.steps.map((s: { status: string }) => s.status)).toEqual(['SUCCEEDED', 'SKIPPED', 'FAILED']);
    expect(run.steps[1].error).toMatch(/no email/i);
    expect(run.error).toMatch(/AI/);

    await admin
      .put('/api/v1/ai/settings')
      .set('Origin', ORIGIN)
      .send({ enabled: true, apiKey: 'sk-test-abcdefghijklmnop1234', models: { balanced: 'model-balanced' } })
      .expect(200);
    fake.reply(analysis);
    await admin.post(`/api/v1/automations/runs/${runId}/retry`).set('Origin', ORIGIN).expect(202);
    expect(await execute(runId!)).toEqual({ status: 'SUCCEEDED' });
    run = (await admin.get(`/api/v1/automations/runs/${runId}`).expect(200)).body;
    expect(run.steps.map((s: { status: string }) => s.status)).toEqual(['SUCCEEDED', 'SKIPPED', 'SUCCEEDED']);
    expect(run.attempts).toBe(2);
    expect((await admin.get(`/api/v1/leads/${lead.id}`).expect(200)).body.aiScore).toBe(90);
    // The tag step ran once.
    const { rows } = await t.db.execute<{ n: number }>(sql`select count(*)::int as n from lead_tag_links`);
    expect(rows[0]!.n).toBe(1);
  });

  it('retries transient failures through the queue before giving up', async () => {
    await admin
      .put('/api/v1/ai/settings')
      .set('Origin', ORIGIN)
      .send({ enabled: true, apiKey: 'sk-test-abcdefghijklmnop1234', models: { balanced: 'model-balanced' } })
      .expect(200);
    await rule({ trigger: 'lead.created', actions: [{ type: 'run_ai_analysis', params: {} }] }).expect(201);
    await createLead(admin).expect(201);
    const [runId] = (await dispatch()).runs;
    fake.reply(new Error('socket hang up'));
    await expect(execute(runId!, false)).rejects.toThrow();
    expect((await admin.get(`/api/v1/automations/runs/${runId}`).expect(200)).body.status).toBe('RETRYING');
    fake.reply(analysis);
    expect(await execute(runId!, false)).toEqual({ status: 'SUCCEEDED' });
  });

  it('fires time-based triggers once: overdue follow-ups and inactive leads', async () => {
    await rule({ name: 'Overdue', trigger: 'followup.overdue', actions: [{ type: 'send_notification', params: { to: 'managers', title: 'Overdue: {{lead.fullName}}' } }] }).expect(201);
    await rule({ name: 'Quiet', trigger: 'lead.inactive', triggerConfig: { days: 3 }, actions: [{ type: 'add_tag', params: { tag: 'quiet' } }] }).expect(201);
    const lead = (await createLead(admin).expect(201)).body;
    await admin.post(`/api/v1/leads/${lead.id}/followups`).set('Origin', ORIGIN).send({ type: 'CALL', scheduledAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(201);
    await t.db.execute(sql`update followups set scheduled_at = now() - interval '1 hour'`);
    await t.db.execute(sql`update leads set created_at = now() - interval '5 days', last_contacted_at = null`);
    await dispatch(); // lead.created had no matching rule

    expect(await emitOverdueFollowupEvents(t.db)).toBe(1);
    expect(await emitOverdueFollowupEvents(t.db)).toBe(0);
    expect((await dispatch()).runs).toHaveLength(1);

    expect(await dispatchInactiveLeads(t.db, { enqueueRun: async () => undefined })).toHaveLength(1);
    expect(await dispatchInactiveLeads(t.db, { enqueueRun: async () => undefined })).toHaveLength(0);
    expect((await runs()).map((r: { ruleName: string }) => r.ruleName).sort()).toEqual(['Overdue', 'Quiet']);
  });

  it('validates rules, versions edits, and restricts management', async () => {
    expect((await rule({ trigger: 'lead.exploded', actions: [{ type: 'add_tag', params: { tag: 'x' } }] }).expect(422)).body.error.code).toBe('VALIDATION_FAILED');
    await rule({ trigger: 'lead.created', actions: [] }).expect(422);
    await rule({ trigger: 'lead.created', actions: [{ type: 'assign_lead', params: { mode: 'user', userId: '00000000-0000-0000-0000-000000000000' } }] }).expect(422);
    await rule({ trigger: 'lead.created', conditions: [{ field: 'lead.password', op: 'eq', value: 'x' }], actions: [{ type: 'add_tag', params: { tag: 'x' } }] }).expect(422);

    const created = (await rule({ trigger: 'lead.created', actions: [{ type: 'add_tag', params: { tag: 'v1' } }] }).expect(201)).body;
    const updated = (
      await admin
        .put(`/api/v1/automations/${created.id}`)
        .set('Origin', ORIGIN)
        .send({ name: 'Rule', trigger: 'lead.created', actions: [{ type: 'add_tag', params: { tag: 'v2' } }] })
        .expect(200)
    ).body;
    expect(updated.version).toBe(2);
    expect((await admin.patch(`/api/v1/automations/${created.id}`).set('Origin', ORIGIN).send({ enabled: false }).expect(200)).body.enabled).toBe(false);
    await createLead(admin).expect(201);
    expect((await dispatch()).runs).toEqual([]);

    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'm@acme.test', fullName: 'Manager', role: 'MANAGER', password: 'manager strong password' })
      .expect(201);
    const { agent: manager } = await login(t, 'm@acme.test', 'manager strong password');
    await manager.get('/api/v1/automations').expect(200);
    await manager.post('/api/v1/automations').set('Origin', ORIGIN).send({ name: 'x', trigger: 'lead.created', actions: [{ type: 'add_tag', params: { tag: 'x' } }] }).expect(403);

    const { body: audit } = await admin.get('/api/v1/audit-logs').expect(200);
    expect(audit.items.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['automation.created', 'automation.updated', 'automation.disabled']));
  });

  it('is off unless the installation enables it', async () => {
    const env = t.app.get<{ ENABLE_AUTOMATION: boolean }>(ENV);
    env.ENABLE_AUTOMATION = false;
    try {
      expect((await admin.get('/api/v1/automations').expect(409)).body.error.code).toBe('AUTOMATION_DISABLED');
    } finally {
      env.ENABLE_AUTOMATION = true;
    }
  });
});
