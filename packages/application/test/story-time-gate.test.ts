import test from 'node:test';
import assert from 'node:assert/strict';
import { ChapterWorkflow, InMemoryWorkRepository } from '../src/index.ts';
import { PlanGateError, planContentHash } from '../../../novel-service-core/src/planning.ts';
import { createReadyWork } from './fixtures.ts';
import { validateDesignCandidate } from '../src/design-candidate.ts';

const writer = { generateChapter() { throw new Error('No generation expected'); } };

test('review and candidate validation locate a contradictory clock pair; a corrected proposal passes', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer);
  const work = await createReadyWork(workflow, '时辰核验');
  const baseline = await workflow.designCandidate(work.id);
  baseline.candidate.plan.chapters[0].storyTime = '第188日酉初19:00交班';
  const invalid = validateDesignCandidate(baseline.candidate);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.some(issue => issue.code === 'STORY_TIME_MISMATCH'));
  const saved = await workflow.savePlan(work.id, { plan: baseline.candidate.plan, baseRevisionId: baseline.basePlanId });
  const review = await workflow.reviewPlan(work.id, saved.id);
  assert.equal(review.passed, false);
  assert.equal(review.issues.find(issue => issue.code === 'STORY_TIME_MISMATCH')?.chapterNumber, 1);
  await assert.rejects(workflow.approvePlan(work.id, saved.id), PlanGateError);
  baseline.candidate.plan.chapters[0].storyTime = '第188日戌初19:00交班';
  assert.equal(validateDesignCandidate(baseline.candidate).valid, true);
  const fixed = await workflow.savePlan(work.id, { plan: baseline.candidate.plan, baseRevisionId: saved.id });
  assert.equal((await workflow.reviewPlan(work.id, fixed.id)).passed, true);
});

test('historical passing reviews and approvals cannot bypass the new time check', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer);
  const work = await createReadyWork(workflow, '旧审核时间门禁');
  const plan = work.plans.get(work.activePlanId!)!;
  // Reconstruct an old, consistently hashed record accepted before this rule.
  plan.plan.chapters[0].storyTime = '酉初19:00交班';
  plan.contentHash = planContentHash(plan.plan);
  plan.reviews.at(-1)!.contentHash = plan.contentHash;
  assert.equal(plan.reviews.at(-1)!.passed, true);
  const before = structuredClone(plan);
  await assert.rejects(workflow.approvePlan(work.id, plan.id), /酉初19:00/);
  const blockers = await workflow.readiness(work.id, 1);
  assert.ok(blockers.some(blocker => blocker.code === 'PLAN_OUTDATED' && /酉初19:00/.test(blocker.message)));
  assert.deepEqual(plan, before, 'readiness must retain historical approval and review');
});
