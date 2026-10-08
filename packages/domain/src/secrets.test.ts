import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decryptSecret, encryptSecret } from './secrets';

const KEY = 'k'.repeat(40);

test('round-trips and never repeats ciphertext for the same input', () => {
  const a = encryptSecret('whsec_123', KEY);
  const b = encryptSecret('whsec_123', KEY);
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a, KEY), 'whsec_123');
  assert.ok(!a.includes('whsec_123'));
});

test('rejects a wrong key or tampered ciphertext', () => {
  const sealed = encryptSecret('secret', KEY);
  assert.throws(() => decryptSecret(sealed, 'x'.repeat(40)));
  const parts = sealed.split('.');
  parts[3] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decryptSecret(parts.join('.'), KEY));
});
