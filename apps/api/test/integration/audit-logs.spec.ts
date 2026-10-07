import { sql } from 'drizzle-orm';
import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createOtherOrg } from '../support/orgs';

describe('GET /api/v1/audit-logs', () => {
  let t: TestApp;
  let admin: TestAgent;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await registerAdmin(t)).agent;
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      await admin.post('/api/v1/teams').set('Origin', ORIGIN).send({ name }).expect(201);
    }
  });
  afterAll(async () => t.close());

  it('returns newest first with the actor', async () => {
    const { body } = await admin.get('/api/v1/audit-logs').expect(200);
    expect(body.items.map((e: { action: string }) => e.action)).toEqual([
      'team.created',
      'team.created',
      'team.created',
      'auth.registered',
      'organization.created',
    ]);
    expect(body.items[0]).toMatchObject({ actor: { fullName: 'Rahim Uddin' }, resourceType: 'team', newValues: { name: 'Gamma' } });
    expect(body.nextCursor).toBeNull();
  });

  it('paginates with a cursor without gaps or duplicates', async () => {
    const page1 = (await admin.get('/api/v1/audit-logs?limit=2').expect(200)).body;
    expect(page1.items).toHaveLength(2);
    const page2 = (await admin.get(`/api/v1/audit-logs?limit=2&cursor=${page1.nextCursor}`).expect(200)).body;
    const page3 = (await admin.get(`/api/v1/audit-logs?limit=2&cursor=${page2.nextCursor}`).expect(200)).body;
    const ids = [...page1.items, ...page2.items, ...page3.items].map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(5);
    expect(page3.nextCursor).toBeNull();
  });

  it('does not skip rows written within the same millisecond', async () => {
    await t.db.execute(sql`
      insert into audit_logs (organization_id, action, resource_type, created_at)
      select organization_id, 'test.burst', 'test', ts
      from (select organization_id from audit_logs limit 1) o,
           unnest(array['2026-01-01 00:00:00.000100+00', '2026-01-01 00:00:00.000200+00', '2026-01-01 00:00:00.000300+00']::timestamptz[]) ts`);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/api/v1/audit-logs?resourceType=test&limit=1${cursor ? `&cursor=${cursor}` : ''}`;
      const { body } = await admin.get(url).expect(200);
      seen.push(...body.items.map((e: { id: string }) => e.id));
      cursor = body.nextCursor;
    } while (cursor && seen.length < 10);
    expect(new Set(seen).size).toBe(3);
  });

  it('filters by resource type', async () => {
    const { body } = await admin.get('/api/v1/audit-logs?resourceType=team').expect(200);
    expect(body.items).toHaveLength(3);
  });

  it('rejects a tampered cursor', async () => {
    await admin.get('/api/v1/audit-logs?cursor=not-a-cursor').expect(422);
  });

  it('is restricted to audit.view and scoped to the organization', async () => {
    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'mgr@acme.test', fullName: 'Manager', role: 'MANAGER', password: 'manager strong password' })
      .expect(201);
    const { agent: manager } = await login(t, 'mgr@acme.test', 'manager strong password');
    await manager.get('/api/v1/audit-logs').expect(403);

    const rival = await createOtherOrg(t, 'rival');
    const { body } = await rival.get('/api/v1/audit-logs').expect(200);
    expect(body.items.every((e: { action: string }) => e.action === 'auth.login')).toBe(true);
  });
});
