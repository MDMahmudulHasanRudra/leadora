import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead, LEAD, patchLead } from '../support/leads';
import { createOtherOrg } from '../support/orgs';

describe('custom fields on leads', () => {
  let t: TestApp;
  let admin: TestAgent;

  const define = (as: TestAgent, body: object) => as.post('/api/v1/custom-fields').set('Origin', ORIGIN).send(body);

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await registerAdmin(t)).agent;
    await define(admin, { label: 'Budget range', type: 'select', options: ['< 10k', '10k-50k', '50k+'] }).expect(201);
    await define(admin, { label: 'Team size', type: 'number' }).expect(201);
    await define(admin, { label: 'Has website', type: 'boolean' }).expect(201);
    await define(admin, { label: 'Expected close', type: 'date' }).expect(201);
    await define(admin, { label: 'Interests', type: 'multi_select', options: ['POS', 'ERP', 'CRM'] }).expect(201);
  });
  afterAll(async () => t.close());

  it('lists definitions in order with generated keys', async () => {
    const { body } = await admin.get('/api/v1/custom-fields?entity=lead').expect(200);
    expect(body.items.map((f: { key: string; type: string }) => [f.key, f.type])).toEqual([
      ['budget_range', 'select'],
      ['team_size', 'number'],
      ['has_website', 'boolean'],
      ['expected_close', 'date'],
      ['interests', 'multi_select'],
    ]);
  });

  it('stores and returns typed values on a lead', async () => {
    const customFields = { budget_range: '10k-50k', team_size: 12, has_website: true, expected_close: '2026-12-01', interests: ['POS', 'CRM'] };
    const res = await createLead(admin, { ...LEAD, customFields }).expect(201);
    expect(res.body.customFields).toEqual(customFields);
    expect((await admin.get(`/api/v1/leads/${res.body.id}`).expect(200)).body.customFields).toEqual(customFields);
  });

  it.each([
    [{ budget_range: '1M' }, 'customFields.budget_range'],
    [{ team_size: 'many' }, 'customFields.team_size'],
    [{ team_size: 1.5 }, 'customFields.team_size'],
    [{ has_website: 'yes' }, 'customFields.has_website'],
    [{ expected_close: '2026-13-45' }, 'customFields.expected_close'],
    [{ interests: ['POS', 'Unknown'] }, 'customFields.interests'],
  ])('rejects invalid value %j', async (customFields, path) => {
    const res = await createLead(admin, { ...LEAD, customFields }).expect(422);
    expect(res.body.error.details[0].path).toBe(path);
  });

  it('rejects unknown custom field keys', async () => {
    const res = await createLead(admin, { ...LEAD, customFields: { shoe_size: 42 } }).expect(422);
    expect(res.body.error.code).toBe('UNKNOWN_CUSTOM_FIELD');
  });

  it('enforces required fields on create and does not allow clearing them', async () => {
    await define(admin, { label: 'Region', type: 'text', required: true }).expect(201);
    const missing = await createLead(admin, LEAD).expect(422);
    expect(missing.body.error.details[0].path).toBe('customFields.region');

    const { body: lead } = await createLead(admin, { ...LEAD, customFields: { region: 'Dhaka' } }).expect(201);
    await patchLead(admin, lead.id, { customFields: { region: null } }).expect(422);
  });

  it('updates and clears values, recording the change', async () => {
    const { body: lead } = await createLead(admin, { ...LEAD, customFields: { team_size: 12, has_website: false } }).expect(201);
    const res = await patchLead(admin, lead.id, { customFields: { team_size: 15, has_website: null } }).expect(200);
    expect(res.body.customFields).toEqual({ team_size: 15 });

    const { body } = await admin.get(`/api/v1/leads/${lead.id}/activities`).expect(200);
    expect(body.items[0].payload.changes).toEqual({
      'customFields.team_size': { from: 12, to: 15 },
      'customFields.has_website': { from: false, to: null },
    });
  });

  it('archiving a definition hides it and blocks new values', async () => {
    const { body: fields } = await admin.get('/api/v1/custom-fields?entity=lead').expect(200);
    const teamSize = fields.items.find((f: { key: string }) => f.key === 'team_size');
    const { body: lead } = await createLead(admin, { ...LEAD, customFields: { team_size: 3 } }).expect(201);

    await admin.delete(`/api/v1/custom-fields/${teamSize.id}`).set('Origin', ORIGIN).expect(204);
    expect((await admin.get('/api/v1/custom-fields?entity=lead').expect(200)).body.items).toHaveLength(4);
    expect((await admin.get(`/api/v1/leads/${lead.id}`).expect(200)).body.customFields).toEqual({});
    await patchLead(admin, lead.id, { customFields: { team_size: 4 } }).expect(422);
  });

  it('renames a field and edits select options without changing its key', async () => {
    const { body: fields } = await admin.get('/api/v1/custom-fields?entity=lead').expect(200);
    const budget = fields.items.find((f: { key: string }) => f.key === 'budget_range');
    const res = await admin
      .patch(`/api/v1/custom-fields/${budget.id}`)
      .set('Origin', ORIGIN)
      .send({ label: 'Budget', options: ['< 10k', '10k-50k', '50k+', '1M+'] })
      .expect(200);
    expect(res.body).toMatchObject({ key: 'budget_range', label: 'Budget' });
    await createLead(admin, { ...LEAD, customFields: { budget_range: '1M+' } }).expect(201);
  });

  it('rejects duplicate labels and non-admin definitions', async () => {
    expect((await define(admin, { label: 'team size', type: 'text' }).expect(409)).body.error.code).toBe('CUSTOM_FIELD_EXISTS');
    await define(admin, { label: 'Colour', type: 'select' }).expect(422);

    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'karim@acme.test', fullName: 'Karim', role: 'AGENT', password: 'agent strong password' })
      .expect(201);
    const { agent } = await login(t, 'karim@acme.test', 'agent strong password');
    await agent.get('/api/v1/custom-fields?entity=lead').expect(200);
    await define(agent, { label: 'Sneaky', type: 'text' }).expect(403);
  });

  it('isolates definitions per organization', async () => {
    const rival = await createOtherOrg(t, 'rival');
    expect((await rival.get('/api/v1/custom-fields?entity=lead').expect(200)).body.items).toEqual([]);
    await define(rival, { label: 'Team size', type: 'text' }).expect(201);
    const mine = (await admin.get('/api/v1/custom-fields?entity=lead').expect(200)).body.items[0];
    await rival.patch(`/api/v1/custom-fields/${mine.id}`).set('Origin', ORIGIN).send({ label: 'x' }).expect(404);
  });
});
