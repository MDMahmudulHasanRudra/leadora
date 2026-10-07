import { migrateDatabase } from './index';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  await migrateDatabase(url);
  console.log(JSON.stringify({ level: 'info', service: 'migrate', event: 'migrations.applied' }));
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', service: 'migrate', message: String(err?.message ?? err) }));
  process.exit(1);
});
