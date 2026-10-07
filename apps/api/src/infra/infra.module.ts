import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { loadEnv, type Env } from '@leadora/config';
import { createDb, type DbHandle } from '@leadora/database';
import Redis from 'ioredis';
import { DB, ENV, VALKEY } from './tokens';

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    {
      provide: DB,
      inject: [ENV],
      useFactory: (env: Env): DbHandle => createDb(env.DATABASE_URL),
    },
    {
      provide: VALKEY,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Redis(env.VALKEY_URL, { lazyConnect: false, maxRetriesPerRequest: 2, enableOfflineQueue: false }),
    },
  ],
  exports: [ENV, DB, VALKEY],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(VALKEY) private readonly valkey: Redis,
  ) {}

  async onApplicationShutdown() {
    await Promise.allSettled([this.db.pool.end(), this.valkey.quit()]);
  }
}
