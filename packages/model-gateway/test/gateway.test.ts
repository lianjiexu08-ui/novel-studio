import test from 'node:test';
import assert from 'node:assert/strict';
import { BudgetExceededError, ModelGateway, ModelTimeoutError, OpenAICompatibleAdapter, UsageLedger, redactSecrets } from '../src/index.ts';
import type { ModelAdapter, ModelRequest, ModelResponse } from '../src/index.ts';

const request: ModelRequest = { role: 'writing', model: 'fake', system: 'system', user: 'write', estimatedCostUsd: 0.1 };

test('gateway records usage and routes by provider', async () => {
  const adapter: ModelAdapter = { provider: 'fake', complete: async (input) => ({ text: input.user.toUpperCase(), usage: { inputTokens: 2, outputTokens: 3, costUsd: 0.1 }, provider: 'fake', model: input.model }) };
  const ledger = new UsageLedger(1);
  const gateway = new ModelGateway(new Map([['fake', adapter]]), ledger);
  const response = await gateway.complete(request, 'fake', { endpoint: 'unused', apiKey: 'secret' });
  assert.equal(response.text, 'WRITE');
  assert.equal(gateway.usage()[0].costUsd, 0.1);
});

test('budget blocks an estimated overage before provider call', async () => {
  let called = false;
  const adapter: ModelAdapter = { provider: 'fake', complete: async () => { called = true; return {} as ModelResponse; } };
  const gateway = new ModelGateway(new Map([['fake', adapter]]), new UsageLedger(0.05));
  await assert.rejects(() => gateway.complete(request, 'fake', { endpoint: '', apiKey: 'secret' }), BudgetExceededError);
  assert.equal(called, false);
});

test('failed calls count against the call cap and output tokens are capped across roles', async () => {
  let fail = true;
  const adapter: ModelAdapter = {
    provider: 'fake',
    complete: async (input) => {
      if (fail) throw new Error('provider down');
      return { text: 'ok', usage: { inputTokens: 10, outputTokens: 40, costUsd: 0 }, provider: 'fake', model: input.model };
    },
  };
  const ledger = new UsageLedger(Number.POSITIVE_INFINITY, undefined, { maxCalls: 3, maxOutputTokens: 100 });
  const gateway = new ModelGateway(new Map([['fake', adapter]]), ledger);
  const credential = { endpoint: '', apiKey: 'secret' };
  await assert.rejects(() => gateway.complete({ ...request, estimatedCostUsd: 0, maxOutputTokens: 50 }, 'fake', credential), /provider down/);
  fail = false;
  await gateway.complete({ ...request, role: 'planning', estimatedCostUsd: 0, maxOutputTokens: 50 }, 'fake', credential);
  await assert.rejects(() => gateway.complete({ ...request, role: 'extraction', estimatedCostUsd: 0, maxOutputTokens: 70 }, 'fake', credential), /output token limit/);
  await gateway.complete({ ...request, role: 'extraction', estimatedCostUsd: 0, maxOutputTokens: 10 }, 'fake', credential);
  await assert.rejects(() => gateway.complete({ ...request, estimatedCostUsd: 0 }, 'fake', credential), /call limit/);
  const summary = gateway.summary();
  assert.equal(summary.calls, 3);
  assert.equal(summary.failedCalls, 1);
  assert.equal(summary.byRole.writing?.failedCalls, 1);
  assert.equal(summary.outputTokens, 80);
  assert.equal(summary.costKnown, false, 'tokens without a price leave the cost unknown');
});

test('a billed response over budget is still recorded before reporting the overage', async () => {
  const adapter: ModelAdapter = { provider: 'fake', complete: async (input) => ({ text: 'x', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.5 }, provider: 'fake', model: input.model }) };
  const ledger = new UsageLedger(0.2);
  const gateway = new ModelGateway(new Map([['fake', adapter]]), ledger);
  await assert.rejects(() => gateway.complete({ ...request, estimatedCostUsd: 0 }, 'fake', { endpoint: '', apiKey: 'secret' }), BudgetExceededError);
  assert.equal(ledger.spent, 0.5);
});

test('a lost response leaves costs unknown even when a later retry has a price', async () => {
  let calls = 0;
  const adapter: ModelAdapter = { provider: 'fake', complete: async () => {
    if (++calls === 1) throw new Error('connection lost after request was sent');
    return { text: 'ok', usage: { inputTokens: 2, outputTokens: 3, costUsd: 0.1 }, provider: 'fake', model: 'fake' };
  } };
  const gateway = new ModelGateway(new Map([['fake', adapter]]), new UsageLedger(1));
  assert.equal(gateway.summary().costKnown, true);
  await assert.rejects(() => gateway.complete(request, 'fake', { endpoint: '', apiKey: 'secret' }), /connection lost/);
  assert.equal(gateway.summary().costUsd, 0);
  assert.equal(gateway.summary().costKnown, false, 'no billing response does not prove the failed call was free');
  await gateway.complete(request, 'fake', { endpoint: '', apiKey: 'secret' });
  assert.equal(gateway.summary().costUsd, 0.1);
  assert.equal(gateway.summary().costKnown, false, 'a priced retry cannot resolve the failed call cost');
  assert.equal(gateway.summary().failedCalls, 1);
});

