import { createDb, organizations } from './index';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const { db, pool } = createDb(url, { max: 1 });
  try {
    await db
      .insert(organizations)
      .values({ name: 'Demo Organization', slug: 'demo', timezone: 'Asia/Dhaka', defaultCurrency: 'BDT' })
      .onConflictDoNothing({ target: organizations.slug });
    console.log(JSON.stringify({ level: 'info', service: 'seed', event: 'seed.completed' }));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', service: 'seed', message: String(err?.message ?? err) }));
  process.exit(1);
});
