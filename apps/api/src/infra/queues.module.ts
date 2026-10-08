import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Env } from '@leadora/config';
import { Queue } from 'bullmq';
import { ENV, IMPORTS_QUEUE, MESSAGES_QUEUE } from './tokens';

@Global()
@Module({
  providers: [
    {
      provide: IMPORTS_QUEUE,
      inject: [ENV],
      useFactory: (env: Env) => new Queue('imports', { connection: { url: env.VALKEY_URL } }),
    },
    {
      provide: MESSAGES_QUEUE,
      inject: [ENV],
      useFactory: (env: Env) => new Queue('messages', { connection: { url: env.VALKEY_URL } }),
    },
  ],
  exports: [IMPORTS_QUEUE, MESSAGES_QUEUE],
})
export class QueuesModule implements OnApplicationShutdown {
  constructor(
    @Inject(IMPORTS_QUEUE) private readonly imports: Queue,
    @Inject(MESSAGES_QUEUE) private readonly messages: Queue,
  ) {}

  async onApplicationShutdown() {
    await Promise.allSettled([this.imports.close(), this.messages.close()]);
  }
}
