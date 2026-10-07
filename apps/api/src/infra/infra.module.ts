import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { loadEnv, type Env } from '@leadora/config';
import { createDb, type DbHandle } from '@leadora/database';
import Redis from 'ioredis';
import { DB, ENV, VALKEY } from './tokens';

const VALKEY_READY_TIMEOUT_MS = 5000;

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
        new Redis(env.VALKEY_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false }),
    },
  ],
  exports: [ENV, DB, VALKEY],
})
export class InfraModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(InfraModule.name);

  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(VALKEY) private readonly valkey: Redis,
  ) {}

  // Avoid serving traffic before Valkey is connected, but don't block boot forever:
  // readiness reports the outage if it persists.
  async onModuleInit() {
    if (this.valkey.status === 'ready') return;
    const ready = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), VALKEY_READY_TIMEOUT_MS);
      this.valkey.once('ready', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!ready) this.logger.warn(`Valkey not ready after ${VALKEY_READY_TIMEOUT_MS}ms; continuing startup`);
  }

  async onApplicationShutdown() {
    await Promise.allSettled([this.db.pool.end(), this.valkey.quit()]);
  }
}
