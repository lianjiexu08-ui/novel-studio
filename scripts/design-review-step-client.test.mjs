import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceReview, parseReviewRetry } from './design-review-step-client.mjs';
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

test('restarting after a persisted failure never silently repeats the paid request', async () => {
  const failed = { ...before, id: 'review-a', status: 'failed', stages: [{ id: 'batch-1', completed: false, attempts: 3, error: 'bad citations' }] };
  let posts = 0;
  const post = async () => { posts++; return { status: 200 }; };
  for (const status of ['failed', 'ready']) {
    await assert.rejects(advanceReview({ before: { ...failed, status }, post }), /previous attempt/);
  }
  const retry = parseReviewRetry('{"runId":"review-a","stageId":"batch-1","attempts":3}');
  for (const mismatch of [{ ...retry, runId: 'review-b' }, { ...retry, stageId: 'batch-2' }, { ...retry, attempts: 2 }]) {
    await assert.rejects(advanceReview({ before: failed, post, retryFailedStage: mismatch }), /no longer matches/);
  }
  await assert.rejects(advanceReview({ before, post, retryFailedStage: retry }), /no longer matches/);
  await assert.rejects(advanceReview({ before: { ...failed, leaseExpiresAt: new Date(Date.now() + 60000).toISOString() }, post, retryFailedStage: retry }), /execution lease/);
  assert.equal(posts, 0);
  const recovered = { ...failed, status: 'ready', stages: [{ id: 'batch-1', completed: true, attempts: 4 }] };
  assert.equal(await advanceReview({ before: failed, post, read: async () => recovered, retryFailedStage: retry }), recovered);
  assert.equal(posts, 1);
  await assert.rejects(advanceReview({ before: { ...failed, stages: [{ ...failed.stages[0], attempts: 4 }] }, post, retryFailedStage: retry }), /no longer matches/);
  assert.equal(posts, 1, 'an inspected failure cannot authorize a later failure');
});

test('explicit retry configuration requires one exact persisted attempt', () => {
  assert.equal(parseReviewRetry(undefined), undefined);
  for (const value of ['', 'null', 'true', '[]', '{}', '{"runId":"r","stageId":"s","attempts":"3"}', '{"runId":"r","stageId":"s","attempts":-1}', '{"runId":"r","stageId":"s","attempts":1,"all":true}']) {
    assert.throws(() => parseReviewRetry(value));
  }
});
