import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChapterWorkflow, InMemoryWorkRepository } from '../src/index.ts';
import { JsonWorkRepository } from '../../persistence/src/json-repository.ts';
import { ChapterReviewError, chapterReviewChecker, chapterReviewInput, validateChapterReview } from '../../../novel-service-core/src/chapter-review.ts';
import { emptyUsage, passChecker, QualityGateError, type ModelProvider } from '../../../novel-service-core/src/core.ts';
import { effectiveBrief, planContentHash, reviewBookPlan } from '../../../novel-service-core/src/planning.ts';
import { bookPlanSchema, chapterBriefDtoSchema } from '../../contracts/src/planning.ts';
import { checkResultDtoSchema } from '../../contracts/src/api.ts';
import { OpenAICompatibleChapterProvider } from '../../planner/src/index.ts';
import { passingStageOutput } from '../../planner/test/chapter-review-fixture.ts';
import { approveMinimalPlan, createReadyWork, fixtureChapterReview, minimalPlan } from './fixtures.ts';

const writer: ModelProvider = { generateChapter: () => ({ content: '他先付两成真元，再切断绳索；伤腿仍痛，便停手让同伴搬走木箱。', proposedEvents: [], observedEvents: [] }) };
function checkedPlan() {
  const plan = minimalPlan();
  plan.openQuestions = [{ id: 'spell-cost', question: '施术须支付代价并遵守伤势限制', blocking: false, status: 'open' }];
  plan.chapters[0].executionChecks = [
    { id: 'pay-before-casting', requirement: '正文呈现先支付两成真元再切绳，不将预付成本退回。', sourceQuestion: { document: 'plan', questionId: 'spell-cost' } },
    { id: 'injury-limit', requirement: '腿伤仍限制行动，搬箱由同伴承担，不因停术自动痊愈。' },
  ];
  return plan;
}

test('execution requirements survive contracts and immutable plan storage without changing legacy hashes', async () => {
  const plan = checkedPlan();
  assert.deepEqual(bookPlanSchema.parse(plan), plan);
  const legacy = bookPlanSchema.parse(minimalPlan()), before = planContentHash(legacy);
  assert.ok(!('executionChecks' in bookPlanSchema.parse(legacy).chapters[0]));
  assert.equal(planContentHash(bookPlanSchema.parse(legacy)), before);
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer);
  const work = await createReadyWork(workflow, '逐项义务', plan);
  const brief = effectiveBrief(work, 1)!.brief;
  assert.deepEqual(chapterBriefDtoSchema.parse(brief).executionChecks, plan.chapters[0].executionChecks);
  assert.deepEqual(effectiveBrief(work, 2)!.brief.executionChecks, undefined, 'requirements apply only to their chapter');
  const changed = structuredClone(plan); changed.chapters[0].executionChecks![0].requirement += '不得借未来库存支付。';
  assert.notEqual(planContentHash(changed), planContentHash(plan));
  assert.equal(work.plans.get(work.activePlanId!)!.plan.openQuestions[0].status, 'open', 'adding an execution check never resolves its source');
});

test('brief edits cannot erase the approved execution requirements', async () => {
  const plan = checkedPlan(), workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer);
  const work = await createReadyWork(workflow, '任务卡不可绕过', plan);
  await workflow.confirmBrief(work.id, 1, { mustDo: ['自由发挥'], executionChecks: [] } as Parameters<typeof workflow.confirmBrief>[2]);
  assert.deepEqual(effectiveBrief(work, 1)!.brief.executionChecks, plan.chapters[0].executionChecks);
  const candidate = await workflow.generate(work.id, 1, 'bound');
  assert.deepEqual(candidate.brief?.executionChecks, plan.chapters[0].executionChecks);
});

