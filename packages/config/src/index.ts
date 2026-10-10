import { z } from 'zod';

export { baseLoggerOptions } from './logging';

const flag = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: z.string().url(),
  VALKEY_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  // Encrypts channel and provider secrets at rest. Changing it makes stored secrets unreadable.
  DATA_ENCRYPTION_KEY: z.string().min(32, 'DATA_ENCRYPTION_KEY must be at least 32 characters'),
  // smtp://user:pass@host:port (or smtps://). Empty disables outbound email.
  SMTP_URL: z.string().optional().default(''),
  // Public base URL users open; used in links inside emails and webhook URLs.
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8080'),

  // Comma-separated origins allowed to make state-changing requests (CSRF defense).
  APP_ORIGINS: z
    .string()
    .default('http://localhost:8080,http://localhost:3000')
    .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean)),
  // Open self-service org registration (SaaS). When false, only first-run setup may register.
  ALLOW_SIGNUP: flag,
  COOKIE_SECURE: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().max(24 * 90).default(24 * 7),
  // Requests per minute per API key (spec §92).
  API_KEY_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(100_000).default(600),
  // Spec §69: per signed-in user (or API key) per minute; AI is stricter.
  RATE_LIMIT_API_PER_MIN: z.coerce.number().int().min(1).max(100_000).default(1200),
  RATE_LIMIT_AI_PER_MIN: z.coerce.number().int().min(1).max(10_000).default(30),

  OPENAI_API_KEY: z.string().optional().default(''),
  // Meta Graph API base (WhatsApp Cloud API, Messenger, Instagram). Overridable for tests and API version pinning.
  META_GRAPH_URL: z.string().url().default('https://graph.facebook.com/v21.0'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  // local: a directory outside the app image (a Docker volume in Compose).
  STORAGE_LOCAL_DIR: z.string().default('./data/uploads'),
  // s3: any S3-compatible service.
  STORAGE_BUCKET: z.string().optional().default(''),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_ENDPOINT: z.string().optional().default(''),
  STORAGE_ACCESS_KEY: z.string().optional().default(''),
  STORAGE_SECRET_KEY: z.string().optional().default(''),
  STORAGE_FORCE_PATH_STYLE: flag,
  KB_MAX_FILE_MB: z.coerce.number().int().min(1).max(200).default(20),
  // Optional clamd for upload malware scanning (spec §54). Empty = scanning off.
  CLAMAV_HOST: z.string().optional().default(''),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),

  ENABLE_AI: flag,
  ENABLE_KNOWLEDGE_BASE: flag,
  ENABLE_AUTOMATION: flag,
  ENABLE_WHATSAPP: flag,
  ENABLE_EMAIL: flag,
  ENABLE_ADVANCED_ANALYTICS: flag,
  ENABLE_AI_AUTO_REPLY: flag,
}).superRefine((env, ctx) => {
  if (env.STORAGE_DRIVER === 's3' && !env.STORAGE_BUCKET) {
    ctx.addIssue({ code: 'custom', path: ['STORAGE_BUCKET'], message: 'STORAGE_BUCKET is required when STORAGE_DRIVER=s3' });
  }
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Report variable names only; values may be secrets.
    throw new EnvValidationError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return parsed.data;
}
