import { UnprocessableEntityException } from '@nestjs/common';

/** Opaque keyset cursor over a monotonically increasing sequence column. */
export function encodeSeqCursor(seq: number): string {
  return Buffer.from(`s:${seq}`).toString('base64url');
}

/**
 * Opaque keyset cursor over (created_at, id). Only for columns stored with millisecond precision,
 * otherwise JS Dates truncate microseconds and pages skip rows.
 */
export function encodeTimeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`t:${createdAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeTimeCursor(raw: string): { createdAt: Date; id: string } {
  const match = /^t:(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)\|([0-9a-f-]{36})$/.exec(Buffer.from(raw, 'base64url').toString('utf8'));
  if (!match) throw new UnprocessableEntityException({ code: 'INVALID_CURSOR', message: 'Invalid pagination cursor' });
  return { createdAt: new Date(match[1]!), id: match[2]! };
}

export function decodeSeqCursor(raw: string): number {
  const match = /^s:(\d{1,18})$/.exec(Buffer.from(raw, 'base64url').toString('utf8'));
  if (!match) throw new UnprocessableEntityException({ code: 'INVALID_CURSOR', message: 'Invalid pagination cursor' });
  return Number(match[1]);
}
