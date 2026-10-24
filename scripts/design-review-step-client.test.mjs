import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceReview } from './design-review-step-client.mjs';
const before = { status: 'ready', inputHash: 'hash', scope: { planRevisionId: 'plan' }, stages: [{ id: 'batch-1', completed: false, attempts: 0 }] };
const done = { ...before, stages: [{ id: 'batch-1', completed: true, attempts: 1 }] };

test('lost response reconciles a saved stage without a second POST', async () => {
  let calls = 0;
  const result = await advanceReview({ before, post: async () => { calls++; throw new Error('socket closed'); }, read: async () => done });
  assert.equal(result, done); assert.equal(calls, 1);
});
test('lost response waits for live execution rather than issuing another stage', async () => {
  let reads = 0, posts = 0, waits = 0;
  const result = await advanceReview({ before, post: async () => { posts++; throw new Error('timeout'); },
    read: async () => ++reads === 1 ? { ...before, status: 'running', leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() } : done,
    wait: async () => { waits++; } });
  assert.equal(result, done); assert.equal(posts, 1); assert.equal(waits, 1);
});
test('durable failure preserves the diagnostic and stops without retry', async () => {
  let calls = 0;
  await assert.rejects(advanceReview({ before, post: async () => { calls++; return { status: 502 }; }, read: async () => ({ ...before, status: 'failed', stages: [{ id: 'batch-1', completed: false, attempts: 1, error: 'bad citations' }] }) }), /bad citations/);
  assert.equal(calls, 1);
});
test('existing lease prevents dispatch; missing or changed baseline fails closed', async () => {
  let calls = 0;
  await assert.rejects(advanceReview({ before: { ...before, status: 'running' }, post: async () => { calls++; } }), /execution lease/);
  assert.equal(calls, 0);
  for (const state of [undefined, { ...done, inputHash: 'changed' }, { ...done, status: 'outdated' }]) {
    await assert.rejects(advanceReview({ before, post: async () => ({ status: 200 }), read: async () => state }), /baseline/);
  }
});
test('expired lease or unknown outcome stops for inspection', async () => {
  await assert.rejects(advanceReview({ before, post: async () => { throw new Error('socket closed'); }, read: async () => before }), /socket closed/);
  await assert.rejects(advanceReview({ before, post: async () => ({ status: 409 }), read: async () => ({ ...before, status: 'running', leaseExpiresAt: new Date(0).toISOString() }) }), /lease expired/);
});
