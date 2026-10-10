import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelTimeoutError } from '../../model-gateway/src/index.ts';
import { FailoverPlanningClient, type UsageReportingClient } from '../src/index.ts';

const usage = { calls: 1, failedCalls: 0, inputTokens: 1, outputTokens: 2, costUsd: 0, costKnown: false };
const input = { system: 'json', user: '{}', maxOutputTokens: 10 };

function channel(result: string | Error, seen: string[], name: string): { name: string; client: UsageReportingClient } {
  return {
    name,
    client: {
      completeWithUsage: async () => {
        seen.push(name);
        if (result instanceof Error) throw result;
        return { text: result, usage };
      },
    },
  };
}

test('overload on the active channel moves on to the next backup', async () => {
  const seen: string[] = [];
  const switched: string[] = [];
  const client = new FailoverPlanningClient([
    channel(new Error('openai-compatible request failed (stream): Our servers are currently overloaded. Please try again later.'), seen, '主渠道'),
    channel(new ModelTimeoutError('model produced no output for 1000ms'), seen, '备用一'),
    channel('{"ok":true}', seen, '备用二'),
  ], (from, to) => switched.push(`${from}->${to}`));
  const result = await client.completeWithUsage(input);
  assert.equal(result.text, '{"ok":true}');
  assert.deepEqual(seen, ['主渠道', '备用一', '备用二']);
  assert.deepEqual(switched, ['主渠道->备用一', '备用一->备用二']);
  assert.equal(result.usage.failedCalls, 2);
});

test('a bad request is not retried on another channel', async () => {
  const seen: string[] = [];
  const client = new FailoverPlanningClient([
    channel(new Error('openai-compatible request failed (400): invalid model'), seen, '主渠道'),
    channel('{"ok":true}', seen, '备用'),
  ]);
  await assert.rejects(() => client.complete(input), /400/);
  assert.deepEqual(seen, ['主渠道']);
});

test('when every channel is overloaded the last error is returned', async () => {
  const seen: string[] = [];
  const client = new FailoverPlanningClient([
    channel(new Error('openai-compatible request failed (429): rate limit'), seen, '主渠道'),
    channel(new ModelTimeoutError('model produced no output for 1000ms'), seen, '备用'),
  ]);
  await assert.rejects(() => client.complete(input), ModelTimeoutError);
  assert.deepEqual(seen, ['主渠道', '备用']);
});
