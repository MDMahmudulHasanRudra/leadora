import { decryptSecret, rotateSecrets } from '@leadora/domain';
import { sql } from 'drizzle-orm';
import { createTestApp, type TestApp } from '../support/app';
import { ORIGIN, registerAdmin } from '../support/fixtures';
import { createEmailInbox } from '../support/inbox';

const OLD_KEY = process.env.DATA_ENCRYPTION_KEY!;
const NEW_KEY = 'rotated-data-key-'.padEnd(48, 'n');
const AI_KEY = 'sk-test-rotation-1234';
const APP_SECRET = 'meta-app-secret-for-rotation';
const TOKEN = 'meta-access-token-for-rotation-test';

describe('DATA_ENCRYPTION_KEY rotation (runbook)', () => {
  let t: TestApp;
  let stored: { emailSecret: string; webhookSecret: string };

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.reset();
    const { agent } = await registerAdmin(t);
    const email = await createEmailInbox(agent);
    await agent
      .post('/api/v1/inboxes')
      .set('Origin', ORIGIN)
      .send({ name: 'WhatsApp', channel: 'WHATSAPP', config: { accountId: '1098765432', appSecret: APP_SECRET, accessToken: TOKEN } })
      .expect(201);
    const hook = await agent.post('/api/v1/webhooks').set('Origin', ORIGIN).send({ url: 'https://hooks.example/x', events: ['lead.created'] }).expect(201);
    await agent
      .put('/api/v1/ai/settings')
      .set('Origin', ORIGIN)
      .send({ enabled: true, apiKey: AI_KEY, models: { fast: 'f', balanced: 'b', embedding: 'e' } })
      .expect(200);
    stored = { emailSecret: email.webhookSecret, webhookSecret: hook.body.secret };
  });

  async function sealed() {
    const one = async (q: ReturnType<typeof sql>) => (await t.db.execute<{ v: string }>(q)).rows[0]!.v;
    return {
      inboxSecret: await one(sql`select webhook_secret_enc as v from inboxes where channel = 'EMAIL'`),
      appSecret: await one(sql`select config->>'appSecretEnc' as v from inboxes where channel = 'WHATSAPP'`),
      accessToken: await one(sql`select config->>'accessTokenEnc' as v from inboxes where channel = 'WHATSAPP'`),
      webhookSecret: await one(sql`select secret_enc as v from webhook_endpoints`),
      aiKey: await one(sql`select api_key_enc as v from ai_settings`),
    };
  }

  it('re-encrypts every stored secret so only the new key opens it', async () => {
    const result = await rotateSecrets(t.db, OLD_KEY, NEW_KEY);

    const s = await sealed();
    expect(decryptSecret(s.inboxSecret, NEW_KEY)).toBe(stored.emailSecret);
    expect(decryptSecret(s.appSecret, NEW_KEY)).toBe(APP_SECRET);
    expect(decryptSecret(s.accessToken, NEW_KEY)).toBe(TOKEN);
    expect(decryptSecret(s.webhookSecret, NEW_KEY)).toBe(stored.webhookSecret);
    expect(decryptSecret(s.aiKey, NEW_KEY)).toBe(AI_KEY);
    expect(() => decryptSecret(s.aiKey, OLD_KEY)).toThrow();
    // Email inbox + WhatsApp inbox secrets, WhatsApp app secret / access token / verify token, webhook, AI key.
    expect(result.values).toBe(7);
  });

  it('changes nothing when a value does not open with the given old key', async () => {
    const before = await sealed();

    await expect(rotateSecrets(t.db, 'not-the-current-key'.padEnd(40, 'x'), NEW_KEY)).rejects.toThrow(/inboxes|webhook_endpoints|ai_settings/);

    expect(await sealed()).toEqual(before);
  });

  it('refuses to rotate to the same key', async () => {
    await expect(rotateSecrets(t.db, OLD_KEY, OLD_KEY)).rejects.toThrow(/differ/);
  });
});