test('duplicate checks and dangling question references cannot be approved', async () => {
  const duplicate = checkedPlan(); duplicate.chapters[0].executionChecks!.push(duplicate.chapters[0].executionChecks![0]);
  assert.ok(reviewBookPlan(duplicate).some(issue => issue.code === 'EXECUTION_CHECK_INVALID'));
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer);
  const work = await createReadyWork(workflow, '来源必须存在');
  const plan = checkedPlan(); plan.chapters[0].executionChecks![0].sourceQuestion!.questionId = 'missing';
  const revision = await workflow.savePlan(work.id, { plan, baseRevisionId: work.activePlanId });
  const review = await workflow.reviewPlan(work.id, revision.id);
  assert.ok(review.issues.some(issue => issue.code === 'REFERENCE_UNKNOWN'));
  await assert.rejects(() => workflow.approvePlan(work.id, revision.id));
});

for (const failure of ['missing-reviewer', 'omit', 'duplicate', 'wrong-citation', 'revise', 'insufficient'] as const) {
  test(`execution checks require independent evidence even without a global review policy: ${failure}`, async () => {
    const provider: ModelProvider = { ...writer, reviewChapterAsync: failure === 'missing-reviewer' ? undefined : async input => {
      const result = await fixtureChapterReview(input);
      const index = result.checks.findIndex(check => check.criterion === 'execution/injury-limit');
      if (failure === 'omit') result.checks.splice(index, 1);
      else if (failure === 'duplicate') result.checks[index] = result.checks[index - 1];
      else if (failure === 'wrong-citation') result.checks[index].evidence = result.checks[index].evidence.filter(e => e.sourceId !== 'draft');
      else Object.assign(result.checks[index], { verdict: failure, revisionAdvice: '补足实际行动和伤势后果' });
      return result;
    } };
    const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), provider);
    const work = await createReadyWork(workflow, failure, checkedPlan());
    const candidate = await workflow.generate(work.id, 1, failure);
    await workflow.check(work.id, candidate.id, [passChecker]);
    await assert.rejects(() => workflow.adopt(work.id, candidate.id, 0), QualityGateError);
    assert.equal(work.versions.size, 0);
    assert.ok(work.candidates.get(candidate.id)!.checks.some(check => check.checker === chapterReviewChecker));
    if (failure === 'omit') {
      await assert.rejects(() => workflow.runUntil(work.id, 2, [passChecker], 'sequential-checks'), QualityGateError);
      assert.equal(work.checkpoints.get('sequential-checks')?.phase, 'paused');
      assert.equal(work.checkpoints.get('sequential-checks')?.nextChapter, 1);
      assert.equal(work.versions.size, 0);
    }
  });
}

test('a stripped rubric cannot reuse a passing report to hide an execution requirement', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer);
  const work = await createReadyWork(workflow, '不能删标准', checkedPlan());
  const candidate = await workflow.generate(work.id, 1, 'rubric');
  const input = chapterReviewInput(work, candidate);
  delete input.rubric['execution/injury-limit'];
  assert.throws(() => validateChapterReview({ inputHash: input.inputHash, summary: '通过', checks: [] }, input), ChapterReviewError);
});

test('linking an execution item does not resolve or bypass its blocking design question', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer);
  const work = await createReadyWork(workflow, '设计问题仍需独立验收');
  const plan = checkedPlan(); plan.openQuestions[0].blocking = true;
  const revision = await workflow.savePlan(work.id, { plan, baseRevisionId: work.activePlanId });
  const review = await workflow.reviewPlan(work.id, revision.id);
  assert.ok(review.issues.some(issue => issue.code === 'BLOCKING_QUESTION'));
  await assert.rejects(() => workflow.approvePlan(work.id, revision.id));
  assert.equal(revision.plan.openQuestions[0].status, 'open');
});

