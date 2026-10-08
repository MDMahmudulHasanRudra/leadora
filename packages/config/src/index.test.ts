import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseLoggerOptions, loadEnv, EnvValidationError } from './index';

test('logger options produce the spec §70 shape', () => {
  const opts = baseLoggerOptions('api', 'info');
  assert.deepEqual(opts.base, { service: 'api' });
  assert.deepEqual(opts.formatters.level('warn'), { level: 'warn' });
  assert.match(opts.timestamp(), /^,"timestamp":"\d{4}-\d{2}-\d{2}T/);
});

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  VALKEY_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(32),
  DATA_ENCRYPTION_KEY: 'y'.repeat(32),
};

test('applies defaults and parses flags', () => {
  const env = loadEnv({ ...base, ENABLE_AI: 'true' });
  assert.equal(env.PORT, 3001);
  assert.equal(env.ENABLE_AI, true);
  assert.equal(env.ENABLE_AUTOMATION, false);
});

test('rejects a short JWT secret without leaking its value', () => {
  assert.throws(
    () => loadEnv({ ...base, JWT_SECRET: 'tooshort-secret-value' }),
    (err: unknown) =>
      err instanceof EnvValidationError &&
      err.message.includes('JWT_SECRET') &&
      !err.message.includes('tooshort-secret-value'),
  );
});

test('rejects missing DATABASE_URL', () => {
  const { DATABASE_URL: _omit, ...rest } = base;
  assert.throws(() => loadEnv(rest), EnvValidationError);
});
