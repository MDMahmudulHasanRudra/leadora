import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { VALKEY } from '../infra/tokens';

export const REALTIME_CHANNEL = 'leadora:events';

export interface RealtimeEvent {
  organizationId: string;
  /** Deliver only to this user's sockets; otherwise to the whole organization. */
  userId?: string;
  type: string;
  data: Record<string, unknown>;
}

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
