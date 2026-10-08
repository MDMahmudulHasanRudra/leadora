export const ENV = Symbol('ENV');
export const DB = Symbol('DB');
export const VALKEY = Symbol('VALKEY');
export const IMPORTS_QUEUE = Symbol('IMPORTS_QUEUE');
export const MESSAGES_QUEUE = Symbol('MESSAGES_QUEUE');
/** (provider: string, apiKey: string) => AiProvider. Overridden in tests with a fake. */
export const AI_PROVIDER_FACTORY = Symbol('AI_PROVIDER_FACTORY');
