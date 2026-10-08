import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { DbHandle } from '@leadora/database';
import type Redis from 'ioredis';
import { sql } from 'drizzle-orm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { DB, VALKEY } from '../../src/infra/tokens';

export interface TestApp {
  app: INestApplication;
  db: DbHandle['db'];
  valkey: Redis;
  /** Empties every table and the test Valkey db so each test starts from a clean slate. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** overrides replace providers (e.g. the AI provider factory) with test doubles. */
export async function createTestApp(overrides: { token: unknown; value: unknown }[] = []): Promise<TestApp> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  for (const o of overrides) builder.overrideProvider(o.token).useValue(o.value);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false, rawBody: true });
  configureApp(app);
  await app.init();

  const { db } = app.get<DbHandle>(DB);
  const valkey = app.get<Redis>(VALKEY);

  return {
    app,
    db,
    valkey,
    async reset() {
      const { rows } = await db.execute<{ tablename: string }>(
        sql`select tablename from pg_tables where schemaname = 'public'`,
      );
      if (rows.length) {
        const list = rows.map((r) => `"${r.tablename}"`).join(', ');
        await db.execute(sql.raw(`TRUNCATE ${list} RESTART IDENTITY CASCADE`));
      }
      await valkey.flushdb();
    },
    close: () => app.close(),
  };
}
