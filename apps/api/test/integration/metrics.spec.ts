import request from 'supertest';
import { ENV } from '../../src/infra/tokens';
import { createTestApp, type TestApp } from '../support/app';
import { registerAdmin } from '../support/fixtures';

describe('metrics endpoint (spec §70)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => t.reset());
  afterAll(async () => t.close());

  it('exposes request, queue, database and AI metrics in Prometheus format', async () => {
    const { agent } = await registerAdmin(t);
    await agent.get('/api/v1/leads').expect(200);
    const res = await request(t.app.getHttpServer()).get('/metrics').expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    // Route labels are templates, never raw ids.
    expect(res.text).toMatch(/http_requests_total\{method="GET",route="\/api\/v1\/leads",service="api",status="2xx"\} \d+/);
    expect(res.text).toMatch(/http_request_duration_seconds_bucket\{le="0\.5",method="GET",route="\/api\/v1\/leads"/);
    expect(res.text).toMatch(/leadora_queue_jobs\{queue="imports",service="api",state="waiting"\} \d+/);
    expect(res.text).toMatch(/leadora_db_pool_connections\{service="api",state="total"\} \d+/);
    expect(res.text).toMatch(/leadora_failures_1h\{kind="automations",service="api"\} 0/);
  });

  it('requires the bearer token when METRICS_TOKEN is set', async () => {
    const env = t.app.get<{ METRICS_TOKEN: string }>(ENV);
    env.METRICS_TOKEN = 'metrics-secret-token';
    try {
      await request(t.app.getHttpServer()).get('/metrics').expect(401);
      await request(t.app.getHttpServer()).get('/metrics').set('Authorization', 'Bearer metrics-secret-token').expect(200);
    } finally {
      env.METRICS_TOKEN = '';
    }
  });
});
