import { sql } from 'drizzle-orm';
import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createOtherOrg, grant } from '../support/orgs';

const AGENT = { email: 'karim@acme.test', fullName: 'Karim Ahmed', role: 'AGENT', password: 'agent strong password' };

describe('users administration', () => {
  let t: TestApp;
  let admin: TestAgent;
  let adminId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    const r = await registerAdmin(t);
    admin = r.agent;
    adminId = r.user.id;
  });
  afterAll(async () => t.close());

  const createUser = (as: TestAgent, body: object) => as.post('/api/v1/users').set('Origin', ORIGIN).send(body);
  const patchUser = (as: TestAgent, id: string, body: object) =>
    as.patch(`/api/v1/users/${id}`).set('Origin', ORIGIN).send(body);

  it('lets an admin create a user who can then sign in', async () => {
    const res = await createUser(admin, AGENT).expect(201);
    expect(res.body).toMatchObject({ email: AGENT.email, fullName: AGENT.fullName, role: 'AGENT', status: 'ACTIVE' });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const { res: loginRes } = await login(t, AGENT.email, AGENT.password);
    expect(loginRes.status).toBe(200);
  });

  it('lists only users of the caller organization', async () => {
    await createUser(admin, AGENT).expect(201);
    await createOtherOrg(t, 'rival');
    const res = await admin.get('/api/v1/users').expect(200);
    expect(res.body.items.map((u: { email: string }) => u.email).sort()).toEqual([AGENT.email, 'rahim@acme.test']);
  });

  it('forbids agents from creating users', async () => {
    await createUser(admin, AGENT).expect(201);
    const { agent } = await login(t, AGENT.email, AGENT.password);
    const res = await createUser(agent, { ...AGENT, email: 'new@acme.test' }).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a duplicate email', async () => {
    await createUser(admin, AGENT).expect(201);
    const res = await createUser(admin, AGENT).expect(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects an unknown role', async () => {
    await createUser(admin, { ...AGENT, role: 'GOD' }).expect(422);
  });

  it('disabling a user ends their sessions and blocks sign-in', async () => {
    const { body: created } = await createUser(admin, AGENT).expect(201);
    const { agent } = await login(t, AGENT.email, AGENT.password);
    await agent.get('/api/v1/auth/me').expect(200);

    await patchUser(admin, created.id, { status: 'DISABLED' }).expect(200);

    await agent.get('/api/v1/auth/me').expect(401);
    const { res } = await login(t, AGENT.email, AGENT.password);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('changes a user role', async () => {
    const { body: created } = await createUser(admin, AGENT).expect(201);
    const res = await patchUser(admin, created.id, { role: 'MANAGER' }).expect(200);
    expect(res.body.role).toBe('MANAGER');
  });

  it('hides users of other organizations (404, not 403)', async () => {
    const rival = await createOtherOrg(t, 'rival');
    await patchUser(rival, adminId, { status: 'DISABLED' }).expect(404);
    await rival.get(`/api/v1/users/${adminId}`).expect(404);
  });

  it('prevents admins from changing their own role or status', async () => {
    const res = await patchUser(admin, adminId, { role: 'VIEWER' }).expect(422);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_SELF');
  });

  it('prevents granting a role with permissions the caller lacks', async () => {
    await grant(t, 'MANAGER', 'user.create');
    await createUser(admin, { ...AGENT, role: 'MANAGER' }).expect(201);
    const { agent: manager } = await login(t, AGENT.email, AGENT.password);

    const res = await createUser(manager, { ...AGENT, email: 'boss@acme.test', role: 'ADMIN' }).expect(403);
    expect(res.body.error.code).toBe('ROLE_ESCALATION');
    await createUser(manager, { ...AGENT, email: 'peer@acme.test', role: 'AGENT' }).expect(201);
  });

  it('audits user creation and updates without secrets', async () => {
    const { body: created } = await createUser(admin, AGENT).expect(201);
    await patchUser(admin, created.id, { fullName: 'Karim A.' }).expect(200);
    const { rows } = await t.db.execute<{ action: string; new_values: unknown; old_values: unknown }>(
      sql`select action, new_values, old_values from audit_logs where resource_id = ${created.id} order by created_at`,
    );
    expect(rows.map((r) => r.action)).toEqual(['user.created', 'user.updated']);
    expect(rows[1]).toMatchObject({ old_values: { fullName: 'Karim Ahmed' }, new_values: { fullName: 'Karim A.' } });
    expect(JSON.stringify(rows)).not.toMatch(/password/i);
  });
});
