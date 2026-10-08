import { processLeadImport } from '@leadora/domain';
import { Queue } from 'bullmq';
import type TestAgent from 'supertest/lib/agent';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead } from '../support/leads';
import { createOtherOrg } from '../support/orgs';
import { testEnv } from '../support/test-env';

const CSV = [
  'Name,E-mail,Mobile,Company,Tags',
  'Sadia Islam,sadia@x.test,01712-345678,Rupali,"VIP, Dhaka"',
  'Karim Uddin,karim@x.test,,Padma,',
  'Existing Person,existing@x.test,,,',
  'Bad Email,not-an-email,,,',
  'Bad Phone,,123,,',
  ',noname@x.test,,,',
  'Sadia Dup,SADIA@x.test,,,',
  '"=HYPERLINK(""http://evil"")",bad@,,,',
].join('\n');

const MAPPING = { fullName: 'Name', email: 'E-mail', phone: 'Mobile', companyName: 'Company', tags: 'Tags' };

describe('lead CSV import', () => {
  let t: TestApp;
  let admin: TestAgent;
  let queue: Queue;

  const upload = (as: TestAgent, content: string | Buffer, name = 'leads.csv') =>
    as.post('/api/v1/lead-imports').set('Origin', ORIGIN).attach('file', Buffer.from(content), name);
  const start = (as: TestAgent, id: string, body: object) =>
    as.post(`/api/v1/lead-imports/${id}/start`).set('Origin', ORIGIN).send(body);

  beforeAll(async () => {
    t = await createTestApp();
    queue = new Queue('imports', { connection: { url: testEnv().valkeyUrl } });
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await registerAdmin(t)).agent;
  });
  afterAll(async () => {
    await queue.close();
    await t.close();
  });

  it('reads headers, counts rows and suggests a column mapping', async () => {
    const { body } = await upload(admin, CSV).expect(201);
    expect(body).toMatchObject({
      fileName: 'leads.csv',
      status: 'UPLOADED',
      headers: ['Name', 'E-mail', 'Mobile', 'Company', 'Tags'],
      rowCount: 8,
      suggestedMapping: MAPPING,
    });
    expect(body.sample[0]).toEqual(['Sadia Islam', 'sadia@x.test', '01712-345678', 'Rupali', 'VIP, Dhaka']);
  });

  it('requires a name column and an email or phone column', async () => {
    const { body } = await upload(admin, CSV).expect(201);
    expect((await start(admin, body.id, { mapping: { email: 'E-mail' } }).expect(422)).body.error.code).toBe('VALIDATION_FAILED');
    expect((await start(admin, body.id, { mapping: { fullName: 'Name' } }).expect(422)).body.error.code).toBe('VALIDATION_FAILED');
    const unknown = await start(admin, body.id, { mapping: { fullName: 'Nope', email: 'E-mail' } }).expect(422);
    expect(unknown.body.error.code).toBe('UNKNOWN_COLUMN');
  });

  it('queues the import once', async () => {
    const { body } = await upload(admin, CSV).expect(201);
    const res = await start(admin, body.id, { mapping: MAPPING }).expect(202);
    expect(res.body.status).toBe('QUEUED');
    expect(await queue.getJob(body.id)).toBeTruthy();
    expect((await start(admin, body.id, { mapping: MAPPING }).expect(409)).body.error.code).toBe('IMPORT_ALREADY_STARTED');
  });

  it('imports valid rows and reports duplicates and invalid rows by line number', async () => {
    const existing = (await createLead(admin, { fullName: 'Existing', email: 'existing@x.test' }).expect(201)).body;
    const { body: imp } = await upload(admin, CSV).expect(201);
    await start(admin, imp.id, { mapping: MAPPING }).expect(202);

    await processLeadImport(t.db, imp.id);

    const { body: report } = await admin.get(`/api/v1/lead-imports/${imp.id}`).expect(200);
    expect(report).toMatchObject({ status: 'COMPLETED', rowCount: 8, processedRows: 8, imported: 2, duplicates: 2, invalid: 4, failed: 0 });
    expect(report.errors).toEqual([
      expect.objectContaining({ row: 4, code: 'LEAD_DUPLICATE', existingLeadId: existing.id }),
      expect.objectContaining({ row: 5, code: 'VALIDATION_FAILED', field: 'email' }),
      expect.objectContaining({ row: 6, code: 'VALIDATION_FAILED', field: 'phone' }),
      expect.objectContaining({ row: 7, code: 'VALIDATION_FAILED', field: 'fullName' }),
      expect.objectContaining({ row: 8, code: 'LEAD_DUPLICATE' }),
      expect.objectContaining({ row: 9, code: 'VALIDATION_FAILED', field: 'email' }),
    ]);

    const { body: leads } = await admin.get('/api/v1/leads?q=x.test').expect(200);
    const sadia = leads.items.find((l: { fullName: string }) => l.fullName === 'Sadia Islam');
    expect(sadia).toMatchObject({ phone: '+8801712345678', companyName: 'Rupali', tags: ['Dhaka', 'VIP'], source: { type: 'CSV' } });
  });

  it('assigns imported leads to the chosen owner', async () => {
    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'karim@acme.test', fullName: 'Karim Ahmed', role: 'AGENT', password: 'agent strong password' })
      .expect(201);
    const agentId = (await admin.get('/api/v1/users').expect(200)).body.items.find((u: { email: string }) => u.email === 'karim@acme.test').id;
    const { body: imp } = await upload(admin, 'Name,Email\nOne,one@x.test\n').expect(201);
    await start(admin, imp.id, { mapping: { fullName: 'Name', email: 'Email' }, ownerUserId: agentId }).expect(202);
    await processLeadImport(t.db, imp.id);
    const { body } = await admin.get('/api/v1/leads').expect(200);
    expect(body.items[0].owner.id).toBe(agentId);
  });

  it('is safe to process twice (worker retry)', async () => {
    const { body: imp } = await upload(admin, CSV).expect(201);
    await start(admin, imp.id, { mapping: MAPPING }).expect(202);
    await processLeadImport(t.db, imp.id);
    await processLeadImport(t.db, imp.id);
    const { body } = await admin.get(`/api/v1/lead-imports/${imp.id}`).expect(200);
    expect(body).toMatchObject({ imported: 3, duplicates: 1, invalid: 4 });
    expect((await admin.get('/api/v1/leads').expect(200)).body.items).toHaveLength(3);
  });

  it('escapes spreadsheet formulas in the downloadable error report', async () => {
    const { body: imp } = await upload(admin, CSV).expect(201);
    await start(admin, imp.id, { mapping: MAPPING }).expect(202);
    await processLeadImport(t.db, imp.id);
    const res = await admin.get(`/api/v1/lead-imports/${imp.id}/errors.csv`).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(res.text).not.toMatch(/^"?=HYPERLINK/m);
  });

  it('rejects empty, malformed and oversized files', async () => {
    expect((await upload(admin, '').expect(422)).body.error.code).toBe('EMPTY_FILE');
    expect((await upload(admin, 'Name\n"unterminated\n').expect(422)).body.error.code).toBe('INVALID_CSV');
    await upload(admin, 'Name\n' + 'x'.repeat(6 * 1024 * 1024)).expect(413);
  });

  it('is limited to lead.import and to the uploader’s organization', async () => {
    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'karim@acme.test', fullName: 'Karim Ahmed', role: 'AGENT', password: 'agent strong password' })
      .expect(201);
    const { agent } = await login(t, 'karim@acme.test', 'agent strong password');
    await upload(agent, CSV).expect(403);

    const { body: imp } = await upload(admin, CSV).expect(201);
    const rival = await createOtherOrg(t, 'rival');
    await rival.get(`/api/v1/lead-imports/${imp.id}`).expect(404);
    await start(rival, imp.id, { mapping: MAPPING }).expect(404);
  });
});
