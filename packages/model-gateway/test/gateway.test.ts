import test from 'node:test';
import assert from 'node:assert/strict';
import { BudgetExceededError, ModelGateway, UsageLedger, redactSecrets } from '../src/index.ts';
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

test('secret-like values are redacted from log payloads', () => {
  const safe = redactSecrets({ apiKey: 'sk-1234567890abcdef', authorization: 'Bearer abc', nested: 'AIza123456789012345678901234' }) as Record<string, unknown>;
  assert.equal(safe.apiKey, '[REDACTED]');
  assert.equal(safe.authorization, '[REDACTED]');
  assert.equal(safe.nested, '[REDACTED]');
});
