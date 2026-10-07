import { UnprocessableEntityException } from '@nestjs/common';

/** Opaque keyset cursor over a monotonically increasing sequence column. */
export function encodeSeqCursor(seq: number): string {
  return Buffer.from(`s:${seq}`).toString('base64url');
}

export function decodeSeqCursor(raw: string): number {
  const match = /^s:(\d{1,18})$/.exec(Buffer.from(raw, 'base64url').toString('utf8'));
  if (!match) throw new UnprocessableEntityException({ code: 'INVALID_CURSOR', message: 'Invalid pagination cursor' });
  return Number(match[1]);
}
