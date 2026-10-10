import type TestAgent from 'supertest/lib/agent';
import { ENV } from '../../src/infra/tokens';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead } from '../support/leads';

describe('rate limits per category (spec §69)', () => {
  let t: TestApp;
  let admin: TestAgent;
  let env: { RATE_LIMIT_API_PER_MIN: number; RATE_LIMIT_AI_PER_MIN: number };
  let saved: { api: number; ai: number };

  beforeAll(async () => {
    t = await createTestApp();
    env = t.app.get(ENV);
    saved = { api: env.RATE_LIMIT_API_PER_MIN, ai: env.RATE_LIMIT_AI_PER_MIN };
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await registerAdmin(t)).agent;
  });
  afterEach(() => {
    env.RATE_LIMIT_API_PER_MIN = saved.api;
    env.RATE_LIMIT_AI_PER_MIN = saved.ai;
  });
  afterAll(async () => t.close());

  it('limits AI calls more tightly than normal API use, per user', async () => {
    const lead = (await createLead(admin).expect(201)).body;
    env.RATE_LIMIT_AI_PER_MIN = 2;
    // AI is off in this org, so allowed calls answer 409; the third is refused before any work.
    await admin.post(`/api/v1/ai/leads/${lead.id}/analyze`).set('Origin', ORIGIN).expect(409);
    await admin.post(`/api/v1/ai/leads/${lead.id}/analyze`).set('Origin', ORIGIN).expect(409);
    expect((await admin.post(`/api/v1/ai/leads/${lead.id}/analyze`).set('Origin', ORIGIN).expect(429)).body.error.code).toBe('RATE_LIMITED');
    // Normal API use is unaffected.
    await admin.get('/api/v1/leads').expect(200);

    // Another user has their own allowance.
    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'm@acme.test', fullName: 'Manager', role: 'MANAGER', password: 'manager strong password' })
      .expect(201);
    const { agent: manager } = await login(t, 'm@acme.test', 'manager strong password');
    await manager.post(`/api/v1/ai/leads/${lead.id}/analyze`).set('Origin', ORIGIN).expect(409);
  });

  it('limits normal API traffic per user', async () => {
    env.RATE_LIMIT_API_PER_MIN = 3;
    for (let i = 0; i < 3; i++) await admin.get('/api/v1/leads').expect(200);
    await admin.get('/api/v1/leads').expect(429);
  });
});
