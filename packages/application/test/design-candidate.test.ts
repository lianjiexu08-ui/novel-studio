import test from 'node:test';
import assert from 'node:assert/strict';
import { ChapterWorkflow, InMemoryWorkRepository, DesignCandidateValidationError } from '../src/index.ts';
import { PlanConflictError } from '../../../novel-service-core/src/planning.ts';
import { designReviewInput, recordDesignReview } from '../../../novel-service-core/src/design-review.ts';
import { createDesignReviewRun } from '../../../novel-service-core/src/design-review-run.ts';
import { passChecker } from '../../../novel-service-core/src/core.ts';
import { createReadyWork, chapterBody, fixtureDesignReview } from './fixtures.ts';

const writer = { generateChapter: ({ chapterNumber }: { chapterNumber: number }) => ({ content: chapterBody(chapterNumber), proposedEvents: [], observedEvents: [] }) };
async function fixture() {
  const repository = new InMemoryWorkRepository(), workflow = new ChapterWorkflow(repository, writer);
  const work = await createReadyWork(workflow, '整体修订');
  return { repository, workflow, work, baseline: await workflow.designCandidate(work.id) };
}

test('a complete repair saves bound proposed revisions and retains approved history, prose and negative reviews', async () => {
  const { workflow, work, baseline } = await fixture();
  const prose = await workflow.generate(work.id, 1, 'original');
  await workflow.check(work.id, prose.id, [passChecker]);
  await workflow.adopt(work.id, prose.id, 0);
  const input = designReviewInput(work, 'power', baseline.basePlanId), review = fixtureDesignReview(input);
  review.checks[0].verdict = 'revise'; review.checks[0].revisionAdvice = '补技能资格';
  const report = recordDesignReview(work, input, review), run = createDesignReviewRun(input);
  work.designReviewRuns.set(run.id, run);
  const before = structuredClone(work);
  baseline.candidate.worldPack.summary += '新增治疗限制。';
  baseline.candidate.plan.openQuestions.push({ id: 'repair', question: '仍待正式复核', blocking: true, status: 'open' });
  const submitted = structuredClone(baseline);
  const result = await workflow.saveDesignCandidate(work.id, baseline);
  assert.equal(result.worldPack.revision, before.worldPack!.revision + 1);
  assert.equal(result.storyBible.worldPackRevision, result.worldPack.revision);
  assert.equal(result.plan.worldPackRevision, result.worldPack.revision);
  assert.equal(result.plan.storyBibleRevision, result.storyBible.revision);
  assert.deepEqual([result.worldPack.status, result.storyBible.status, result.plan.status], ['proposed', 'proposed', 'proposed']);
  assert.equal(result.worldPack.lockedAt, undefined);
  assert.equal(result.contentReview.ready, false);
  assert.equal(result.validation.blockers.length, 1);
  assert.deepEqual(result.plan.plan.openQuestions, submitted.candidate.plan.openQuestions);
  assert.equal(work.activePlanId, before.activePlanId);
  assert.deepEqual(work.plans.get(before.activePlanId!), before.plans.get(before.activePlanId!));
  for (const key of ['versions', 'events', 'manuscripts', 'candidates', 'designReviewRuns', 'designContentReviews'] as const) assert.deepEqual(work[key], before[key], key);
  assert.deepEqual(work.designContentReviews.get(report.id), before.designContentReviews.get(report.id));
  for (const [id, revision] of before.designHistory) assert.deepEqual(work.designHistory.get(id), revision);
  assert.deepEqual(baseline, submitted, 'caller-owned input is not mutated');
});

test('invalid final document, unknown fields, normalization and inconsistent volume layout leave all state untouched', async () => {
  const { workflow, work, baseline } = await fixture();
  for (const mutate of [
    (x: typeof baseline.candidate) => { x.plan.milestones.push({ id: 'oversize', title: '错误', kind: 'turn', startChapter: 1, endChapter: 2, setup: ['字'.repeat(510)], cost: '代价', outcome: '后果' }); },
    (x: typeof baseline.candidate) => { Object.assign(x.storyBible, { unrecognizedAuthorText: '不能静默删除' }); },
    (x: typeof baseline.candidate) => { x.plan.chapters[0].id = 'custom-id'; },
    (x: typeof baseline.candidate) => { x.storyBible.volumes[0].plannedChapterCount = 11; },
  ]) {
    const next = structuredClone(baseline), before = structuredClone(work);
    next.candidate.worldPack.summary += '试改'; mutate(next.candidate);
    await assert.rejects(() => workflow.saveDesignCandidate(work.id, next), DesignCandidateValidationError);
    assert.deepEqual(structuredClone(work), before);
  }
});

test('stale world edits and competing whole-design editors cannot overwrite a newer baseline', async () => {
  const { workflow, work, baseline } = await fixture();
  await workflow.saveWorldPack(work.id, { ...work.worldPack!, summary: '另一编辑者刚保存的世界' });
  const before = structuredClone(work);
  await assert.rejects(() => workflow.saveDesignCandidate(work.id, baseline), PlanConflictError);
  assert.deepEqual(structuredClone(work), before);
  const fresh = await workflow.designCandidate(work.id);
  fresh.candidate.storyBible.worldPackRevision = fresh.candidate.worldPack.revision;
  const results = await Promise.allSettled([workflow.saveDesignCandidate(work.id, fresh), workflow.saveDesignCandidate(work.id, fresh)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.some(r => r.status === 'rejected' && r.reason instanceof PlanConflictError));
  assert.equal(work.plans.size, before.plans.size + 1);
});
