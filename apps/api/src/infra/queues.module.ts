import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Env } from '@leadora/config';
import { Queue } from 'bullmq';
import { AUTOMATIONS_QUEUE, DEFAULT_QUEUE, EMBEDDINGS_QUEUE, ENV, IMPORTS_QUEUE, MESSAGES_QUEUE } from './tokens';

const queue = (token: symbol, name: string) => ({
  provide: token,
  inject: [ENV],
  useFactory: (env: Env) => new Queue(name, { connection: { url: env.VALKEY_URL } }),
});

@Global()
@Module({
  providers: [
    queue(IMPORTS_QUEUE, 'imports'),
    queue(MESSAGES_QUEUE, 'messages'),
    queue(DEFAULT_QUEUE, 'default'),
    queue(EMBEDDINGS_QUEUE, 'embeddings'),
    queue(AUTOMATIONS_QUEUE, 'automations'),
  ],
  exports: [IMPORTS_QUEUE, MESSAGES_QUEUE, DEFAULT_QUEUE, EMBEDDINGS_QUEUE, AUTOMATIONS_QUEUE],
})
export class QueuesModule implements OnApplicationShutdown {
  constructor(
    @Inject(IMPORTS_QUEUE) private readonly imports: Queue,
    @Inject(MESSAGES_QUEUE) private readonly messages: Queue,
    @Inject(DEFAULT_QUEUE) private readonly defaults: Queue,
    @Inject(EMBEDDINGS_QUEUE) private readonly embeddings: Queue,
    @Inject(AUTOMATIONS_QUEUE) private readonly automations: Queue,
  ) {}

  async onApplicationShutdown() {
    await Promise.allSettled([this.imports.close(), this.messages.close(), this.defaults.close(), this.embeddings.close(), this.automations.close()]);
  }
}
