import type { AiProvider, AiResult, EmbeddingResult, StructuredRequest, TextRequest } from './provider';

type Reply = string | Error | ((req: StructuredRequest | TextRequest) => string);

/**
 * Deterministic provider for tests and local demos: replies are queued per call. Records every request so
 * tests can assert on prompts. Embeddings are a stable hash projection so similar text is not required.
 */
export class FakeAiProvider implements AiProvider {
  readonly name = 'fake';
  readonly requests: (StructuredRequest | TextRequest)[] = [];
  private readonly replies: Reply[] = [];
  usage = { inputTokens: 1000, cachedTokens: 200, outputTokens: 100 };

  reply(...replies: Reply[]) {
    this.replies.push(...replies);
    return this;
  }

  private next(req: StructuredRequest | TextRequest): AiResult {
    this.requests.push(req);
    const r = this.replies.shift();
    if (r === undefined) throw new Error('FakeAiProvider: no reply queued');
    if (r instanceof Error) throw r;
    return { text: typeof r === 'function' ? r(req) : r, usage: { ...this.usage }, model: req.model, requestId: `fake-${this.requests.length}` };
  }

  async generateStructured(req: StructuredRequest) {
    return this.next(req);
  }

  async generateText(req: TextRequest) {
    return this.next(req);
  }

  async embed(req: { model: string; input: string[] }): Promise<EmbeddingResult> {
    return { vectors: req.input.map((text) => fakeEmbedding(text)), model: req.model, usage: { inputTokens: req.input.length * 10, cachedTokens: 0, outputTokens: 0 } };
  }
}

/** Bag-of-words hashing into 64 dims, L2-normalized: shared words → closer vectors. */
export function fakeEmbedding(text: string, dims = 64): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let h = 2166136261;
    for (const ch of word) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
    v[Math.abs(h) % dims]! += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}
