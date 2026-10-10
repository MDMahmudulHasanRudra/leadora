import { runLeadExport } from '@leadora/domain';
import type { StorageProvider } from '@leadora/storage';
import ExcelJS from 'exceljs';
import type TestAgent from 'supertest/lib/agent';
import { STORAGE } from '../../src/infra/tokens';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createLead } from '../support/leads';

describe('lead exports (spec §44)', () => {
  let t: TestApp;
  let admin: TestAgent;
  let unitsKey: string;

  const requestExport = (as: TestAgent, body: object) => as.post('/api/v1/exports').set('Origin', ORIGIN).send({ entity: 'leads', ...body });
  const run = (id: string) => runLeadExport(t.db, t.app.get<StorageProvider>(STORAGE), id);
  const download = (id: string) =>
    admin
      .get(`/api/v1/exports/${id}/download`)
      .buffer(true)
      .parse((res, cb) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () => cb(null, Buffer.concat(parts)));
      });

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.reset();
    admin = (await registerAdmin(t)).agent;
    unitsKey = (await admin.post('/api/v1/custom-fields').set('Origin', ORIGIN).send({ entity: 'lead', label: 'Units wanted', type: 'number' }).expect(201)).body.key;
    await createLead(admin, { fullName: 'রহিম Traders', email: 'rahim@shop.test', tags: ['vip'], budget: 50000, customFields: { [unitsKey]: 300 } }).expect(201);
    await createLead(admin, { fullName: '=HYPERLINK("http://evil.example","click")', email: 'evil@shop.test', tags: ['vip'] }).expect(201);
    await createLead(admin, { fullName: 'Not VIP', email: 'plain@shop.test' }).expect(201);
  });
  afterAll(async () => t.close());

  it('exports the filtered leads with the chosen fields as CSV, safe for spreadsheets', async () => {
    const { body: job } = await requestExport(admin, { format: 'CSV', fields: ['fullName', 'email', 'tags', 'budget', `custom.${unitsKey}`], filters: { tag: 'vip' } }).expect(202);
    expect(job).toMatchObject({ status: 'QUEUED', format: 'CSV' });
    expect(job.storageKey).toBeUndefined();
    await download(job.id).expect(409);

    expect(await run(job.id)).toEqual({ status: 'SUCCEEDED', rows: 2 });
    expect((await admin.get(`/api/v1/exports/${job.id}`).expect(200)).body).toMatchObject({ status: 'SUCCEEDED', rowCount: 2, downloadable: true });

    const res = await download(job.id).expect(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="leads-\d{4}-\d{2}-\d{2}\.csv"/);
    const text = (res.body as Buffer).toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('"Name","Email","Tags","Budget","Units wanted"');
    expect(lines).toContain('"রহিম Traders","rahim@shop.test","vip","50000","300"');
    // A formula in a lead name is neutralized, never executed by the spreadsheet.
    expect(lines.some((l) => l.startsWith(`"'=HYPERLINK(`))).toBe(true);
    expect(lines.some((l) => l.includes('Not VIP'))).toBe(false);

    const { body: audit } = await admin.get('/api/v1/audit-logs').expect(200);
    expect(audit.items.map((a: { action: string }) => a.action)).toContain('lead.exported');
  });

  it('exports XLSX with typed cells', async () => {
    const { body: job } = await requestExport(admin, { format: 'XLSX', fields: ['fullName', 'budget'], filters: { q: 'Traders' } }).expect(202);
    await run(job.id);
    const res = await download(job.id).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer);
    const ws = wb.getWorksheet('Leads')!;
    expect(ws.getRow(1).values).toEqual([undefined, 'Name', 'Budget']);
    expect(ws.getRow(2).values).toEqual([undefined, 'রহিম Traders', 50000]);
    expect(ws.rowCount).toBe(2);
  });

  it('validates fields, keeps exports private to their creator, and requires lead.export', async () => {
    await requestExport(admin, { format: 'CSV', fields: ['passwordHash'] }).expect(422);
    const { body: job } = await requestExport(admin, { format: 'CSV', fields: ['fullName'] }).expect(202);
    await run(job.id);

    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'm@acme.test', fullName: 'Manager', role: 'MANAGER', password: 'manager strong password' })
      .expect(201);
    const { agent: manager } = await login(t, 'm@acme.test', 'manager strong password');
    await manager.get(`/api/v1/exports/${job.id}/download`).expect(404);
    expect((await manager.get('/api/v1/exports').expect(200)).body.items).toEqual([]);

    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'a@acme.test', fullName: 'Agent', role: 'AGENT', password: 'agent strong password' })
      .expect(201);
    const { agent } = await login(t, 'a@acme.test', 'agent strong password');
    await requestExport(agent, { format: 'CSV', fields: ['fullName'] }).expect(403);
  });
});
