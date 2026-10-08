import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenAiProvider } from './openai';
import { AiProviderError } from './provider';

function fakeFetch(responses: { status: number; body: unknown; headers?: Record<string, string> }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', ...r.headers } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ok = {
  id: 'resp_1',
  status: 'completed',
  model: 'gpt-x',
  output: [{ type: 'message', content: [{ type: 'output_text', text: '{"a":' }, { type: 'output_text', text: '1}' }] }],
  usage: { input_tokens: 120, output_tokens: 8, input_tokens_details: { cached_tokens: 100 } },
};

test('sends a strict json_schema Responses request and parses text and usage', async () => {
  const f = fakeFetch([{ status: 200, body: ok, headers: { 'x-request-id': 'req_9' } }]);
  const p = new OpenAiProvider({ apiKey: 'sk-test', fetchImpl: f.impl });
  const r = await p.generateStructured({
    model: 'gpt-x',
    system: 'sys',
    input: 'hello',
    jsonSchema: { type: 'object' },
    schemaName: 'thing',
    maxOutputTokens: 200,
  });
  assert.equal(r.text, '{"a":1}');
  assert.deepEqual(r.usage, { inputTokens: 120, cachedTokens: 100, outputTokens: 8 });
  assert.equal(r.requestId, 'req_9');

  const call = f.calls[0]!;
  assert.equal(call.url, 'https://api.openai.com/v1/responses');
  assert.equal((call.init.headers as Record<string, string>).authorization, 'Bearer sk-test');
  const body = JSON.parse(String(call.init.body));
  assert.deepEqual(body.text, { format: { type: 'json_schema', name: 'thing', schema: { type: 'object' }, strict: true } });
  assert.equal(body.instructions, 'sys');
  assert.equal(body.store, false);
});

test('retries 429 and 5xx, honouring Retry-After', async () => {
  const waits: number[] = [];
  const f = fakeFetch([
    { status: 429, body: {}, headers: { 'retry-after': '2' } },
    { status: 503, body: {} },
    { status: 200, body: ok },
  ]);
  const p = new OpenAiProvider({ apiKey: 'k', fetchImpl: f.impl, sleep: async (ms) => void waits.push(ms) });
  await p.generateText({ model: 'm', system: 's', input: 'i', maxOutputTokens: 10 });
  assert.equal(f.calls.length, 3);
  assert.deepEqual(waits, [2000, 1000]);
});

test('maps auth failures without echoing the provider body', async () => {
  const f = fakeFetch([{ status: 401, body: { error: { message: 'Incorrect API key provided: sk-secret' } } }]);
  const p = new OpenAiProvider({ apiKey: 'k', fetchImpl: f.impl });
  await assert.rejects(
    p.generateText({ model: 'm', system: 's', input: 'i', maxOutputTokens: 10 }),
    (e: unknown) => e instanceof AiProviderError && e.code === 'AI_AUTH_FAILED' && !e.message.includes('sk-secret'),
  );
});

test('treats a truncated response as an error', async () => {
  const f = fakeFetch([{ status: 200, body: { ...ok, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } }]);
  const p = new OpenAiProvider({ apiKey: 'k', fetchImpl: f.impl });
  await assert.rejects(p.generateText({ model: 'm', system: 's', input: 'i', maxOutputTokens: 10 }), /cut off/);
});

test('embeds in input order', async () => {
  const f = fakeFetch([
    { status: 200, body: { data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }], usage: { prompt_tokens: 7 } } },
  ]);
  const p = new OpenAiProvider({ apiKey: 'k', fetchImpl: f.impl });
  const r = await p.embed({ model: 'emb', input: ['a', 'b'] });
  assert.deepEqual(r.vectors, [[1], [2]]);
  assert.equal(r.usage.inputTokens, 7);
});
