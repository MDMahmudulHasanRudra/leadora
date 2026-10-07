import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryDelay } from './queues';

test('retry schedule follows 1m, 5m, 15m and caps at 15m', () => {
  assert.equal(retryDelay(1), 60_000);
  assert.equal(retryDelay(2), 300_000);
  assert.equal(retryDelay(3), 900_000);
  assert.equal(retryDelay(10), 900_000);
  assert.equal(retryDelay(0), 60_000);
});
