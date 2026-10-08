import { processLeadImport } from '@leadora/domain';
import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead } from '../support/leads';
import { createOtherOrg } from '../support/orgs';

describe('assignment rules', () => {
  let t: TestApp;
  let admin: TestAgent;
  let a: string;
  let b: string;
  let teamId: string;

  const rule = (as: TestAgent, body: object) => as.post('/api/v1/assignment-rules').set('Origin', ORIGIN).send(body);
  const addUser = async (email: string, fullName: string) =>
    (
      await admin
        .post('/api/v1/users')
        .set('Origin', ORIGIN)
        .send({ email, fullName, role: 'AGENT', password: 'agent strong password' })
        .expect(201)
    ).body.id as string;

  async function importCsv(csv: string, extra: object = {}) {
    const { body: imp } = await admin.post('/api/v1/lead-imports').set('Origin', ORIGIN).attach('file', Buffer.from(csv), 'x.csv').expect(201);
    await admin
      .post(`/api/v1/lead-imports/${imp.id}/start`)
      .set('Origin', ORIGIN)
      .send({ mapping: { fullName: 'Name', email: 'Email' }, autoAssign: true, ...extra })
      .expect(202);
    await processLeadImport(t.db, imp.id);
  }
  const ownersByName = async () =>
    Object.fromEntries(
      ((await admin.get('/api/v1/leads?limit=100').expect(200)).body.items as { fullName: string; owner: { id: string } | null }[]).map((l) => [
        l.fullName,
        l.owner?.id ?? null,
      ]),
    );

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await registerAdmin(t)).agent;
    a = await addUser('a@acme.test', 'Agent A');
    b = await addUser('b@acme.test', 'Agent B');
    teamId = (await admin.post('/api/v1/teams').set('Origin', ORIGIN).send({ name: 'Inbound' }).expect(201)).body.id;
    for (const id of [a, b]) await admin.put(`/api/v1/teams/${teamId}/members/${id}`).set('Origin', ORIGIN).expect(204);
  });
  afterAll(async () => t.close());

  it('assigns to a specific user when the rule matches', async () => {
    await rule(admin, { name: 'CSV to A', conditions: { sourceTypes: ['CSV'] }, strategy: 'USER', targetUserId: a }).expect(201);
    await importCsv('Name,Email\nOne,one@x.test\n');
    expect(await ownersByName()).toEqual({ One: a });
    const { body: lead } = await admin.get('/api/v1/leads').expect(200);
    const { body } = await admin.get(`/api/v1/leads/${lead.items[0].id}/activities`).expect(200);
    expect(body.items[0].payload).toMatchObject({ ownerUserId: a, assignmentRule: 'CSV to A' });
  });

  it('round-robins across active team members', async () => {
    await rule(admin, { name: 'RR', conditions: {}, strategy: 'ROUND_ROBIN', targetTeamId: teamId }).expect(201);
    await importCsv('Name,Email\nL1,1@x.test\nL2,2@x.test\nL3,3@x.test\n');
    const owners = await ownersByName();
    expect(new Set([owners.L1, owners.L2])).toEqual(new Set([a, b]));
    expect(owners.L3).toBe(owners.L1);
  });

  it('skips disabled members in round-robin', async () => {
    await admin.patch(`/api/v1/users/${a}`).set('Origin', ORIGIN).send({ status: 'DISABLED' }).expect(200);
    await rule(admin, { name: 'RR', conditions: {}, strategy: 'ROUND_ROBIN', targetTeamId: teamId }).expect(201);
    await importCsv('Name,Email\nL1,1@x.test\nL2,2@x.test\n');
    expect(await ownersByName()).toEqual({ L1: b, L2: b });
  });

  it('gives the lead to the least-loaded member', async () => {
    await createLead(admin, { fullName: 'A1', email: 'a1@x.test', ownerUserId: a }).expect(201);
    await createLead(admin, { fullName: 'A2', email: 'a2@x.test', ownerUserId: a }).expect(201);
    await rule(admin, { name: 'LL', conditions: {}, strategy: 'LEAST_LOADED', targetTeamId: teamId }).expect(201);
    await importCsv('Name,Email\nNew,new@x.test\n');
    expect((await ownersByName()).New).toBe(b);
  });

  it('uses the first enabled matching rule in order, else the importer', async () => {
    const first = (await rule(admin, { name: 'Off', conditions: {}, strategy: 'USER', targetUserId: a }).expect(201)).body;
    await admin.patch(`/api/v1/assignment-rules/${first.id}`).set('Origin', ORIGIN).send({ enabled: false }).expect(200);
    await rule(admin, { name: 'Website only', conditions: { sourceTypes: ['WEBSITE'] }, strategy: 'USER', targetUserId: a }).expect(201);
    await rule(admin, { name: 'To B', conditions: { sourceTypes: ['CSV'] }, strategy: 'USER', targetUserId: b }).expect(201);
    await importCsv('Name,Email\nX,x@x.test\n');
    expect((await ownersByName()).X).toBe(b);

    await t.reset();
    admin = (await registerAdmin(t)).agent;
    const adminId = (await admin.get('/api/v1/auth/me').expect(200)).body.user.id;
    await importCsv('Name,Email\nY,y@x.test\n');
    expect((await ownersByName()).Y).toBe(adminId);
  });

  it('auto-assigns an existing lead on request', async () => {
    await rule(admin, { name: 'Manual to B', conditions: { sourceTypes: ['MANUAL'] }, strategy: 'USER', targetUserId: b }).expect(201);
    const lead = (await createLead(admin, { fullName: 'M', email: 'm@x.test', ownerUserId: null }).expect(201)).body;
    const res = await admin.post(`/api/v1/leads/${lead.id}/auto-assign`).set('Origin', ORIGIN).expect(200);
    expect(res.body.owner.id).toBe(b);

    const { agent } = await login(t, 'a@acme.test', 'agent strong password');
    await agent.post(`/api/v1/leads/${lead.id}/auto-assign`).set('Origin', ORIGIN).expect(403);
  });

  it('validates targets within the organization and requires settings.manage', async () => {
    const rival = await createOtherOrg(t, 'rival');
    const rivalUser = (await rival.get('/api/v1/users').expect(200)).body.items[0].id;
    expect((await rule(admin, { name: 'Bad', conditions: {}, strategy: 'USER', targetUserId: rivalUser }).expect(422)).body.error.code).toBe(
      'INVALID_TARGET',
    );
    await rule(admin, { name: 'No team', conditions: {}, strategy: 'ROUND_ROBIN' }).expect(422);
    await rule(rival, { name: 'Steal', conditions: {}, strategy: 'ROUND_ROBIN', targetTeamId: teamId }).expect(422);

    const { agent } = await login(t, 'a@acme.test', 'agent strong password');
    await rule(agent, { name: 'Nope', conditions: {}, strategy: 'USER', targetUserId: a }).expect(403);
  });
});
