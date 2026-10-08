import { Inject, Injectable, Logger } from '@nestjs/common';
import { REALTIME_CHANNEL, type RealtimeEvent } from '@leadora/domain';
import type Redis from 'ioredis';
import { VALKEY } from '../infra/tokens';

/**
 * Publishes after the business change has committed (spec §24). Delivery is best effort:
 * clients re-fetch on reconnect, so a lost event never loses data.
 */
@Injectable()
export class RealtimePublisher {
  private readonly logger = new Logger(RealtimePublisher.name);

  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  async publish(organizationId: string, type: string, data: Record<string, unknown>, userId?: string) {
    const event: RealtimeEvent = { organizationId, type, data, ...(userId ? { userId } : {}) };
    await this.valkey.publish(REALTIME_CHANNEL, JSON.stringify(event)).catch((err: Error) => {
      this.logger.warn({ err: err.message, type }, 'realtime publish failed');
    });
  }
}
