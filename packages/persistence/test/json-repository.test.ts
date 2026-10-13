import { designReviewInput, designReviewOverview, recordDesignReview } from '../../../novel-service-core/src/design-review.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChapterWorkflow } from '../../application/src/index.ts';
import { JsonWorkRepository } from '../src/json-repository.ts';
import { passChecker } from '../../../novel-service-core/src/core.ts';
import type { ModelProvider } from '../../../novel-service-core/src/core.ts';
import { fixtureDesignReview, createReadyWork } from '../../application/test/fixtures.ts';

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
    const work = await createReadyWork(firstWorkflow, '可恢复作品');
    const reviewInput = designReviewInput(work, 'world');
    const report = await firstRepository.transaction(work.id, ({ work }) => recordDesignReview(work, reviewInput, fixtureDesignReview(reviewInput)));
    const candidate = await firstWorkflow.generate(work.id, 1, 'run-1');
    await firstWorkflow.check(work.id, candidate.id, [passChecker]);
    await firstWorkflow.adopt(work.id, candidate.id, 0);

    const secondRepository = new JsonWorkRepository(file);
    const restored = await secondRepository.get(work.id);
    assert.deepEqual(restored?.designContentReviews.get(report.id), report);
    assert.equal(designReviewOverview(restored!).areas[0].status, 'passed');
    assert.equal(restored?.currentVersion(1)?.content, '第1章');
    assert.equal(restored?.candidates.get(candidate.id)?.contentHash, candidate.contentHash);
    assert.equal(restored?.covenant.hook, '主角用寿命换一次胜利');
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

test('JSON restart resumes a review with exact sources and failed diagnostics intact', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'novel-review-'));
  const file = join(directory, 'state.json');
  const reviewer = { generateWorldPack: async () => { throw Error('unused'); }, generateStoryBible: async () => { throw Error('unused'); }, reviewDesignContent: async (input: Parameters<typeof fixtureDesignReview>[0]) => fixtureDesignReview(input) };
  try {
    const repository = new JsonWorkRepository(file);
    const workflow = new ChapterWorkflow(repository, provider, reviewer);
    const work = await createReadyWork(workflow);
    work.plans.get(work.activePlanId!)!.plan.chapters[0].summary = '巨大材料'.repeat(70000);
    await repository.save(work);
    const run = await workflow.startDesignReview(work.id, 'story');
    await workflow.stepDesignReview(work.id, run.id);
    const broken = new ChapterWorkflow(repository, provider, { ...reviewer, reviewDesignContent: async () => { throw Object.assign(Error('错误片段'), { modelResponses: ['无效模型原答'] }); } });
    await assert.rejects(() => broken.stepDesignReview(work.id, run.id), /错误片段/);
    const resumedRepository = new JsonWorkRepository(file);
    const resumed = new ChapterWorkflow(resumedRepository, provider, reviewer);
    const before = (await resumedRepository.get(work.id))!.designReviewRuns.get(run.id)!;
    assert.deepEqual(before.input, run.input);
    assert.equal(before.stages[0].attempts, 1);
    assert.deepEqual(before.stages[1].failures![0].modelResponses, ['无效模型原答']);
    let progress = await resumed.stepDesignReview(work.id, run.id);
    while (progress.status !== 'completed') progress = await resumed.stepDesignReview(work.id, run.id);
    const final = (await new JsonWorkRepository(file).get(work.id))!;
    assert.equal(final.designContentReviews.size, 1);
    assert.equal(final.designReviewRuns.get(run.id)!.stages[0].attempts, 1);
    assert.equal(final.designReviewRuns.get(run.id)!.stages[1].failures!.length, 1);
    assert.equal(final.versions.size, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
