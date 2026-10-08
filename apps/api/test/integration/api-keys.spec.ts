import { sql } from 'drizzle-orm';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { ENV } from '../../src/infra/tokens';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead } from '../support/leads';

describe('API keys (spec §92)', () => {
  let t: TestApp;
  let admin: TestAgent;

  const createKey = (as: TestAgent, body: object) => as.post('/api/v1/api-keys').set('Origin', ORIGIN).send(body);
  const withKey = (key: string) => ({
    get: (path: string) => request(t.app.getHttpServer()).get(`/api/v1${path}`).set('Authorization', `Bearer ${key}`),
    post: (path: string, body: object) => request(t.app.getHttpServer()).post(`/api/v1${path}`).set('Authorization', `Bearer ${key}`).send(body),
  });

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await registerAdmin(t)).agent;
  });
  afterAll(async () => t.close());

  it('shows the key once, stores only a hash, and acts within its scopes', async () => {
    const { body: created } = await createKey(admin, { name: 'Website sync', scopes: ['leads:read', 'leads:write'] }).expect(201);
    expect(created.key).toMatch(/^lk_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
    const { body: list } = await admin.get('/api/v1/api-keys').expect(200);
    expect(list.items[0]).toMatchObject({ name: 'Website sync', prefix: created.key.slice(0, 15), scopes: ['leads:read', 'leads:write'], lastUsedAt: null });
    expect(JSON.stringify(list)).not.toContain(created.key.slice(16));
    const { rows } = await t.db.execute<{ secret_hash: string }>(sql`select secret_hash from api_keys`);
    expect(rows[0]!.secret_hash).not.toContain(created.key.slice(16));

    const api = withKey(created.key);
    await createLead(admin).expect(201);
    expect((await api.get('/leads').expect(200)).body.items).toHaveLength(1);
    const lead = (await api.post('/leads', { fullName: 'From the API', email: 'api@shop.test' }).expect(201)).body;
    // Writes are attributed to the key's creator.
    const { body: acts } = await admin.get(`/api/v1/leads/${lead.id}/activities`).expect(200);
    expect(acts.items[0].actor.fullName).toBeTruthy();

    // Outside its scopes, and on routes that don't declare a permission, a key gets nothing.
    await api.get('/users').expect(403);
    await api.get('/conversations').expect(403);
    await api.get('/auth/me').expect(403);
    await api.get('/notifications').expect(403);
    expect((await admin.get('/api/v1/api-keys').expect(200)).body.items[0].lastUsedAt).not.toBeNull();
    const { body: audit } = await admin.get('/api/v1/audit-logs').expect(200);
    expect(audit.items.map((a: { action: string }) => a.action)).toContain('api_key.created');
  });

  it('rejects unknown, malformed, revoked, expired and orphaned keys', async () => {
    await withKey('lk_nope').get('/leads').expect(401);
    await withKey('lk_aaaaaaaaaaaa_' + 'x'.repeat(43)).get('/leads').expect(401);

    const { body: k1 } = await createKey(admin, { name: 'Revoked', scopes: ['leads:read'] }).expect(201);
    const tampered = k1.key.slice(0, -1) + (k1.key.endsWith('A') ? 'B' : 'A');
    await withKey(tampered).get('/leads').expect(401);
    await admin.delete(`/api/v1/api-keys/${k1.id}`).set('Origin', ORIGIN).expect(204);
    await withKey(k1.key).get('/leads').expect(401);

    const { body: k2 } = await createKey(admin, { name: 'Short', scopes: ['leads:read'], expiresAt: new Date(Date.now() + 60_000).toISOString() }).expect(201);
    await withKey(k2.key).get('/leads').expect(200);
    await t.db.execute(sql`update api_keys set expires_at = now() - interval '1 minute' where id = ${k2.id}`);
    await withKey(k2.key).get('/leads').expect(401);

    // A key acts as its creator, so it stops working when the creator is disabled.
    const { body: other } = await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'm@acme.test', fullName: 'Manager', role: 'MANAGER', password: 'manager strong password' })
      .expect(201);
    const { body: k3 } = await createKey(admin, { name: 'Theirs', scopes: ['leads:read'] }).expect(201);
    await t.db.execute(sql`update api_keys set created_by_user_id = ${other.id} where id = ${k3.id}`);
    await withKey(k3.key).get('/leads').expect(200);
    await admin.patch(`/api/v1/users/${other.id}`).set('Origin', ORIGIN).send({ status: 'DISABLED' }).expect(200);
    await withKey(k3.key).get('/leads').expect(401);
  });

  it('validates scopes and restricts key management to settings.manage', async () => {
    expect((await createKey(admin, { name: 'Bad', scopes: ['everything'] }).expect(422)).body.error.code).toBe('VALIDATION_FAILED');
    await createKey(admin, { name: 'Past', scopes: ['leads:read'], expiresAt: new Date(Date.now() - 1000).toISOString() }).expect(422);
    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'a@acme.test', fullName: 'Agent', role: 'AGENT', password: 'agent strong password' })
      .expect(201);
    const { agent } = await login(t, 'a@acme.test', 'agent strong password');
    await createKey(agent, { name: 'Mine', scopes: ['leads:read'] }).expect(403);
  });

  it('rate-limits each key', async () => {
    const env = t.app.get<{ API_KEY_RATE_LIMIT_PER_MIN: number }>(ENV);
    const before = env.API_KEY_RATE_LIMIT_PER_MIN;
    env.API_KEY_RATE_LIMIT_PER_MIN = 3;
    try {
      const { body: k } = await createKey(admin, { name: 'Busy', scopes: ['leads:read'] }).expect(201);
      for (let i = 0; i < 3; i++) await withKey(k.key).get('/leads').expect(200);
      expect((await withKey(k.key).get('/leads').expect(429)).body.error.code).toBe('RATE_LIMITED');
    } finally {
      env.API_KEY_RATE_LIMIT_PER_MIN = before;
    }
  });
});
