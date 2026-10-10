// Re-encrypts stored secrets from DATA_ENCRYPTION_KEY to NEW_DATA_ENCRYPTION_KEY (docs/RUNBOOK.md).
// Stop the api and worker first, then:
//   docker compose run --rm --no-deps -e NEW_DATA_ENCRYPTION_KEY worker node dist/rotate-secrets.js
// and set DATA_ENCRYPTION_KEY to the new value before starting them again.
import { createDb } from '@leadora/database';
import { rotateSecrets } from '@leadora/domain';

const { DATABASE_URL, DATA_ENCRYPTION_KEY, NEW_DATA_ENCRYPTION_KEY } = process.env;
if (!DATABASE_URL || !DATA_ENCRYPTION_KEY || !NEW_DATA_ENCRYPTION_KEY) {
  console.error('DATABASE_URL, DATA_ENCRYPTION_KEY (current) and NEW_DATA_ENCRYPTION_KEY are required');
  process.exit(2);
}

async function main(url: string, oldKey: string, newKey: string) {
  const { db, pool } = createDb(url, { max: 1 });
  try {
    const { columns, values } = await rotateSecrets(db, oldKey, newKey);
    console.log(JSON.stringify({ level: 'info', event: 'secrets.rotated', columns, values }));
    console.log('Done. Set DATA_ENCRYPTION_KEY to the new value, then start the api and worker.');
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'secrets.rotation_failed', message: (err as Error).message }));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main(DATABASE_URL, DATA_ENCRYPTION_KEY, NEW_DATA_ENCRYPTION_KEY);
