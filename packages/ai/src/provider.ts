/** Spec §25. Business code depends on this interface only. */
export interface AiUsage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

export interface StructuredRequest {
  model: string;
  system: string;
  input: string;
  /** JSON Schema (strict: every property required, no additional properties). */
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  maxOutputTokens: number;
  temperature?: number;
}

export interface TextRequest {
  model: string;
  system: string;
  input: string;
  maxOutputTokens: number;
  temperature?: number;
}

export interface AiResult {
  /** Raw model text; for structured calls, the JSON document. */
  text: string;
  usage: AiUsage;
  model: string;
  requestId: string | null;
}

export interface EmbeddingResult {
  vectors: number[][];
  usage: AiUsage;
  model: string;
}

export interface AiProvider {
  readonly name: string;
  generateStructured(req: StructuredRequest): Promise<AiResult>;
  generateText(req: TextRequest): Promise<AiResult>;
  /** dimensions asks the model for vectors of that size (all stored vectors share one size). */
  embed(req: { model: string; input: string[]; dimensions?: number }): Promise<EmbeddingResult>;
}

/** Provider failure with a stable code for ai_runs and the API error contract. */
export class AiProviderError extends Error {
  constructor(
    public readonly code: 'AI_AUTH_FAILED' | 'AI_RATE_LIMITED' | 'AI_UNAVAILABLE' | 'AI_BAD_REQUEST' | 'AI_TIMEOUT' | 'AI_INCOMPLETE',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}
