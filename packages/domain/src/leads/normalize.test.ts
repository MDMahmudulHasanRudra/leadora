import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { escapeLike, normalizeEmail, normalizePhone } from './normalize';

describe('normalizePhone (default country BD)', () => {
  for (const [input, expected] of [
    ['01712-345678', '+8801712345678'],
    ['01712 345 678', '+8801712345678'],
    ['+880 1712-345678', '+8801712345678'],
    ['008801712345678', '+8801712345678'],
    ['+44 7911 123456', '+447911123456'],
  ]) {
    test(`${input} → ${expected}`, () => assert.equal(normalizePhone(input!, 'BD'), expected));
  }

  for (const input of ['abc', '123', '+1', '']) {
    test(`rejects ${JSON.stringify(input)}`, () => assert.equal(normalizePhone(input, 'BD'), null));
  }

  test('uses the organization country for local numbers', () => {
    assert.equal(normalizePhone('07911 123456', 'GB'), '+447911123456');
  });
});

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  Rahim@Acme.COM '), 'rahim@acme.com');
});

test('escapeLike escapes wildcards and backslashes', () => {
  assert.equal(escapeLike('100%_a\\b'), '100\\%\\_a\\\\b');
});
