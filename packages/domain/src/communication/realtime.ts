/** Valkey pub/sub channel carrying realtime events from API and worker to every API instance's sockets. */
export const REALTIME_CHANNEL = 'leadora:events';

export interface RealtimeEvent {
  organizationId: string;
  /** Deliver only to this user's sockets; otherwise to the whole organization. */
  userId?: string;
  type: string;
  data: Record<string, unknown>;
}
