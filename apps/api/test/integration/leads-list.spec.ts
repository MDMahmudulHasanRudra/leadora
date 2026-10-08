import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead, stageId } from '../support/leads';
import { createOtherOrg } from '../support/orgs';

describe('GET /api/v1/leads', () => {
  let t: TestApp;
  let admin: TestAgent;
  let agent: TestAgent;
  let agentId: string;

  const names = (body: { items: { fullName: string }[] }) => body.items.map((l) => l.fullName);

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await registerAdmin(t)).agent;
    agentId = (
      await admin
        .post('/api/v1/users')
        .set('Origin', ORIGIN)
        .send({ email: 'karim@acme.test', fullName: 'Karim Ahmed', role: 'AGENT', password: 'agent strong password' })
        .expect(201)
    ).body.id;
    agent = (await login(t, 'karim@acme.test', 'agent strong password')).agent;

    await createLead(admin, { fullName: 'Alpha Admin', email: 'alpha@x.test', companyName: 'Padma Foods', priority: 'HIGH', tags: ['VIP'] }).expect(201);
    await createLead(agent, { fullName: 'Bravo Agent', phone: '01811-111111' }).expect(201);
    await createLead(admin, { fullName: 'Charlie Unowned', email: 'charlie@x.test', ownerUserId: null }).expect(201);
    await createLead(admin, { fullName: 'Delta 100% Real', email: 'delta@x.test', stageId: await stageId(admin, 'QUALIFIED') }).expect(201);
    await createLead(agent, { fullName: 'Echo Agent', email: 'echo@x.test', tags: ['vip'] }).expect(201);
  });
  afterAll(async () => t.close());

  it('lists newest first', async () => {
    const { body } = await admin.get('/api/v1/leads').expect(200);
    expect(names(body)).toEqual(['Echo Agent', 'Delta 100% Real', 'Charlie Unowned', 'Bravo Agent', 'Alpha Admin']);
    expect(body.nextCursor).toBeNull();
  });

  it('paginates with a cursor without gaps or duplicates', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const { body }: { body: { items: { fullName: string }[]; nextCursor: string | null } } = await admin
        .get(`/api/v1/leads?limit=2${cursor ? `&cursor=${cursor}` : ''}`)
        .expect(200);
      seen.push(...names(body));
      cursor = body.nextCursor;
    } while (cursor && seen.length < 20);
    expect(seen).toEqual(['Echo Agent', 'Delta 100% Real', 'Charlie Unowned', 'Bravo Agent', 'Alpha Admin']);
  });

  it('filters by owner: me, unassigned or a user id', async () => {
    expect(names((await agent.get('/api/v1/leads?owner=me').expect(200)).body)).toEqual(['Echo Agent', 'Bravo Agent']);
    expect(names((await admin.get('/api/v1/leads?owner=unassigned').expect(200)).body)).toEqual(['Charlie Unowned']);
    expect(names((await admin.get(`/api/v1/leads?owner=${agentId}`).expect(200)).body)).toEqual(['Echo Agent', 'Bravo Agent']);
  });

  it('filters by stage, tag and priority', async () => {
    const qualified = await stageId(admin, 'QUALIFIED');
    expect(names((await admin.get(`/api/v1/leads?stageId=${qualified}`).expect(200)).body)).toEqual(['Delta 100% Real']);
    expect(names((await admin.get('/api/v1/leads?tag=VIP').expect(200)).body)).toEqual(['Echo Agent', 'Alpha Admin']);
    expect(names((await admin.get('/api/v1/leads?priority=HIGH').expect(200)).body)).toEqual(['Alpha Admin']);
  });

  it('searches name, email, phone and company case-insensitively', async () => {
    expect(names((await admin.get('/api/v1/leads?q=padma').expect(200)).body)).toEqual(['Alpha Admin']);
    expect(names((await admin.get('/api/v1/leads?q=CHARLIE@').expect(200)).body)).toEqual(['Charlie Unowned']);
    expect(names((await admin.get('/api/v1/leads?q=1811').expect(200)).body)).toEqual(['Bravo Agent']);
  });

  it('treats SQL wildcards in search literally', async () => {
    expect(names((await admin.get('/api/v1/leads?q=%25').expect(200)).body)).toEqual(['Delta 100% Real']);
    expect(names((await admin.get('/api/v1/leads?q=_').expect(200)).body)).toEqual([]);
  });

  it('rejects oversized limits and search strings', async () => {
    await admin.get('/api/v1/leads?limit=101').expect(422);
    await admin.get(`/api/v1/leads?q=${'a'.repeat(101)}`).expect(422);
    await admin.get('/api/v1/leads?owner=not-a-user').expect(422);
  });

  it('never shows another organization’s leads', async () => {
    const rival = await createOtherOrg(t, 'rival');
    expect((await rival.get('/api/v1/leads').expect(200)).body.items).toEqual([]);
  });
});
