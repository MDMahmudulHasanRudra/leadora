// Spec §119. Each queue gets its own concurrency; AI is kept low to respect provider rate limits.
export const QUEUES = {
  default: { concurrency: 5 },
  ai: { concurrency: 2 },
  imports: { concurrency: 1 },
  exports: { concurrency: 1 },
  messages: { concurrency: 5 },
  notifications: { concurrency: 5 },
  automations: { concurrency: 3 },
  embeddings: { concurrency: 2 },
  analytics: { concurrency: 1 },
  webhooks: { concurrency: 5 },
} as const;

export type QueueName = keyof typeof QUEUES;

// Spec §120: 1m, 5m, 15m then dead-letter.
export const RETRY_DELAYS_MS = [60_000, 300_000, 900_000] as const;

export function retryDelay(attemptsMade: number): number {
  const idx = Math.min(Math.max(attemptsMade - 1, 0), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[idx]!;
}
