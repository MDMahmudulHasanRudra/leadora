import net from 'node:net';
import { FakeAiProvider } from '@leadora/ai';
import { indexDocument, processInboundEvent } from '@leadora/domain';
import type { StorageProvider } from '@leadora/storage';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import type TestAgent from 'supertest/lib/agent';
import { AiService } from '../../src/ai/ai.service';
import { AI_PROVIDER_FACTORY, ENV, STORAGE } from '../../src/infra/tokens';
import { createTestApp, type TestApp } from '../support/app';
import { login, ORIGIN, registerAdmin } from '../support/fixtures';
import { createEmailInbox, startConversation } from '../support/inbox';
import { createOtherOrg } from '../support/orgs';
import { testEnv } from '../support/test-env';
import { postInbound } from '../support/webhook';

const PRICING = 'Blue model costs 120 BDT per unit. Bulk orders over 300 units get 5% off. Delivery inside Dhaka takes two days.';

describe('knowledge base: sources, indexing, retrieval and cited answers (spec §33–37, §55, §79)', () => {
  let t: TestApp;
  let admin: TestAgent;
  let fake: FakeAiProvider;
  let queue: Queue;
  let collectionId: string;
  const pages = new Map<string, { contentType: string; body: string }>();

  const post = (as: TestAgent, path: string, body: object) => as.post(`/api/v1/kb${path}`).set('Origin', ORIGIN).send(body);
  const upload = (as: TestAgent, name: string, content: Buffer | string, contentType: string, collection = collectionId) =>
    as.post('/api/v1/kb/documents/upload').set('Origin', ORIGIN).field('collectionId', collection).attach('file', Buffer.from(content), { filename: name, contentType });
  const index = (id: string) =>
    indexDocument(
      t.db,
      {
        ai: t.app.get(AiService).deps(),
        storage: t.app.get<StorageProvider>(STORAGE),
        fetchPage: async (url) => {
          const page = pages.get(url);
          if (!page) throw new Error(`not found: ${url}`);
          return { url, contentType: page.contentType, body: Buffer.from(page.body) };
        },
      },
      id,
      { finalAttempt: true },
    );
  const addText = async (title: string, text: string, collection = collectionId) => {
    const doc = (await post(admin, '/documents/text', { collectionId: collection, title, text }).expect(201)).body;
    expect(await index(doc.id)).toMatchObject({ status: 'INDEXED' });
    return doc;
  };
  const makeAgent = async () => {
    await admin
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ email: 'agent@acme.test', fullName: 'Agent', role: 'AGENT', password: 'agent strong password' })
      .expect(201);
    return (await login(t, 'agent@acme.test', 'agent strong password')).agent;
  };

  beforeAll(async () => {
    t = await createTestApp([{ token: AI_PROVIDER_FACTORY, value: () => fake }]);
    queue = new Queue('embeddings', { connection: { url: testEnv().valkeyUrl } });
  });
  beforeEach(async () => {
    await t.reset();
    pages.clear();
    fake = new FakeAiProvider();
    admin = (await registerAdmin(t)).agent;
    await admin
      .put('/api/v1/ai/settings')
      .set('Origin', ORIGIN)
      .send({ enabled: true, apiKey: 'sk-test-abcdefghijklmnop1234', models: { balanced: 'model-balanced', embedding: 'model-embed' } })
      .expect(200);
    collectionId = (await post(admin, '/collections', { name: 'Sales docs' }).expect(201)).body.id;
  });
  afterAll(async () => {
    await queue.close();
    await t.close();
  });

  it('uploads a file, queues indexing, and indexes it into embedded chunks', async () => {
    const res = await upload(admin, 'pricing.md', `# Pricing\n${PRICING}\n\n# Warranty\nOne year on all models.`, 'text/markdown').expect(201);
    expect(res.body).toMatchObject({ title: 'pricing', status: 'UPLOADED', sourceType: 'FILE', mimeType: 'text/markdown', version: 1 });
    expect(await queue.getJob(`kb-index-${res.body.id}`)).toBeTruthy();

    expect(await index(res.body.id)).toEqual({ status: 'INDEXED', chunks: 2 });
    expect(fake.embedRequests[0]).toMatchObject({ model: 'model-embed', dimensions: 1536 });
    const { body: list } = await admin.get(`/api/v1/kb/documents?collectionId=${collectionId}`).expect(200);
    expect(list.items[0]).toMatchObject({ id: res.body.id, status: 'INDEXED', chunkCount: 2 });
    const { body: chunks } = await admin.get(`/api/v1/kb/documents/${res.body.id}/chunks`).expect(200);
    expect(chunks.items.map((c: { section: string }) => c.section)).toEqual(['Pricing', 'Warranty']);
    const { rows } = await t.db.execute<{ purpose: string }>(sql`select purpose from ai_runs`);
    expect(rows).toEqual([{ purpose: 'kb_index' }]);
  });

  it('scans uploads with clamd when configured, rejecting infected files and failing closed', async () => {
    // A minimal clamd: reads INSTREAM chunks and flags the EICAR test string.
    const server = net.createServer((socket) => {
      let data = Buffer.alloc(0);
      socket.on('data', (d) => {
        data = Buffer.concat([data, d]);
        if (data.subarray(-4).equals(Buffer.alloc(4))) {
          socket.end(data.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE') ? 'stream: Win.Test.EICAR_HDB-1 FOUND\0' : 'stream: OK\0');
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const env = t.app.get<{ CLAMAV_HOST: string; CLAMAV_PORT: number }>(ENV);
    env.CLAMAV_HOST = '127.0.0.1';
    env.CLAMAV_PORT = (server.address() as net.AddressInfo).port;
    try {
      await upload(admin, 'clean.txt', 'Price list: blue model 120 BDT', 'text/plain').expect(201);
      const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
      expect((await upload(admin, 'eicar.txt', eicar, 'text/plain').expect(422)).body.error.code).toBe('MALWARE_DETECTED');
      server.close();
      await new Promise((r) => setTimeout(r, 50));
      expect((await upload(admin, 'later.txt', 'Another clean document here', 'text/plain').expect(502)).body.error.code).toBe('SCAN_UNAVAILABLE');
      expect((await admin.get(`/api/v1/kb/documents?collectionId=${collectionId}`).expect(200)).body.items).toHaveLength(1);
    } finally {
      env.CLAMAV_HOST = '';
      server.close();
    }
  });

  it('rejects files whose type, signature or size is wrong', async () => {
    expect((await upload(admin, 'tool.exe', 'MZ', 'application/octet-stream').expect(422)).body.error.code).toBe('UNSUPPORTED_FILE');
    expect((await upload(admin, 'fake.pdf', '<html><script>alert(1)</script>', 'application/pdf').expect(422)).body.error.code).toBe('FILE_TYPE_MISMATCH');
    // setup-env caps uploads at 1 MB.
    expect((await upload(admin, 'big.txt', 'a'.repeat(1_048_577), 'text/plain').expect(422)).body.error.code).toBe('FILE_TOO_LARGE');
    await upload(admin, 'x.txt', 'hello', 'text/plain', '00000000-0000-0000-0000-000000000000').expect(404);
  });

  it('retrieves relevant chunks and answers with citations, dropping sources it was not given', async () => {
    const doc = await addText('Pricing', PRICING);
    await addText('Holidays', 'The office is closed on Fridays and public holidays.');

    const { body: search } = await post(admin, '/search', { query: 'bulk orders over 300 units' }).expect(200);
    expect(search.items[0]).toMatchObject({ documentId: doc.id, documentTitle: 'Pricing', documentVersion: 1 });

    fake.reply(JSON.stringify({ answer: 'Bulk orders over 300 units get 5% off [S1].', citations: ['S1', 'S9'], insufficientEvidence: false }));
    const { body } = await post(admin, '/ask', { question: 'Do bulk orders over 300 units get a discount?' }).expect(200);
    expect(body).toMatchObject({ answer: 'Bulk orders over 300 units get 5% off [S1].', insufficientEvidence: false });
    expect(body.citations).toEqual([expect.objectContaining({ id: 'S1', documentId: doc.id, title: 'Pricing' })]);
    const req = fake.requests[0]!;
    expect(req.model).toBe('model-balanced');
    expect(req.input).toContain('<data label="S1">');
    expect(req.input).toContain('Bulk orders over 300 units');
  });

  it('says so instead of guessing when nothing relevant is found', async () => {
    await addText('Pricing', PRICING);
    const { body } = await post(admin, '/ask', { question: 'zebra xylophone quantum' }).expect(200);
    expect(body).toMatchObject({ insufficientEvidence: true, citations: [] });
    expect(body.answer).toMatch(/couldn.t find/i);
    expect(fake.requests).toHaveLength(0);
  });

  it('keeps team-restricted collections away from people outside the team, in lists, search and answers', async () => {
    const { body: team } = await admin.post('/api/v1/teams').set('Origin', ORIGIN).send({ name: 'Managers' }).expect(201);
    const secret = (await post(admin, '/collections', { name: 'Margins', visibility: 'TEAMS', teamIds: [team.id] }).expect(201)).body;
    const doc = await addText('Margins', 'Our margin on the blue model is 35 percent.', secret.id);
    const agent = await makeAgent();

    const { body: cols } = await agent.get('/api/v1/kb/collections').expect(200);
    expect(cols.items.map((c: { name: string }) => c.name)).toEqual(['Sales docs']);
    await agent.get(`/api/v1/kb/documents/${doc.id}`).expect(404);
    await agent.get(`/api/v1/kb/documents/${doc.id}/source`).expect(404);
    expect((await post(agent, '/search', { query: 'margin on the blue model' }).expect(200)).body.items).toEqual([]);
    // Agents can read the knowledge base but not change it.
    await post(agent, '/collections', { name: 'Mine' }).expect(403);
    await post(agent, '/documents/text', { collectionId, title: 'x', text: 'some text here' }).expect(403);

    // Admins (knowledge.manage) see everything.
    expect((await post(admin, '/search', { query: 'margin on the blue model' }).expect(200)).body.items[0].documentId).toBe(doc.id);
  });

  it('marks documents outdated when the embedding model changes, and re-indexing fixes them', async () => {
    const doc = await addText('Pricing', PRICING);
    await admin.put('/api/v1/ai/settings').set('Origin', ORIGIN).send({ models: { embedding: 'model-embed-2' } }).expect(200);
    expect((await admin.get(`/api/v1/kb/documents/${doc.id}`).expect(200)).body.status).toBe('OUTDATED');
    expect((await post(admin, '/search', { query: 'bulk orders over 300 units' }).expect(200)).body.items).toEqual([]);

    await post(admin, `/documents/${doc.id}/reindex`, {}).expect(202);
    await index(doc.id);
    expect((await admin.get(`/api/v1/kb/documents/${doc.id}`).expect(200)).body).toMatchObject({ status: 'INDEXED', embeddingModel: 'model-embed-2' });
  });

  it('imports a web page safely: private addresses are refused, robots.txt is honoured, the title is kept', async () => {
    expect((await post(admin, '/documents/url', { collectionId, url: 'http://169.254.169.254/latest/meta-data' }).expect(422)).body.error.code).toBe('URL_NOT_ALLOWED');
    expect((await post(admin, '/documents/url', { collectionId, url: 'file:///etc/passwd' }).expect(422)).body.error.code).toBe('URL_NOT_ALLOWED');

    pages.set('https://shop.example/robots.txt', { contentType: 'text/plain', body: 'User-agent: *\nDisallow: /private' });
    pages.set('https://shop.example/pricing', { contentType: 'text/html', body: `<html><head><title>Shop pricing</title></head><body><nav>menu</nav><p>${PRICING}</p></body></html>` });
    const doc = (await post(admin, '/documents/url', { collectionId, url: 'https://shop.example/pricing' }).expect(201)).body;
    expect(await index(doc.id)).toMatchObject({ status: 'INDEXED' });
    expect((await admin.get(`/api/v1/kb/documents/${doc.id}`).expect(200)).body).toMatchObject({ title: 'Shop pricing', sourceUrl: 'https://shop.example/pricing' });

    const blocked = (await post(admin, '/documents/url', { collectionId, url: 'https://shop.example/private/costs' }).expect(201)).body;
    expect(await index(blocked.id)).toMatchObject({ status: 'FAILED', error: expect.stringContaining('robots.txt') });
  });

  it('serves the original as a download and deletes documents with their chunks and file', async () => {
    const doc = (await upload(admin, 'notes.txt', PRICING, 'text/plain').expect(201)).body;
    await index(doc.id);
    const src = await admin.get(`/api/v1/kb/documents/${doc.id}/source`).expect(200);
    expect(src.headers['content-disposition']).toMatch(/^attachment; filename="notes.txt"/);
    expect(src.headers['x-content-type-options']).toBe('nosniff');
    expect(src.text ?? src.body.toString()).toContain('Blue model');

    expect(doc.storageKey).toBeUndefined();
    const { rows: keys } = await t.db.execute<{ storage_key: string }>(sql`select storage_key from kb_documents where id = ${doc.id}`);
    const storage = t.app.get<StorageProvider>(STORAGE);
    expect((await storage.get(keys[0]!.storage_key)).toString()).toBe(PRICING);

    await admin.delete(`/api/v1/kb/documents/${doc.id}`).set('Origin', ORIGIN).expect(204);
    const { rows } = await t.db.execute<{ n: number }>(sql`select count(*)::int as n from kb_chunks`);
    expect(rows[0]!.n).toBe(0);
    await expect(storage.get(keys[0]!.storage_key)).rejects.toThrow('File not found');
    const { body: audit } = await admin.get('/api/v1/audit-logs').expect(200);
    expect(audit.items.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['kb.document_created', 'kb.document_deleted']));
  });

  it('grounds AI reply drafts in the knowledge base and cites the sources used', async () => {
    const doc = await addText('Pricing', PRICING);
    const lead = (await admin.post('/api/v1/leads').set('Origin', ORIGIN).send({ fullName: 'Nadia', email: 'nadia@customer.test' }).expect(201)).body;
    const { inbox, webhookSecret } = await createEmailInbox(admin);
    const conv = (await startConversation(admin, { inboxId: inbox.id, leadId: lead.id, subject: 'Hello', body: 'Hi Nadia, how can we help?' }).expect(201)).body.conversation;
    const res = await postInbound(t, inbox.id, webhookSecret, {
      messageId: '<kb-1@customer.test>',
      from: { email: 'nadia@customer.test', name: 'Nadia' },
      to: 'sales@acme.test',
      subject: 'Re: Hello',
      text: 'Do bulk orders over 300 units get a discount?',
    }).expect(202);
    await processInboundEvent(t.db, res.body.eventId);

    fake.reply(JSON.stringify({ reply: 'Yes — orders over 300 units get 5% off.', language: 'en', notes: '', citations: ['S1', 'S7'] }));
    const { body } = await admin.post(`/api/v1/ai/conversations/${conv.id}/reply`).set('Origin', ORIGIN).send({ mode: 'suggest' }).expect(200);
    expect(body.citations).toEqual([expect.objectContaining({ id: 'S1', documentId: doc.id, title: 'Pricing' })]);
    expect(fake.requests[0]!.input).toContain('<data label="S1">');
    // Retrieval used the customer's latest question.
    expect(fake.embedRequests.at(-1)!.input).toEqual(['Do bulk orders over 300 units get a discount?']);
  });

  it('is off unless the installation enables it, and stays per organization', async () => {
    const rival = await createOtherOrg(t, 'rival');
    expect((await rival.get('/api/v1/kb/collections').expect(200)).body.items).toEqual([]);
    await rival.get(`/api/v1/kb/documents?collectionId=${collectionId}`).expect(200, { items: [] });

    const env = t.app.get<{ ENABLE_KNOWLEDGE_BASE: boolean }>(ENV);
    env.ENABLE_KNOWLEDGE_BASE = false;
    try {
      expect((await admin.get('/api/v1/kb/collections').expect(409)).body.error.code).toBe('KB_DISABLED');
    } finally {
      env.ENABLE_KNOWLEDGE_BASE = true;
    }
  });
});
