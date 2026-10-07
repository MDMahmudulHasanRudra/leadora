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

  OPENAI_API_KEY: z.string().optional().default(''),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),

  ENABLE_AI: flag,
  ENABLE_KNOWLEDGE_BASE: flag,
  ENABLE_AUTOMATION: flag,
  ENABLE_WHATSAPP: flag,
  ENABLE_EMAIL: flag,
  ENABLE_ADVANCED_ANALYTICS: flag,
  ENABLE_AI_AUTO_REPLY: flag,
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
