import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';
import { ErrorReporter, parseDsn, type SentryEvent } from './error-reporter';

interface Received {
  path: string;
  headers: IncomingHttpHeaders;
  lines: unknown[];
}
const received: Received[] = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received.push({ path: req.url ?? '', headers: req.headers, lines: body.trim().split('\n').map((l) => JSON.parse(l)) });
    res.writeHead(200).end('{}');
  });
});
let dsn = '';

before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  dsn = `http://publickey123@127.0.0.1:${(server.address() as AddressInfo).port}/42`;
});
after(() => server.close());
beforeEach(() => {
  received.length = 0;
});

const reporter = (extra: Partial<ConstructorParameters<typeof ErrorReporter>[0]> = {}) =>
  new ErrorReporter({ dsn, service: 'api', environment: 'production', release: '1.2.3', ...extra });

test('parses Sentry-style DSNs, including a path prefix', () => {
  assert.deepEqual(parseDsn('https://abc@errors.example.com/42'), { endpoint: 'https://errors.example.com/api/42/envelope/', publicKey: 'abc' });
  assert.deepEqual(parseDsn('https://abc@host.example/glitchtip/7'), { endpoint: 'https://host.example/glitchtip/api/7/envelope/', publicKey: 'abc' });
  assert.throws(() => parseDsn('https://host.example/7'), /DSN/);
  assert.throws(() => parseDsn('not a url'), /DSN/);
});

test('sends one envelope per error with the exception, stack, service and request context', async () => {
  const err = new TypeError('boom');
  await reporter().capture(err, {
    tags: { requestId: 'req-1', organizationId: 'org-1' },
    user: { id: 'user-1' },
    request: { method: 'POST', url: '/api/v1/leads?q=secret@example.com' },
  });

  assert.equal(received.length, 1);
  const [{ path, headers, lines }] = received;
  assert.equal(path, '/api/42/envelope/');
  assert.match(String(headers['x-sentry-auth']), /sentry_key=publickey123/);
  const [envelopeHeader, itemHeader, event] = lines as [Record<string, unknown>, Record<string, unknown>, SentryEvent];
  assert.match(String(envelopeHeader.event_id), /^[0-9a-f]{32}$/);
  assert.deepEqual(itemHeader, { type: 'event' });
  assert.equal(event.event_id, envelopeHeader.event_id);
  assert.equal(event.level, 'error');
  assert.equal(event.environment, 'production');
  assert.equal(event.release, '1.2.3');
  assert.deepEqual(event.tags, { service: 'api', requestId: 'req-1', organizationId: 'org-1' });
  assert.deepEqual(event.user, { id: 'user-1' });
  assert.equal(event.exception.values[0]!.type, 'TypeError');
  assert.equal(event.exception.values[0]!.value, 'boom');
  assert.ok(event.exception.values[0]!.stacktrace.frames.length > 0);
});

test('never sends query strings, bodies, headers or cookies', async () => {
  await reporter().capture(new Error('x'), { request: { method: 'GET', url: '/api/v1/leads?q=rahim%40shop.test' } });
  const event = received[0]!.lines[2] as SentryEvent;
  assert.deepEqual(event.request, { method: 'GET', url: '/api/v1/leads' });
  assert.doesNotMatch(JSON.stringify(event), /rahim|cookie|authorization/i);
});

test('caps how many errors are sent per minute', async () => {
  const r = reporter({ maxPerMinute: 2 });
  for (let i = 0; i < 5; i++) await r.capture(new Error(`e${i}`));
  assert.equal(received.length, 2);
});

test('never throws when the tracker is unreachable', async () => {
  const r = new ErrorReporter({ dsn: 'http://k@127.0.0.1:1/9', service: 'worker', environment: 'test', timeoutMs: 500 });
  await r.capture(new Error('lost'));
  await r.capture('not even an Error');
});
