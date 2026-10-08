import { sql } from 'drizzle-orm';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { CAPTCHA_VERIFIER } from '../../src/infra/tokens';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead } from '../support/leads';

const SITE = 'https://shop.example';

describe('public lead form (spec §91)', () => {
  let t: TestApp;
  let admin: TestAgent;
  const captchaCalls: { provider: string; token: string }[] = [];

  const createForm = (body: object = {}) =>
    admin
      .post('/api/v1/lead-forms')
      .set('Origin', ORIGIN)
      .send({
        name: 'Website contact',
        allowedOrigins: [SITE],
        fields: { email: 'required', phone: 'optional', companyName: 'optional', message: 'optional' },
        successMessage: 'Thanks! We will call you soon.',
        tags: ['web-form'],
        ...body,
      });
  let ip = 1;
  const submit = (key: string, body: object, origin: string | null = SITE) => {
    const r = request(t.app.getHttpServer()).post(`/api/v1/public/forms/${key}/submissions`).set('X-Forwarded-For', `203.0.113.${ip}`);
    return (origin ? r.set('Origin', origin) : r).send(body);
  };

  beforeAll(async () => {
    t = await createTestApp([
      {
        token: CAPTCHA_VERIFIER,
        value: async (provider: string, _secret: string, token: string) => {
          captchaCalls.push({ provider, token });
          return token === 'good-token';
        },
      },
    ]);
  });
  beforeEach(async () => {
    await t.reset();
    captchaCalls.length = 0;
    ip++;
    admin = (await registerAdmin(t)).agent;
  });
  afterAll(async () => t.close());

  it('publishes a form config, answers CORS preflight, and turns a submission into an attributed website lead', async () => {
    const { body: form } = await createForm().expect(201);
    expect(form.publicKey).toMatch(/^lf_[A-Za-z0-9_-]{20,}$/);
    expect(form.embedCode).toContain(`data-form-key="${form.publicKey}"`);

    const { body: config } = await request(t.app.getHttpServer()).get(`/api/v1/public/forms/${form.publicKey}`).expect(200);
    expect(config).toEqual({
      title: null,
      fields: { email: 'required', phone: 'optional', companyName: 'optional', message: 'optional' },
      captcha: null,
    });

    const pre = await request(t.app.getHttpServer())
      .options(`/api/v1/public/forms/${form.publicKey}/submissions`)
      .set('Origin', SITE)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);
    expect(pre.headers['access-control-allow-origin']).toBe(SITE);
    expect(pre.headers['access-control-allow-credentials']).toBeUndefined();

    const res = await submit(form.publicKey, {
      fullName: 'Nadia Karim',
      email: 'nadia@customer.example',
      message: 'I need 300 units, what is the price?',
      pageUrl: 'https://shop.example/pricing',
      utm: { source: 'facebook', campaign: 'eid-sale' },
    }).expect(200);
    expect(res.body).toEqual({ ok: true, message: 'Thanks! We will call you soon.' });
    expect(res.headers['access-control-allow-origin']).toBe(SITE);

    const { body: leads } = await admin.get('/api/v1/leads').expect(200);
    expect(leads.items[0]).toMatchObject({ fullName: 'Nadia Karim', email: 'nadia@customer.example', source: { type: 'WEBSITE' }, tags: ['web-form'], notes: 'I need 300 units, what is the price?' });
    const { rows } = await t.db.execute<{ metadata: Record<string, unknown> }>(sql`select metadata from leads`);
    expect(rows[0]!.metadata).toMatchObject({ formId: form.id, pageUrl: 'https://shop.example/pricing', utm: { source: 'facebook', campaign: 'eid-sale' } });
    expect((await admin.get('/api/v1/lead-forms').expect(200)).body.items[0].submissionCount).toBe(1);
  });

  it('rejects other origins and invalid input, silently drops bots, and merges repeat visitors', async () => {
    const { body: form } = await createForm().expect(201);
    expect((await submit(form.publicKey, { fullName: 'X', email: 'x@y.example' }, 'https://evil.example').expect(403)).body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect((await submit(form.publicKey, { fullName: 'No email' }).expect(422)).body.error.code).toBe('VALIDATION_FAILED');
    await submit('lf_doesnotexist000000000', { fullName: 'X', email: 'x@y.example' }).expect(404);

    // Honeypot filled: looks like success to the bot, but no lead is created.
    expect((await submit(form.publicKey, { fullName: 'Bot', email: 'bot@spam.example', website: 'http://spam' }).expect(200)).body.ok).toBe(true);
    expect((await admin.get('/api/v1/leads').expect(200)).body.items).toEqual([]);

    const existing = (await createLead(admin, { fullName: 'Known', email: 'known@customer.example' }).expect(201)).body;
    await submit(form.publicKey, { fullName: 'Known Again', email: 'Known@Customer.example', message: 'Following up' }).expect(200);
    expect((await admin.get('/api/v1/leads').expect(200)).body.items).toHaveLength(1);
    const { body: acts } = await admin.get(`/api/v1/leads/${existing.id}/activities`).expect(200);
    expect(acts.items[0]).toMatchObject({ type: 'lead.form_submitted', payload: { formId: form.id, message: 'Following up' } });
  });

  it('rate-limits each visitor per form', async () => {
    const { body: form } = await createForm({ allowedOrigins: [] }).expect(201);
    for (let i = 0; i < 10; i++) await submit(form.publicKey, { fullName: `Visitor ${i}`, email: `v${i}@x.example` }, null).expect(200);
    expect((await submit(form.publicKey, { fullName: 'One too many', email: 'more@x.example' }, null).expect(429)).body.error.code).toBe('RATE_LIMITED');
  });

  it('verifies CAPTCHA tokens when the form requires one', async () => {
    const { body: form } = await createForm({ captcha: { provider: 'TURNSTILE', siteKey: '0x4AAA-site', secret: 'turnstile-secret-value' } }).expect(201);
    expect(JSON.stringify(form)).not.toContain('turnstile-secret-value');
    expect((await request(t.app.getHttpServer()).get(`/api/v1/public/forms/${form.publicKey}`).expect(200)).body.captcha).toEqual({ provider: 'TURNSTILE', siteKey: '0x4AAA-site' });

    expect((await submit(form.publicKey, { fullName: 'A', email: 'a@x.example' }).expect(422)).body.error.code).toBe('CAPTCHA_FAILED');
    expect((await submit(form.publicKey, { fullName: 'A', email: 'a@x.example', captchaToken: 'bad-token' }).expect(422)).body.error.code).toBe('CAPTCHA_FAILED');
    await submit(form.publicKey, { fullName: 'A', email: 'a@x.example', captchaToken: 'good-token' }).expect(200);
    expect(captchaCalls.map((c) => c.token)).toEqual(['bad-token', 'good-token']);
  });

  it('switches off disabled forms and restricts management', async () => {
    const { body: form } = await createForm().expect(201);
    await admin.patch(`/api/v1/lead-forms/${form.id}`).set('Origin', ORIGIN).send({ enabled: false }).expect(200);
    await submit(form.publicKey, { fullName: 'Late', email: 'late@x.example' }).expect(404);
    await createForm({ allowedOrigins: ['not a url'] }).expect(422);

    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'a@acme.test', fullName: 'Agent', role: 'AGENT', password: 'agent strong password' })
      .expect(201);
    const { agent } = await login(t, 'a@acme.test', 'agent strong password');
    await agent.get('/api/v1/lead-forms').expect(403);
  });
});
