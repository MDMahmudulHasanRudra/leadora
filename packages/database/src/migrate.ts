import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './index';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const { db, pool } = createDb(url, { max: 1 });
  const migrationsFolder = path.resolve(__dirname, '..', 'migrations');
  try {
    await migrate(db, { migrationsFolder });
    console.log(JSON.stringify({ level: 'info', service: 'migrate', event: 'migrations.applied' }));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', service: 'migrate', message: String(err?.message ?? err) }));
  process.exit(1);
});
