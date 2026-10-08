import { FakeAiProvider } from '@leadora/ai';
import { sql } from 'drizzle-orm';
import type TestAgent from 'supertest/lib/agent';
import { AI_PROVIDER_FACTORY } from '../../src/infra/tokens';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead } from '../support/leads';
import { createOtherOrg } from '../support/orgs';

const noLeadFilters = {
  temperatures: null,
  stageKeys: null,
  outcome: null,
  owner: null,
  sourceTypes: null,
  createdWithinDays: null,
  noFollowupWithinHours: null,
  hasOverdueFollowup: null,
  minScore: null,
  mentions: null,
  text: null,
  sort: null,
};
const plan = (over: object) => JSON.stringify({ tool: 'search_leads', leads: null, periodDays: null, followups: null, mineOnly: null, explanation: 'Interpreted.', ...over });
const answer = (text: string) => JSON.stringify({ answer: text, highlights: [] });

describe('AI sales assistant: natural-language CRM search (spec §38–39)', () => {
  let t: TestApp;
  let admin: TestAgent;
  let fake: FakeAiProvider;

  const ask = (as: TestAgent, question: string) => as.post('/api/v1/ai/assistant/query').set('Origin', ORIGIN).send({ question });
  const setTemperature = (id: string, temperature: 'HOT' | 'WARM' | 'COLD') => t.db.execute(sql`update leads set temperature = ${temperature} where id = ${id}`);

  beforeAll(async () => {
    t = await createTestApp([{ token: AI_PROVIDER_FACTORY, value: () => fake }]);
  });
  beforeEach(async () => {
    await t.reset();
    fake = new FakeAiProvider();
    admin = (await registerAdmin(t)).agent;
    await admin
      .put('/api/v1/ai/settings')
      .set('Origin', ORIGIN)
      .send({ enabled: true, apiKey: 'sk-test-abcdefghijklmnop1234', models: { fast: 'model-fast' } })
      .expect(200);
  });
  afterAll(async () => t.close());

  it('plans a typed lead search, runs it under the asker’s scope and summarises the rows', async () => {
    const quiet = (await createLead(admin, { fullName: 'Quiet Hot', email: 'quiet@acme.test' }).expect(201)).body;
    const planned = (await createLead(admin, { fullName: 'Planned Hot', email: 'planned@acme.test' }).expect(201)).body;
    const warm = (await createLead(admin, { fullName: 'Just Warm', email: 'warm@acme.test' }).expect(201)).body;
    await Promise.all([setTemperature(quiet.id, 'HOT'), setTemperature(planned.id, 'HOT'), setTemperature(warm.id, 'WARM')]);
    await admin
      .post(`/api/v1/leads/${planned.id}/followups`)
      .set('Origin', ORIGIN)
      .send({ type: 'CALL', scheduledAt: new Date(Date.now() + 3 * 3_600_000).toISOString() })
      .expect(201);
    // Another organization's hot lead must never appear.
    const rival = await createOtherOrg(t, 'rival');
    const theirs = (await createLead(rival, { fullName: 'Rival Hot', email: 'r@rival.test' }).expect(201)).body;
    await setTemperature(theirs.id, 'HOT');

    fake.reply(
      plan({ leads: { ...noLeadFilters, temperatures: ['HOT'], noFollowupWithinHours: 24 }, explanation: 'Hot leads not contacted and with nothing scheduled in 24 hours.' }),
      answer('One hot lead needs attention: Quiet Hot.'),
    );
    const { body } = await ask(admin, 'Show hot leads with no follow-up in 24 hours').expect(200);

    expect(body.plan).toMatchObject({ tool: 'search_leads', explanation: expect.stringContaining('24 hours') });
    expect(body.results.kind).toBe('leads');
    expect(body.results.items.map((l: { fullName: string }) => l.fullName)).toEqual(['Quiet Hot']);
    expect(body.answer).toBe('One hot lead needs attention: Quiet Hot.');

    const [planner, answerer] = fake.requests;
    expect(planner!.model).toBe('model-fast');
    expect(planner!.input).toContain('Show hot leads with no follow-up in 24 hours');
    expect(planner!.input).toContain('<data label="stages">');
    expect(answerer!.input).toContain('<data label="results">');
    expect(answerer!.input).toContain('Quiet Hot');
    expect(answerer!.input).not.toContain('Rival Hot');

    const { body: history } = await admin.get('/api/v1/ai/assistant/history').expect(200);
    expect(history.items[0]).toMatchObject({ question: 'Show hot leads with no follow-up in 24 hours', tool: 'search_leads', status: 'ANSWERED', resultCount: 1 });
  });

  it('finds leads by what the customer said, and skips the summary call when nothing matches', async () => {
    const lead = (await createLead(admin, { fullName: 'Price Asker', email: 'p@acme.test', notes: 'Asked about the price for 300 units' }).expect(201)).body;
    fake.reply(plan({ leads: { ...noLeadFilters, mentions: 'price', outcome: 'OPEN' } }), answer('Price Asker asked about pricing and is still open.'));
    const { body } = await ask(admin, 'Show leads asking about pricing but not converted').expect(200);
    expect(body.results.items.map((l: { id: string }) => l.id)).toEqual([lead.id]);

    fake.reply(plan({ leads: { ...noLeadFilters, mentions: 'warranty' } }));
    const { body: none } = await ask(admin, 'Who asked about warranty?').expect(200);
    expect(none).toMatchObject({ results: { kind: 'leads', items: [] }, answer: 'Nothing matched this question.' });
    expect(fake.requests).toHaveLength(3);
  });

  it('answers team and source questions for managers, and refuses them to agents without running the tool', async () => {
    await createLead(admin).expect(201);
    fake.reply(plan({ tool: 'team_performance', periodDays: 30 }), answer('Everyone is at 0% this month.'));
    const { body } = await ask(admin, 'Which sales agent has the best conversion rate this month?').expect(200);
    expect(body.results.kind).toBe('team');
    expect(body.results.items[0]).toMatchObject({ fullName: expect.any(String), leads: expect.any(Number), conversionRate: expect.any(Number) });

    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'a@acme.test', fullName: 'Agent', role: 'AGENT', password: 'agent strong password' })
      .expect(201);
    const { agent } = await login(t, 'a@acme.test', 'agent strong password');
    fake.reply(plan({ tool: 'source_performance' }));
    const { body: denied } = await ask(agent, 'Which lead source produced the most revenue?').expect(200);
    expect(denied).toMatchObject({ status: 'DENIED', results: null });
    expect(denied.answer).toMatch(/permission/i);
    expect(fake.requests).toHaveLength(3);
  });

  it('declines requests outside its read-only tools', async () => {
    fake.reply(plan({ tool: 'unsupported', explanation: 'I can only look things up, not delete leads.' }));
    const { body } = await ask(admin, 'Delete all cold leads').expect(200);
    expect(body).toMatchObject({ status: 'UNSUPPORTED', results: null, answer: 'I can only look things up, not delete leads.' });
    expect(fake.requests).toHaveLength(1);
  });

  it('requires ai.use and a real question', async () => {
    await ask(admin, 'x').expect(422);
    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'v@acme.test', fullName: 'Viewer', role: 'VIEWER', password: 'viewer strong password' })
      .expect(201);
    const { agent: viewer } = await login(t, 'v@acme.test', 'viewer strong password');
    await ask(viewer, 'Show hot leads').expect(403);
  });
});
