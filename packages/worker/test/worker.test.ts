import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTaskStore, WorkerRunner } from '../src/index.ts';

test('deduplicates outbox retries and keeps completion idempotent', () => {
  let now = 1000;
  const store = new InMemoryTaskStore(() => now);
  const first = store.enqueue({ workId: 'w', kind: 'projection', dedupeKey: 'projection:v1' });
  const duplicate = store.enqueue({ workId: 'w', kind: 'projection', dedupeKey: 'projection:v1' });
  assert.equal(duplicate.id, first.id);
  const claimed = store.claim('worker-a', 100);
  assert.equal(claimed?.id, first.id);
  const done = store.complete(first.id, 'worker-a', { ok: true });
  assert.deepEqual(store.complete(first.id, 'worker-a', { ignored: true }).result, done.result);
});

test('expired lease is recovered and can be claimed again', () => {
  let now = 1000;
  const store = new InMemoryTaskStore(() => now);
  const task = store.enqueue({ workId: 'w', kind: 'generate_chapter', dedupeKey: 'chapter:1' });
  store.claim('worker-a', 10);
  now = 1011;
  assert.equal(store.recoverExpiredLeases(), 1);
  assert.equal(store.claim('worker-b', 10)?.id, task.id);
});

test('same work is serial while different works can be claimed', () => {
  const store = new InMemoryTaskStore(() => 1000);
  const first = store.enqueue({ workId: 'w1', kind: 'generate_chapter', dedupeKey: 'w1:1' });
  const second = store.enqueue({ workId: 'w1', kind: 'generate_chapter', dedupeKey: 'w1:2' });
  const other = store.enqueue({ workId: 'w2', kind: 'generate_chapter', dedupeKey: 'w2:1' });
  assert.equal(store.claim('worker-a', 100)?.id, first.id);
  assert.equal(store.claim('worker-b', 100)?.id, other.id);
  assert.equal(store.list({ status: 'queued' }).some((task) => task.id === second.id), true);
});

test('runner retries a failed task without losing the task record', async () => {
  const store = new InMemoryTaskStore(() => 1000);
  const task = store.enqueue({ workId: 'w', kind: 'review', dedupeKey: 'review:v1' });
  const runner = new WorkerRunner(store, 100);
  await assert.rejects(() => runner.runNext('worker-a', () => { throw new Error('temporary'); }));
  assert.equal(store.get(task.id)?.status, 'queued');
  const done = await runner.runNext('worker-a', () => ({ passed: true }));
  assert.equal(done?.status, 'succeeded');
});
