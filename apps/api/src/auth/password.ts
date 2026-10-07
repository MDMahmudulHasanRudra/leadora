import { hash, verify } from '@node-rs/argon2';

// OWASP Argon2id baseline: m=19 MiB, t=2, p=1. @node-rs/argon2 defaults to Argon2id.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password).catch(() => false);
}

let dummyHash: Promise<string> | undefined;

/** Spend the same work as a real verify so unknown emails aren't distinguishable by timing. */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('leadora-timing-equalizer');
  await verifyPassword(await dummyHash, password);
}