test('saved per-item passes survive a JSON restart, but changing the approved requirement stales the candidate', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'novel-execution-checks-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'work.json'), provider: ModelProvider = { ...writer, reviewChapterAsync: fixtureChapterReview };
  const workflow = new ChapterWorkflow(new JsonWorkRepository(path), provider);
  const work = await createReadyWork(workflow, '逐项重启', checkedPlan());
  const candidate = await workflow.generate(work.id, 1, 'review');
  await workflow.check(work.id, candidate.id, [passChecker]);
  const restored = new ChapterWorkflow(new JsonWorkRepository(path), provider);
  const snapshot = await restored.snapshot(work.id), saved = snapshot.candidates.get(candidate.id)!;
  const report = saved.checks.find(check => check.checker === chapterReviewChecker)!.chapterReview!;
  assert.equal(report.result?.checks.filter(check => check.criterion.startsWith('execution/')).length, 2);
  assert.deepEqual(saved.brief?.executionChecks, checkedPlan().chapters[0].executionChecks);
  assert.equal(validateChapterReview(report.result, report.input!).checks.length, 8);
  const changed = checkedPlan(); changed.chapters[0].executionChecks![1].requirement += '不得擅自跑跳。';
  await approveMinimalPlan(restored, work.id, changed);
  await assert.rejects(() => restored.adopt(work.id, candidate.id, 0));
});

test('staged chapter reviews retain every execution item across interrupted raw batches', async () => {
  let calls = 0, fail = true;
  const reviewer = new OpenAICompatibleChapterProvider('', '', '', 10, 5000, true, { completeWithUsage: async request => {
    if (++calls === 2 && fail) throw new Error('interrupted execution review');
    return { text: passingStageOutput(request), usage: { ...emptyUsage(), calls: 1 } };
  } });
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), { ...writer, reviewChapterAsync: reviewer.reviewChapterAsync.bind(reviewer) });
  const work = await createReadyWork(workflow, '逐项分批恢复', checkedPlan());
  work.worldPack!.summary = '规则原文不得截断。'.repeat(36_000);
  const candidate = await workflow.generate(work.id, 1, 'staged');
  await workflow.check(work.id, candidate.id, [passChecker]);
  await assert.rejects(() => workflow.adopt(work.id, candidate.id, 0), QualityGateError);
  const prefix = work.candidates.get(candidate.id)!.checkRuns.filter(check => check.chapterReview?.stage?.result);
  assert.equal(prefix.length, 1);
  fail = false;
  await workflow.check(work.id, candidate.id, [passChecker]);
  const check = work.candidates.get(candidate.id)!.checks.find(check => check.checker === chapterReviewChecker)!;
  assert.equal(check.status, 'passed', check.message);
  assert.equal(check.chapterReview?.result?.checks.filter(check => check.criterion.startsWith('execution/')).length, 2);
  await workflow.adopt(work.id, candidate.id, 0);
  assert.equal(work.versions.size, 1);
});

test('manuscript finalization requires intact per-item review evidence without a global policy', async () => {
  let reviewCalls = 0;
  const provider: ModelProvider = {
    generateChapter: ({ chapterNumber }) => {
      const events = chapterNumber === 10 ? [
        { eventType: 'arc_progress', subjectId: 'arc', predicate: 'status', value: { status: 'resolved' } },
        { eventType: 'volume_progress', subjectId: 'vol-1', predicate: 'status', value: { status: 'resolved' } },
      ] : [];
      return { content: `第${chapterNumber}章：他先支付真元再切绳，仍让同伴搬箱。`, proposedEvents: events, observedEvents: events };
    },
    reviewChapterAsync: async input => { reviewCalls++; return fixtureChapterReview(input); },
  };
  const repository = new InMemoryWorkRepository(), workflow = new ChapterWorkflow(repository, provider);
  const work = await createReadyWork(workflow, '最终书稿逐项验收', checkedPlan());
  await workflow.runUntil(work.id, 10, [passChecker], 'manuscript-items');
  assert.equal(reviewCalls, 1, 'only chapter one carries explicit requirements');
  const manuscript = await workflow.finalizeManuscript(work.id);
  const candidate = work.candidates.get(work.currentVersion(1)!.sourceCandidateId!)!;
  const check = candidate.checks.find(item => item.checker === chapterReviewChecker)!;
  assert.equal(checkResultDtoSchema.parse(check).chapterReview?.result?.checks.length, 8, 'API preserves every custom result');
  const original = structuredClone(check.chapterReview!), before = JSON.stringify([...work.manuscripts]);
  const rejected = async () => {
    await assert.rejects(() => workflow.finalizeManuscript(work.id), /正文评审/);
    assert.equal(JSON.stringify([...work.manuscripts]), before);
  };
  delete check.chapterReview; await rejected();
  check.chapterReview = structuredClone(original);
  check.chapterReview.result!.checks.pop(); await rejected();
  check.chapterReview = structuredClone(original);
  delete check.chapterReview.input!.rubric['execution/injury-limit']; await rejected();
  check.chapterReview = original;
  assert.equal((await workflow.finalizeManuscript(work.id)).revision, manuscript.revision + 1);
  assert.equal(reviewCalls, 1, 'finalization validates retained evidence without another model call');
});

