import { testEnv } from './test-env';

const { databaseUrl, valkeyUrl } = testEnv();
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: databaseUrl,
  VALKEY_URL: valkeyUrl,
  JWT_SECRET: 'test-secret-'.padEnd(48, 'x'),
  DATA_ENCRYPTION_KEY: 'test-data-key-'.padEnd(48, 'z'),
  SMTP_URL: '',
  APP_ORIGINS: 'http://localhost:8080',
  ALLOW_SIGNUP: 'false',
  COOKIE_SECURE: 'false',
});
