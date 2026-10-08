import { sql } from 'drizzle-orm';
import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead } from '../support/leads';
import { createOtherOrg } from '../support/orgs';

describe('lead conversion to contact and company', () => {
  let t: TestApp;
  let admin: TestAgent;
  const convert = (as: TestAgent, id: string, body: object = {}) => as.post(`/api/v1/leads/${id}/convert`).set('Origin', ORIGIN).send(body);

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await registerAdmin(t)).agent;
  });
  afterAll(async () => t.close());

  it('creates a contact and company, keeps the lead and marks it converted', async () => {
    const lead = (await createLead(admin, { fullName: 'Sadia Islam', email: 'sadia@rupali.test', phone: '01712-345678', companyName: 'Rupali Traders', jobTitle: 'Buyer' }).expect(201)).body;
    const res = await convert(admin, lead.id).expect(201);

    expect(res.body.contact).toMatchObject({ fullName: 'Sadia Islam', email: 'sadia@rupali.test', phone: '+8801712345678', jobTitle: 'Buyer' });
    expect(res.body.company).toMatchObject({ name: 'Rupali Traders' });
    expect(res.body.mergedContact).toBe(false);

    const after = (await admin.get(`/api/v1/leads/${lead.id}`).expect(200)).body;
    expect(after).toMatchObject({ stage: { outcome: 'WON' }, contactId: res.body.contact.id, companyId: res.body.company.id });
    expect(after.convertedAt).not.toBeNull();

    const { body } = await admin.get(`/api/v1/leads/${lead.id}/activities`).expect(200);
    expect(body.items[0]).toMatchObject({ type: 'lead.converted', payload: { contactId: res.body.contact.id, companyId: res.body.company.id } });
  });

  it('reuses an existing company regardless of case and spacing', async () => {
    const a = (await createLead(admin, { fullName: 'Sadia Islam', email: 'sadia@rupali.test', companyName: 'Rupali Traders' }).expect(201)).body;
    const first = (await convert(admin, a.id).expect(201)).body;

    const b = (await createLead(admin, { fullName: 'Karim Uddin', phone: '01911-000111', companyName: '  rupali TRADERS ' }).expect(201)).body;
    const second = (await convert(admin, b.id).expect(201)).body;
    expect(second.company.id).toBe(first.company.id);
    expect(second.mergedContact).toBe(false);

    const { body: company } = await admin.get(`/api/v1/companies/${first.company.id}`).expect(200);
    expect(company.contacts.map((x: { fullName: string }) => x.fullName).sort()).toEqual(['Karim Uddin', 'Sadia Islam']);
    expect((await admin.get('/api/v1/contacts?q=rupali').expect(200)).body.items).toHaveLength(2);
  });

  it('merges into a contact that already exists from another source, filling gaps only', async () => {
    // Lead-level dedupe stops a second lead for the same person, so a merge target comes from elsewhere
    // (e.g. a future contact import). Simulate that contact directly.
    const orgId = (await admin.get('/api/v1/auth/me').expect(200)).body.organization.id;
    await t.db.execute(
      sql`insert into contacts (organization_id, full_name, phone, job_title) values (${orgId}, 'Karim U.', '+8801911000111', 'Owner')`,
    );
    const lead = (await createLead(admin, { fullName: 'Karim Uddin', phone: '01911-000111', email: 'karim@x.test', jobTitle: 'Buyer' }).expect(201)).body;
    const res = (await convert(admin, lead.id).expect(201)).body;
    expect(res.mergedContact).toBe(true);
    expect(res.contact).toMatchObject({ fullName: 'Karim U.', email: 'karim@x.test', jobTitle: 'Owner' });
    expect((await admin.get('/api/v1/contacts').expect(200)).body.items).toHaveLength(1);
  });

  it('converts without a company when the lead has none', async () => {
    const lead = (await createLead(admin, { fullName: 'Solo Buyer', email: 'solo@x.test' }).expect(201)).body;
    const res = await convert(admin, lead.id).expect(201);
    expect(res.body.company).toBeNull();
    expect(res.body.contact.companyId).toBeNull();
  });

  it('refuses to convert twice, archived leads, other tenants and viewers', async () => {
    const lead = (await createLead(admin).expect(201)).body;
    await convert(admin, lead.id).expect(201);
    expect((await convert(admin, lead.id).expect(409)).body.error.code).toBe('LEAD_ALREADY_CONVERTED');

    const other = (await createLead(admin, { fullName: 'Other', email: 'other@x.test' }).expect(201)).body;
    const rival = await createOtherOrg(t, 'rival');
    await convert(rival, other.id).expect(404);

    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'v@acme.test', fullName: 'Viewer', role: 'VIEWER', password: 'viewer strong password' })
      .expect(201);
    const { agent: viewer } = await login(t, 'v@acme.test', 'viewer strong password');
    await convert(viewer, other.id).expect(403);

    await admin.delete(`/api/v1/leads/${other.id}`).set('Origin', ORIGIN).expect(204);
    expect((await convert(admin, other.id).expect(409)).body.error.code).toBe('LEAD_ARCHIVED');
    expect((await rival.get('/api/v1/contacts').expect(200)).body.items).toEqual([]);
  });
});
