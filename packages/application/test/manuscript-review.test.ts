import test from 'node:test';
import assert from 'node:assert/strict';
import { ChapterWorkflow, InMemoryWorkRepository } from '../src/index.ts';
import { passChecker, type ModelProvider } from '../../../novel-service-core/src/core.ts';
import { chapterReviewChecker } from '../../../novel-service-core/src/chapter-review.ts';
import { createReadyWork, fixtureChapterReview } from './fixtures.ts';

const policy = { version: 'manuscript-review', required: ['deterministic_rules', chapterReviewChecker] };
const provider: ModelProvider = {
  generateChapter: ({ chapterNumber }) => {
    const events = chapterNumber === 10 ? [
      { eventType: 'arc_progress', subjectId: 'arc', predicate: 'status', value: { status: 'resolved' } },
      { eventType: 'volume_progress', subjectId: 'vol-1', predicate: 'status', value: { status: 'resolved' } },
    ] : [];
    return { content: `第${chapterNumber}章：他放弃追击，带同伴回城。`, proposedEvents: events, observedEvents: events };
  },
  reviewChapterAsync: fixtureChapterReview,
};

test('finalization under the current policy rejects chapters adopted without independent review', async () => {
  const repository = new InMemoryWorkRepository();
  const legacy = new ChapterWorkflow(repository, provider);
  const work = await createReadyWork(legacy, '旧正文不能直接验收');
  await legacy.runUntil(work.id, 10, [passChecker], 'legacy');
  await legacy.finalizeManuscript(work.id);
  const before = JSON.stringify([...(await repository.get(work.id))!.manuscripts]);
  const current = new ChapterWorkflow(repository, provider, undefined, { checkPolicy: policy });
  await assert.rejects(() => current.finalizeManuscript(work.id), /正文评审/);
  assert.equal(JSON.stringify([...(await repository.get(work.id))!.manuscripts]), before);
  const versions = (await repository.get(work.id))!.adoptedVersions();
  for (const version of versions) await current.check(work.id, version.sourceCandidateId!, [passChecker]);
  const verified = await current.finalizeManuscript(work.id);
  assert.deepEqual(verified.chapterVersionIds, versions.map(version => version.id), 'legacy prose can be independently reviewed without inventing old reviews or rewriting accepted history');
});

test('finalization verifies retained review inputs after later chapters change the live state', async () => {
  const repository = new InMemoryWorkRepository();
  let calls = 0;
  const workflow = new ChapterWorkflow(repository, { ...provider, reviewChapterAsync: async input => {
    calls += 1;
    return fixtureChapterReview(input);
  } }, undefined, { checkPolicy: policy });
  const work = await createReadyWork(workflow, '每章评审后冻结');
  await workflow.runUntil(work.id, 10, [passChecker], 'reviewed');
  const manuscript = await workflow.finalizeManuscript(work.id);
  assert.equal(manuscript.chapterCount, 10);
  assert.equal(calls, 10, 'freezing uses saved evidence, without re-reviewing every old chapter');
  const saved = (await repository.get(work.id))!;
  const candidate = saved.candidates.get(saved.currentVersion(1)!.sourceCandidateId!)!;
  const check = candidate.checks.find(item => item.checker === chapterReviewChecker)!;
  const original = structuredClone(check.chapterReview!);
  const before = JSON.stringify([...saved.manuscripts]);
  const rejected = async () => {
    await assert.rejects(() => workflow.finalizeManuscript(work.id), /正文评审/);
    assert.equal(JSON.stringify([...saved.manuscripts]), before);
  };
  delete check.chapterReview!.input; await rejected();
  check.chapterReview = structuredClone(original);
  check.chapterReview.input!.sources.find(source => source.id === 'draft')!.text += '错误的原稿'; await rejected();
  check.chapterReview = structuredClone(original);
  check.chapterReview.result!.checks[0].evidence[0].quote = '此引文不在所审原稿中'; await rejected();
  check.chapterReview = structuredClone(original);
  check.chapterReview.result!.checks.pop(); await rejected();
  check.chapterReview = structuredClone(original);
  check.chapterReview.input!.candidateId = 'another-candidate'; await rejected();
  check.chapterReview = structuredClone(original);
  check.chapterReview.input!.sources.find(source => source.id === 'bible')!.text += '未被引文覆盖的设定篡改'; await rejected();
  check.chapterReview = original;
  assert.equal((await workflow.finalizeManuscript(work.id)).revision, manuscript.revision + 1);
});

test('a later negative chapter review blocks a new final manuscript and preserves the old one', async () => {
  const repository = new InMemoryWorkRepository();
  let negative = false;
  const workflow = new ChapterWorkflow(repository, { ...provider, reviewChapterAsync: async input => {
    const result = await fixtureChapterReview(input);
    if (negative) Object.assign(result.checks[0], { verdict: 'revise', revisionAdvice: '补齐救人行动的因果' });
    return result;
  } }, undefined, { checkPolicy: policy });
  const work = await createReadyWork(workflow, '复评返修不得成稿');
  await workflow.runUntil(work.id, 10, [passChecker], 'reviewed');
  await workflow.finalizeManuscript(work.id);
  const saved = (await repository.get(work.id))!;
  const before = JSON.stringify([...saved.manuscripts]);
  negative = true;
  await workflow.check(work.id, saved.currentVersion(1)!.sourceCandidateId!, [passChecker]);
  await assert.rejects(() => workflow.finalizeManuscript(work.id), /正文评审/);
  assert.equal(JSON.stringify([...saved.manuscripts]), before);
});
