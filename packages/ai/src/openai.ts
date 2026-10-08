import {
  type AiProvider,
  AiProviderError,
  type AiResult,
  type EmbeddingResult,
  type StructuredRequest,
  type TextRequest,
} from './provider';

export interface OpenAiOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface ResponsesBody {
  id?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  model?: string;
  output?: { type: string; content?: { type: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
}

/**
 * OpenAI via the Responses API (the Assistants API was sunset 2026-08-26; spec §26) and the Embeddings API.
 * Plain fetch keeps the dependency surface small; retries cover 429 and 5xx with exponential backoff.
 */
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: OpenAiOptions) {
    this.baseUrl = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async post<T>(path: string, body: unknown): Promise<{ json: T; requestId: string | null }> {
    const maxRetries = this.opts.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.opts.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 60_000),
        });
      } catch (err) {
        if (attempt < maxRetries) {
          await this.sleep(500 * 2 ** attempt);
          continue;
        }
        const timeout = (err as Error).name === 'TimeoutError';
        throw new AiProviderError(timeout ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE', timeout ? 'The AI provider timed out' : 'Could not reach the AI provider');
      }
      if (res.ok) return { json: (await res.json()) as T, requestId: res.headers.get('x-request-id') };

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
        continue;
      }
      // Never surface provider bodies verbatim: they can echo request content.
      if (res.status === 401 || res.status === 403) throw new AiProviderError('AI_AUTH_FAILED', 'The AI provider rejected the API key', res.status);
      if (res.status === 429) throw new AiProviderError('AI_RATE_LIMITED', 'The AI provider rate limit was reached', res.status);
      if (res.status >= 500) throw new AiProviderError('AI_UNAVAILABLE', 'The AI provider is unavailable', res.status);
      throw new AiProviderError('AI_BAD_REQUEST', `The AI provider rejected the request (${res.status})`, res.status);
    }
  }

  private toResult(json: ResponsesBody, requestId: string | null, model: string): AiResult {
    if (json.status === 'incomplete') {
      throw new AiProviderError('AI_INCOMPLETE', `The AI response was cut off (${json.incomplete_details?.reason ?? 'unknown'})`);
    }
    const text = (json.output ?? [])
      .filter((o) => o.type === 'message')
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text ?? '')
      .join('');
    return {
      text,
      model: json.model ?? model,
      requestId: requestId ?? json.id ?? null,
      usage: {
        inputTokens: json.usage?.input_tokens ?? 0,
        cachedTokens: json.usage?.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
      },
    };
  }

  async generateStructured(req: StructuredRequest): Promise<AiResult> {
    const { json, requestId } = await this.post<ResponsesBody>('/responses', {
      model: req.model,
      instructions: req.system,
      input: req.input,
      max_output_tokens: req.maxOutputTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      store: false,
      text: { format: { type: 'json_schema', name: req.schemaName, schema: req.jsonSchema, strict: true } },
    });
    return this.toResult(json, requestId, req.model);
  }

  async generateText(req: TextRequest): Promise<AiResult> {
    const { json, requestId } = await this.post<ResponsesBody>('/responses', {
      model: req.model,
      instructions: req.system,
      input: req.input,
      max_output_tokens: req.maxOutputTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      store: false,
    });
    return this.toResult(json, requestId, req.model);
  }

  async embed(req: { model: string; input: string[] }): Promise<EmbeddingResult> {
    const { json } = await this.post<{ data: { embedding: number[]; index: number }[]; model?: string; usage?: { prompt_tokens?: number } }>(
      '/embeddings',
      { model: req.model, input: req.input },
    );
    return {
      vectors: [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding),
      model: json.model ?? req.model,
      usage: { inputTokens: json.usage?.prompt_tokens ?? 0, cachedTokens: 0, outputTokens: 0 },
    };
  }
}
