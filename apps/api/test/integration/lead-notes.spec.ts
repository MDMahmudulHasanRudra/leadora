import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead } from '../support/leads';
import { createOtherOrg } from '../support/orgs';

describe('notes on leads', () => {
  let t: TestApp;
  let admin: TestAgent;
  let lead: { id: string };
  const note = (as: TestAgent, id: string, body: unknown) => as.post(`/api/v1/leads/${id}/notes`).set('Origin', ORIGIN).send({ body });

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await registerAdmin(t)).agent;
    lead = (await createLead(admin).expect(201)).body;
  });
  afterAll(async () => t.close());

  it('adds a note to the timeline', async () => {
    await note(admin, lead.id, '  Called — wants a demo next week.  ').expect(201);
    const { body } = await admin.get(`/api/v1/leads/${lead.id}/activities`).expect(200);
    expect(body.items[0]).toMatchObject({ type: 'note.added', payload: { body: 'Called — wants a demo next week.' } });
  });

  it('rejects empty and oversized notes', async () => {
    await note(admin, lead.id, '   ').expect(422);
    await note(admin, lead.id, 'x'.repeat(5001)).expect(422);
  });

  it('requires lead.update, refuses archived leads and hides other tenants', async () => {
    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'v@acme.test', fullName: 'Viewer', role: 'VIEWER', password: 'viewer strong password' })
      .expect(201);
    const { agent: viewer } = await login(t, 'v@acme.test', 'viewer strong password');
    await note(viewer, lead.id, 'hi').expect(403);

    const rival = await createOtherOrg(t, 'rival');
    await note(rival, lead.id, 'hi').expect(404);

    await admin.delete(`/api/v1/leads/${lead.id}`).set('Origin', ORIGIN).expect(204);
    expect((await note(admin, lead.id, 'hi').expect(409)).body.error.code).toBe('LEAD_ARCHIVED');
  });
});
