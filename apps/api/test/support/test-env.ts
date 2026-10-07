import fs from 'node:fs';
import path from 'node:path';

const ROOT_ENV = path.resolve(__dirname, '../../../../.env');

/** Resolves connection strings for the integration test database and Valkey db 15. */
export function testEnv() {
  if (!process.env.TEST_DATABASE_URL && fs.existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

  const user = process.env.POSTGRES_USER ?? 'leadora';
  const password = process.env.POSTGRES_PASSWORD ?? 'leadora';
  const adminUrl =
    process.env.TEST_ADMIN_DATABASE_URL ?? `postgres://${user}:${password}@localhost:5432/postgres`;
  const databaseUrl =
    process.env.TEST_DATABASE_URL ?? `postgres://${user}:${password}@localhost:5432/leadora_test`;
  const valkeyUrl = process.env.TEST_VALKEY_URL ?? 'redis://localhost:6379/15';
  return { adminUrl, databaseUrl, valkeyUrl };
}
