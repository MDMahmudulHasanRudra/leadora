import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toMailOptions } from './email';

const base = {
  channel: 'EMAIL' as const,
  from: 'sales@acme.test',
  fromName: 'Acme Sales',
  to: 'sadia@example.com',
  subject: 'Your quote',
  text: 'Hello',
  inReplyTo: null,
  references: [],
};

test('a first message has no threading headers', () => {
  assert.deepEqual(toMailOptions(base), {
    from: { name: 'Acme Sales', address: 'sales@acme.test' },
    to: 'sadia@example.com',
    subject: 'Your quote',
    text: 'Hello',
  });
});

test('replies carry In-Reply-To and References', () => {
  const opts = toMailOptions({ ...base, inReplyTo: '<b@x>', references: ['<a@x>', '<b@x>'] });
  assert.equal(opts.inReplyTo, '<b@x>');
  assert.deepEqual(opts.references, ['<a@x>', '<b@x>']);
});
