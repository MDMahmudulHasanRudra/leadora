import { migrateDatabase } from '@leadora/database';
import { Client } from 'pg';
import { testEnv } from './test-env';

export default async function setup() {
  const { adminUrl, databaseUrl } = testEnv();
  const dbName = new URL(databaseUrl).pathname.slice(1);
  if (!/^[a-z_][a-z0-9_]*_test$/.test(dbName)) {
    throw new Error(`Refusing to recreate "${dbName}": test database names must end in _test`);
  }

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
  await migrateDatabase(databaseUrl);
}