test('all 24 execution requirements survive large-material synthesis, including a last-item revision', async () => {
  const plan = checkedPlan();
  plan.chapters[0].executionChecks = Array.from({ length: 24 }, (_, index) => ({
    id: `limit_${index}`, requirement: '人物行动须符合当场资源与伤情限制。'.repeat(50),
  }));
  let firstRaw = true, synthesisCalls = 0;
  const reviewer = new OpenAICompatibleChapterProvider('', '', '', 100, 5000, true, { completeWithUsage: async request => {
    // Shape/evidence fixture only. This does not assess the prose or simulate literary approval.
    const input = JSON.parse(request.user), result = JSON.parse(passingStageOutput(request));
    const origins = new Map<string, string>(input.sources.flatMap((source: { id: string; origin?: { sourceId: string }; fragments: Array<{ id: string }> }) =>
      source.fragments.map(fragment => [fragment.id, source.origin?.sourceId ?? source.id])));
    for (const check of result.checks) {
      const extra = check.criterion.startsWith('execution/') || check.criterion === 'obligations' ? 'brief'
        : check.criterion === 'power' ? 'world' : ['characters', 'continuity'].includes(check.criterion) ? 'bible' : undefined;
      check.evidence = check.evidence.filter((e: { fragmentId: string }) => input.stage.kind === 'synthesis'
        ? origins.get(e.fragmentId)?.startsWith('review-result/')
        : origins.get(e.fragmentId) === 'draft' || origins.get(e.fragmentId) === extra);
    }
    if (input.stage.kind === 'synthesis') synthesisCalls++;
    else if (firstRaw) {
      firstRaw = false;
      Object.assign(result.checks.find((check: { criterion: string }) => check.criterion === 'execution/limit_23'), {
        verdict: 'revise', explanation: '最后一项仍缺少行动代价', revisionAdvice: '补写伤情导致的实际选择与损失',
      });
    }
    return { text: JSON.stringify(result), usage: { ...emptyUsage(), calls: 1 } };
  } });
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), { ...writer, reviewChapterAsync: reviewer.reviewChapterAsync.bind(reviewer) });
  const work = await createReadyWork(workflow, '上限不得漏审末项', plan);
  work.worldPack!.summary = '规则原文不得截断。'.repeat(36_000);
  const candidate = await workflow.generate(work.id, 1, 'maximum-requirements');
  await workflow.check(work.id, candidate.id, [passChecker]);
  const check = work.candidates.get(candidate.id)!.checks.find(check => check.checker === chapterReviewChecker)!;
  assert.ok(synthesisCalls > 0, 'large material must reach synthesis');
  assert.equal(check.status, 'failed', check.message);
  assert.equal(check.chapterReview?.error, undefined, 'the review completed; it did not merely fail on capacity');
  const checks = checkResultDtoSchema.parse(check).chapterReview!.result!.checks;
  assert.equal(checks.length, 30, 'all six standard and 24 execution results survive the API');
  assert.equal(checks.find(item => item.criterion === 'execution/limit_23')?.verdict, 'revise', 'later passing syntheses cannot erase the raw negative');
  assert.equal(validateChapterReview(check.chapterReview!.result, check.chapterReview!.input!).checks.length, 30);
  await assert.rejects(() => workflow.adopt(work.id, candidate.id, 0), QualityGateError);
  assert.equal(work.versions.size, 0);
});
