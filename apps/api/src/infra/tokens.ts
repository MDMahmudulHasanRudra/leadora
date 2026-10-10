export const ENV = Symbol('ENV');
export const DB = Symbol('DB');
export const VALKEY = Symbol('VALKEY');
export const IMPORTS_QUEUE = Symbol('IMPORTS_QUEUE');
export const MESSAGES_QUEUE = Symbol('MESSAGES_QUEUE');
export const DEFAULT_QUEUE = Symbol('DEFAULT_QUEUE');
/** (provider: string, apiKey: string) => AiProvider. Overridden in tests with a fake. */
export const AI_PROVIDER_FACTORY = Symbol('AI_PROVIDER_FACTORY');
export const EMBEDDINGS_QUEUE = Symbol('EMBEDDINGS_QUEUE');
/** StorageProvider for uploads (local disk or S3-compatible). */
export const STORAGE = Symbol('STORAGE');
export const AUTOMATIONS_QUEUE = Symbol('AUTOMATIONS_QUEUE');
export const WEBHOOKS_QUEUE = Symbol('WEBHOOKS_QUEUE');
/** (provider, secret, token, ip) => Promise<boolean>. Overridden in tests. */
export const CAPTCHA_VERIFIER = Symbol('CAPTCHA_VERIFIER');
export const EXPORTS_QUEUE = Symbol('EXPORTS_QUEUE');
