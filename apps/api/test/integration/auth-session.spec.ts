import { sql } from 'drizzle-orm';
import request from 'supertest';
import { createTestApp, type TestApp } from '../support/app';
import { ADMIN, login, ORIGIN, registerAdmin } from '../support/fixtures';

describe('sessions: login, me, logout', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    await registerAdmin(t);
  });
  afterAll(async () => t.close());

  it('logs in with correct credentials and exposes the identity at /me', async () => {
    const { agent, res } = await login(t, 'RAHIM@acme.test', ADMIN.password);
    expect(res.status).toBe(200);
    expect(String(res.headers['set-cookie'])).toMatch(/leadora_session=.+HttpOnly/i);

    const me = await agent.get('/api/v1/auth/me').expect(200);
    expect(me.body.user).toMatchObject({ email: ADMIN.email, role: 'ADMIN' });
    expect(me.body.organization).toMatchObject({ slug: 'acme-sales-bd' });
    expect(me.body.permissions).toEqual(expect.arrayContaining(['user.create', 'lead.assign']));
  });

  it('exposes the effective timezone: the user override, else the organization default', async () => {
    const { agent } = await login(t, ADMIN.email, ADMIN.password);
    expect((await agent.get('/api/v1/auth/me').expect(200)).body.user.timezone).toBe('UTC');

    await t.db.execute(sql`update organizations set timezone = 'Asia/Dhaka'`);
    expect((await agent.get('/api/v1/auth/me').expect(200)).body.user.timezone).toBe('Asia/Dhaka');

    await t.db.execute(sql`update users set timezone = 'Europe/London'`);
    expect((await agent.get('/api/v1/auth/me').expect(200)).body.user.timezone).toBe('Europe/London');
  });

  it('gives the same answer for an unknown email and a wrong password', async () => {
    const wrong = (await login(t, ADMIN.email, 'not the password!!')).res;
    const unknown = (await login(t, 'nobody@acme.test', 'not the password!!')).res;
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('protects routes by default', async () => {
    const res = await request(t.app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('keeps health endpoints public', async () => {
    await request(t.app.getHttpServer()).get('/health/live').expect(200);
  });

  it('revokes the session on logout', async () => {
    const { agent } = await login(t, ADMIN.email, ADMIN.password);
    await agent.post('/api/v1/auth/logout').set('Origin', ORIGIN).expect(204);
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('rejects an expired session', async () => {
    const { agent } = await login(t, ADMIN.email, ADMIN.password);
    await t.db.execute(sql`update sessions set expires_at = now() - interval '1 minute'`);
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('locks out an email+IP after 10 failed attempts, even with the right password', async () => {
    for (let i = 0; i < 10; i++) expect((await login(t, ADMIN.email, 'wrong password!!')).res.status).toBe(401);
    const { res } = await login(t, ADMIN.email, ADMIN.password);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('rejects state-changing requests from a foreign Origin', async () => {
    const res = await request(t.app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: ADMIN.email, password: ADMIN.password })
      .expect(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('records successful logins in the audit log', async () => {
    await login(t, ADMIN.email, ADMIN.password);
    const { rows } = await t.db.execute<{ n: number }>(
      sql`select count(*)::int as n from audit_logs where action = 'auth.login'`,
    );
    expect(rows[0]?.n).toBe(1);
  });
});
