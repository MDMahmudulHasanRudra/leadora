import { sql } from 'drizzle-orm';
import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createOtherOrg } from '../support/orgs';

describe('teams', () => {
  let t: TestApp;
  let admin: TestAgent;
  let agentUserId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await registerAdmin(t)).agent;
    const res = await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'karim@acme.test', fullName: 'Karim Ahmed', role: 'AGENT', password: 'agent strong password' })
      .expect(201);
    agentUserId = res.body.id;
  });
  afterAll(async () => t.close());

  const send = (as: TestAgent, method: 'post' | 'patch' | 'put' | 'delete', url: string, body?: object) =>
    as[method](`/api/v1${url}`).set('Origin', ORIGIN).send(body);
  const createTeam = (as: TestAgent, name = 'Dhaka Sales') => send(as, 'post', '/teams', { name, description: 'Inbound BD leads' });

  it('creates a team, adds a member and lists it with members', async () => {
    const { body: team } = await createTeam(admin).expect(201);
    expect(team).toMatchObject({ name: 'Dhaka Sales', description: 'Inbound BD leads', members: [] });

    await send(admin, 'put', `/teams/${team.id}/members/${agentUserId}`).expect(204);
    await send(admin, 'put', `/teams/${team.id}/members/${agentUserId}`).expect(204); // idempotent

    const { body } = await admin.get('/api/v1/teams').expect(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].members).toEqual([{ id: agentUserId, fullName: 'Karim Ahmed' }]);
  });

  it('lets agents view teams but not manage them', async () => {
    await createTeam(admin).expect(201);
    const { agent } = await login(t, 'karim@acme.test', 'agent strong password');
    await agent.get('/api/v1/teams').expect(200);
    await createTeam(agent, 'Rogue team').expect(403);
  });

  it('rejects a duplicate team name within the organization', async () => {
    await createTeam(admin).expect(201);
    const res = await createTeam(admin).expect(409);
    expect(res.body.error.code).toBe('TEAM_NAME_TAKEN');
  });

  it('renames a team and removes members', async () => {
    const { body: team } = await createTeam(admin).expect(201);
    await send(admin, 'put', `/teams/${team.id}/members/${agentUserId}`).expect(204);
    const renamed = await send(admin, 'patch', `/teams/${team.id}`, { name: 'Chattogram Sales' }).expect(200);
    expect(renamed.body.name).toBe('Chattogram Sales');

    await send(admin, 'delete', `/teams/${team.id}/members/${agentUserId}`).expect(204);
    const { body } = await admin.get('/api/v1/teams').expect(200);
    expect(body.items[0].members).toEqual([]);
  });

  it('deletes a team', async () => {
    const { body: team } = await createTeam(admin).expect(201);
    await send(admin, 'delete', `/teams/${team.id}`).expect(204);
    const { body } = await admin.get('/api/v1/teams').expect(200);
    expect(body.items).toEqual([]);
  });

  it('isolates teams and members across organizations', async () => {
    const { body: team } = await createTeam(admin).expect(201);
    const rival = await createOtherOrg(t, 'rival');

    expect((await rival.get('/api/v1/teams').expect(200)).body.items).toEqual([]);
    await send(rival, 'patch', `/teams/${team.id}`, { name: 'Hijacked' }).expect(404);
    await send(rival, 'delete', `/teams/${team.id}`).expect(404);

    const { body: rivalTeam } = await createTeam(rival).expect(201); // same name is fine in another org
    const res = await send(rival, 'put', `/teams/${rivalTeam.id}/members/${agentUserId}`).expect(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('audits team changes', async () => {
    const { body: team } = await createTeam(admin).expect(201);
    await send(admin, 'put', `/teams/${team.id}/members/${agentUserId}`).expect(204);
    await send(admin, 'delete', `/teams/${team.id}`).expect(204);
    const { rows } = await t.db.execute<{ action: string }>(
      sql`select action from audit_logs where resource_type = 'team' order by created_at`,
    );
    expect(rows.map((r) => r.action)).toEqual(['team.created', 'team.member_added', 'team.deleted']);
  });
});
