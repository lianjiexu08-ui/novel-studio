import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CheckpointStore } from './checkpoint.mjs';
import { PersistentQueue } from './queue.mjs';

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-service-spike-'));
  let clock = 1_000;
  return {
    directory,
    queueFile: path.join(directory, 'queue.json'),
    checkpointFile: path.join(directory, 'checkpoint.json'),
    now: () => clock,
    advance(ms) {
      clock += ms;
    },
  };
}

test('restarts recover a leased task and adoption remains exactly once', async () => {
  const f = fixture();
  const q1 = new PersistentQueue(f.queueFile, { leaseMs: 10, now: f.now });
  const checkpoints = new CheckpointStore(f.checkpointFile, { now: f.now });
  const queued = q1.enqueue({
    workId: 'book-a',
    kind: 'adopt',
    dedupeKey: 'adopt:chapter-001:v1',
    payload: { chapterId: 'chapter-001', version: 'v1', content: '正文' },
  });
  const claimed = q1.claim('worker-before-crash');
  assert.equal(claimed.id, queued.id);

  // Simulate the durable write succeeding immediately before process death.
  const firstAdoption = checkpoints.adoptChapter({
    workId: 'book-a',
    chapterId: 'chapter-001',
    version: 'v1',
    content: '正文',
    taskId: claimed.id,
  });
  assert.equal(firstAdoption.adopted, true);

  f.advance(11);
  const q2 = new PersistentQueue(f.queueFile, { leaseMs: 10, now: f.now });
  const recovered = await q2.runNext('worker-after-restart', async (task) => {
    const result = checkpoints.adoptChapter({
      workId: task.workId,
      chapterId: task.payload.chapterId,
      version: task.payload.version,
      content: task.payload.content,
      taskId: task.id,
    });
    return result;
  });
  assert.equal(recovered.status, 'succeeded');
  assert.equal(recovered.result.alreadyAdopted, true);
  assert.equal(checkpoints.getWork('book-a').chapters.length, 1);
  assert.equal(q2.list({ status: 'succeeded' }).length, 1);
});

test('tasks from different works can run, while one work remains serial', () => {
  const f = fixture();
  const queue = new PersistentQueue(f.queueFile, { leaseMs: 100, now: f.now });
  const a1 = queue.enqueue({ workId: 'book-a', dedupeKey: 'chapter:1', payload: {} });
  const a2 = queue.enqueue({ workId: 'book-a', dedupeKey: 'chapter:2', payload: {} });
  const b1 = queue.enqueue({ workId: 'book-b', dedupeKey: 'chapter:1', payload: {} });

  const first = queue.claim('worker-1');
  const second = queue.claim('worker-2');
  assert.equal(first.id, a1.id);
  assert.equal(second.id, b1.id, 'book-b is independent of book-a');
  assert.equal(queue.claim('worker-3'), null, 'book-a chapter 2 waits for chapter 1');

  queue.complete(first.id, 'worker-1');
  const third = queue.claim('worker-3');
  assert.equal(third.id, a2.id);
});

test('enqueue deduplicates a task after a caller retries the request', () => {
  const f = fixture();
  const queue = new PersistentQueue(f.queueFile, { now: f.now });
  const first = queue.enqueue({ workId: 'book-a', kind: 'adopt', dedupeKey: 'chapter:1', payload: { x: 1 } });
  const duplicate = queue.enqueue({ workId: 'book-a', kind: 'adopt', dedupeKey: 'chapter:1', payload: { x: 999 } });
  assert.equal(duplicate.id, first.id);
  assert.equal(queue.list().length, 1);
});