test('secret-like values are redacted from log payloads', () => {
  const safe = redactSecrets({ apiKey: 'sk-1234567890abcdef', authorization: 'Bearer abc', nested: 'AIza123456789012345678901234' }) as Record<string, unknown>;
  assert.equal(safe.apiKey, '[REDACTED]');
  assert.equal(safe.authorization, '[REDACTED]');
  assert.equal(safe.nested, '[REDACTED]');
});

function sse(chunks: string[], gapMs: number): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        await new Promise((resolve) => setTimeout(resolve, gapMs));
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

test('a streamed answer longer than the timeout survives while chunks keep arriving', async () => {
  const pieces = ['{"a"', ':', '1', ',"b":', '2}'];
  const chunks = pieces.map((piece, index) => `data: ${JSON.stringify({ id: 'r1', choices: [{ delta: { content: piece } }], ...(index === pieces.length - 1 ? { usage: { prompt_tokens: 3, completion_tokens: 5 } } : {}) })}\n\n`);
  const adapter = new OpenAICompatibleAdapter(async () => sse([...chunks, 'data: [DONE]\n\n'], 15), 40);
  const started = Date.now();
  const response = await adapter.complete(request, { endpoint: 'https://example.test/v1', apiKey: 'secret' });
  assert.ok(Date.now() - started > 40, 'total time exceeded the idle timeout');
  assert.equal(response.text, '{"a":1,"b":2}');
  assert.equal(response.usage.outputTokens, 5);
  assert.equal(response.requestId, 'r1');
});

test('a stream that goes silent longer than the timeout is reported as a timeout', async () => {
  const adapter = new OpenAICompatibleAdapter(async (_url, init) => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '{' } }] })}\n\n`));
        init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }, 20);
  await assert.rejects(() => adapter.complete(request, { endpoint: 'https://example.test/v1', apiKey: 'secret' }), ModelTimeoutError);
});

test('DONE finishes a split stream without waiting for the connection or cancellation to close', async () => {
  let cancelled = false;
  const adapter = new OpenAICompatibleAdapter(async (_url, init) => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"id":"done-1","choices":[{"delta":{"content":"完整答案"}}]}\r\n\r\n'));
        controller.enqueue(encoder.encode('data: {"choices":[],"usage":{"prompt_tokens":17,"completion_tokens":4}}\n\ndata: [DO'));
        controller.enqueue(encoder.encode('NE]\r\n\ndata: {"choices":[{"delta":{"content":"ignored"}}]}\n\n'));
        init?.signal?.addEventListener('abort', () => {
          if (!cancelled) controller.error(new Error('connection never closed'));
        });
      },
      cancel() { cancelled = true; return new Promise(() => {}); },
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  }, 100);
  const ledger = new UsageLedger(1);
  const gateway = new ModelGateway(new Map([['openai-compatible', adapter]]), ledger);
  const response = await gateway.complete(request, 'openai-compatible', { endpoint: 'https://example.test/v1', apiKey: 'secret' });
  assert.equal(response.text, '完整答案');
  assert.equal(response.requestId, 'done-1');
  assert.equal(response.usage.inputTokens, 17);
  assert.equal(response.usage.outputTokens, 4);
  assert.equal(cancelled, true);
  assert.equal(ledger.summary().calls, 1);
  assert.equal(ledger.summary().failedCalls, 0);
});

test('DONE without content still fails and cancels the reader', async () => {
  let cancelled = false;
  const adapter = new OpenAICompatibleAdapter(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  await assert.rejects(() => adapter.complete(request, { endpoint: 'https://example.test/v1', apiKey: 'secret' }), /no message content/);
  assert.equal(cancelled, true);
});

test('an endpoint that ignores stream and returns JSON is still accepted', async () => {
  const adapter = new OpenAICompatibleAdapter(async () => new Response(JSON.stringify({ id: 'j1', choices: [{ message: { content: 'plain' } }], usage: { completion_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } }), 1000);
  const response = await adapter.complete(request, { endpoint: 'https://example.test/v1', apiKey: 'secret' });
  assert.equal(response.text, 'plain');
});

test('openai-compatible requests abort after the configured timeout', async () => {
  const adapter = new OpenAICompatibleAdapter(async (_url, init) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (init?.signal?.aborted) throw new Error('aborted by test fetcher');
    throw new Error('fetcher should have been aborted');
  }, 5);
  await assert.rejects(() => adapter.complete(request, { endpoint: 'https://example.test/v1', apiKey: 'secret' }), ModelTimeoutError);
});
