import { createTestApp, type TestApp } from '../support/app';
import { registerAdmin } from '../support/fixtures';
import { createOtherOrg } from '../support/orgs';

describe('organization defaults: pipeline and lead sources', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => t.reset());
  afterAll(async () => t.close());

  it('gives a new organization the default sales pipeline', async () => {
    const { agent } = await registerAdmin(t);
    const { body } = await agent.get('/api/v1/pipelines').expect(200);

    expect(body.items).toHaveLength(1);
    const pipeline = body.items[0];
    expect(pipeline).toMatchObject({ name: 'Sales pipeline', isDefault: true });
    expect(pipeline.stages.map((s: { key: string }) => s.key)).toEqual([
      'NEW',
      'CONTACTED',
      'QUALIFIED',
      'INTERESTED',
      'NEGOTIATION',
      'FOLLOW_UP',
      'CONVERTED',
      'LOST',
    ]);
    expect(pipeline.stages.find((s: { key: string }) => s.key === 'CONVERTED')).toMatchObject({ outcome: 'WON', probability: 100 });
    expect(pipeline.stages.find((s: { key: string }) => s.key === 'LOST')).toMatchObject({ outcome: 'LOST', probability: 0 });
    expect(pipeline.stages.find((s: { key: string }) => s.key === 'NEW')).toMatchObject({ outcome: 'OPEN' });
  });

  it('gives a new organization default lead sources', async () => {
    const { agent } = await registerAdmin(t);
    const { body } = await agent.get('/api/v1/lead-sources').expect(200);
    expect(body.items.map((s: { type: string }) => s.type).sort()).toEqual(['API', 'CSV', 'MANUAL', 'WEBSITE']);
    expect(body.items.every((s: { enabled: boolean }) => s.enabled)).toBe(true);
  });

  it('keeps each organization on its own pipeline', async () => {
    const { agent } = await registerAdmin(t);
    const rival = await createOtherOrg(t, 'rival');
    const mine = (await agent.get('/api/v1/pipelines').expect(200)).body.items[0];
    const theirs = (await rival.get('/api/v1/pipelines').expect(200)).body.items[0];
    expect(theirs.id).not.toBe(mine.id);
    expect(theirs.stages[0].id).not.toBe(mine.stages[0].id);
  });
});
