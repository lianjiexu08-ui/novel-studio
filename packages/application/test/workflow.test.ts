import test from 'node:test';
import assert from 'node:assert/strict';
import { ChapterWorkflow, InMemoryWorkRepository } from '../src/index.ts';
import { passChecker, unavailableChecker } from '../../../novel-service-core/src/core.ts';
import type { ModelProvider } from '../../../novel-service-core/src/core.ts';

const provider: ModelProvider = {
  generateChapter: ({ chapterNumber }) => {
    const event = { eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: chapterNumber, storyTime: chapterNumber, evidence: 'paragraph 1' };
    return { content: `章节 ${chapterNumber}`, proposedEvents: [event], observedEvents: [event] };
  },
};

test('adoption writes outbox projections only after the transaction passes', async () => {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, provider);
  const work = await workflow.createWork('事务作品');
  const candidate = await workflow.generate(work.id, 1, 'run-1');
  await workflow.check(work.id, candidate.id, [passChecker]);
  const result = await workflow.adopt(work.id, candidate.id, 0);
  assert.equal(result.version.chapterNumber, 1);
  assert.equal(result.outbox.length, 3);
  assert.deepEqual(((await repository.outbox())).map((event) => event.kind).sort(), ['export', 'projection', 'search_index']);
});

test('blocked adoption does not create outbox events', async () => {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, provider);
  const work = await workflow.createWork('阻断作品');
  const candidate = await workflow.generate(work.id, 1, 'run-1');
  await workflow.check(work.id, candidate.id, [passChecker, unavailableChecker]);
  await assert.rejects(() => workflow.adopt(work.id, candidate.id, 0));
  assert.equal(((await repository.outbox())).length, 0);
});

test('stale state revision blocks an adoption request', async () => {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, provider);
  const work = await workflow.createWork('版本作品');
  const candidate = await workflow.generate(work.id, 1, 'run-1');
  await workflow.check(work.id, candidate.id, [passChecker]);
  await assert.rejects(() => workflow.adopt(work.id, candidate.id, 99));
  assert.equal(work.versions.size, 0);
});

test('same-work transactions are serialized', async () => {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, provider);
  const work = await workflow.createWork('串行作品');
  const order: string[] = [];
  const first = repository.transaction(work.id, async () => { order.push('first-start'); await new Promise((resolve) => setTimeout(resolve, 20)); order.push('first-end'); });
  const second = repository.transaction(work.id, async () => { order.push('second'); });
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
});
