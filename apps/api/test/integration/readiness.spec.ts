import { sql } from 'drizzle-orm';
import request from 'supertest';
import { createTestApp, type TestApp } from '../support/app';

describe('integration harness', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('reports ready immediately after boot against real Postgres and Valkey', async () => {
    const res = await request(t.app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body.checks).toMatchObject({ postgres: { status: 'up' }, valkey: { status: 'up' } });
  });

  it('runs against the migrated test database', async () => {
    await t.reset();
    const res = await t.db.execute<{ n: number }>(sql`select count(*)::int as n from organizations`);
    expect(res.rows[0]?.n).toBe(0);
  });
});
