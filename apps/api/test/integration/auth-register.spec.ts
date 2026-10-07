import { sql } from 'drizzle-orm';
import request from 'supertest';
import { createTestApp, type TestApp } from '../support/app';

const ORIGIN = 'http://localhost:8080';
const owner = {
  organizationName: 'Acme Sales BD',
  fullName: 'Rahim Uddin',
  email: 'Rahim@Acme.test',
  password: 'correct horse battery',
};

describe('POST /api/v1/auth/register (first-run setup)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => t.reset());
  afterAll(async () => t.close());

  const register = (body: object) =>
    request(t.app.getHttpServer()).post('/api/v1/auth/register').set('Origin', ORIGIN).send(body);

  it('creates the organization and an admin, and starts a session', async () => {
    const res = await register(owner).expect(201);

    expect(res.body.user).toMatchObject({ email: 'rahim@acme.test', fullName: 'Rahim Uddin', role: 'ADMIN' });
    expect(res.body.organization).toMatchObject({ name: 'Acme Sales BD', slug: 'acme-sales-bd' });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/leadora_session=[^;]{40,}/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('stores an Argon2id hash, never the plaintext password', async () => {
    await register(owner).expect(201);
    const { rows } = await t.db.execute<{ password_hash: string }>(sql`select password_hash from users`);
    expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
  });

  it('refuses a second registration once an organization exists', async () => {
    await register(owner).expect(201);
    const res = await register({ ...owner, email: 'intruder@evil.test' }).expect(403);
    expect(res.body.error.code).toBe('SIGNUP_DISABLED');
  });

  it('rejects weak or malformed input with field details', async () => {
    const res = await register({ ...owner, email: 'not-an-email', password: 'short' }).expect(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    const fields = res.body.error.details.map((d: { path: string }) => d.path);
    expect(fields).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('uses the provided timezone for the new organization', async () => {
    const res = await register({ ...owner, timezone: 'Asia/Dhaka' }).expect(201);
    expect(res.body.user.timezone).toBe('Asia/Dhaka');
  });

  it('rejects an unknown timezone', async () => {
    const res = await register({ ...owner, timezone: 'Mars/Olympus' }).expect(422);
    expect(res.body.error.details[0].path).toBe('timezone');
  });

  it('rejects passwords longer than 128 characters', async () => {
    await register({ ...owner, password: 'x'.repeat(129) }).expect(422);
  });

  it('reports whether first-run setup is still available', async () => {
    const before = await request(t.app.getHttpServer()).get('/api/v1/auth/setup-status').expect(200);
    expect(before.body).toEqual({ setupRequired: true, signupOpen: true });
    await register(owner).expect(201);
    const after = await request(t.app.getHttpServer()).get('/api/v1/auth/setup-status').expect(200);
    expect(after.body).toEqual({ setupRequired: false, signupOpen: false });
  });

  it('records the registration in the audit log', async () => {
    await register(owner).expect(201);
    const { rows } = await t.db.execute<{ action: string }>(sql`select action from audit_logs order by action`);
    expect(rows.map((r) => r.action)).toEqual(['auth.registered', 'organization.created']);
  });
});
