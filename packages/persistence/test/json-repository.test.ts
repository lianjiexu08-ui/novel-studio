import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChapterWorkflow } from '../../application/src/index.ts';
import { JsonWorkRepository } from '../src/json-repository.ts';
import { passChecker } from '../../../novel-service-core/src/core.ts';
import type { ModelProvider } from '../../../novel-service-core/src/core.ts';

const provider: ModelProvider = {
  generateChapter: ({ chapterNumber }) => {
    const event = { eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: chapterNumber, storyTime: chapterNumber, evidence: 'paragraph 1' };
    return { content: `第${chapterNumber}章`, proposedEvents: [event], observedEvents: [event] };
  },
};

test('JSON repository survives restart with adopted version and outbox', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'novel-studio-'));
  const file = join(directory, 'state.json');
  try {
    const firstRepository = new JsonWorkRepository(file);
    const firstWorkflow = new ChapterWorkflow(firstRepository, provider);
    const work = await firstWorkflow.createWork('可恢复作品');
    const candidate = await firstWorkflow.generate(work.id, 1, 'run-1');
    await firstWorkflow.check(work.id, candidate.id, [passChecker]);
    await firstWorkflow.adopt(work.id, candidate.id, 0);

    const secondRepository = new JsonWorkRepository(file);
    const restored = await secondRepository.get(work.id);
    assert.equal(restored?.currentVersion(1)?.content, '第1章');
    assert.equal(restored?.covenant.hook, '');
    assert.equal(restored?.covenant.targetLength, '长篇，篇幅未定');
    assert.equal(((await secondRepository.outbox())).length, 3);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('failed transaction restores work and outbox snapshot', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'novel-studio-'));
  const file = join(directory, 'state.json');
  try {
    const repository = new JsonWorkRepository(file);
    const workflow = new ChapterWorkflow(repository, provider);
    const work = await workflow.createWork('回滚作品');
    await assert.rejects(() => repository.transaction(work.id, ({ work: transactionWork, enqueue }) => {
      transactionWork.stateRevision = 99;
      enqueue({ dedupeKey: 'must-not-persist', workId: work.id, kind: 'projection', aggregateId: work.id, payload: {} });
      throw new Error('rollback');
    }));
    assert.equal((await repository.get(work.id))?.stateRevision, 0);
    assert.equal((await repository.outbox()).length, 0);
    const restored = new JsonWorkRepository(file);
    assert.equal((await restored.get(work.id))?.stateRevision, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
