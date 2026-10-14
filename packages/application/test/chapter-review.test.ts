import test from 'node:test';
import assert from 'node:assert/strict';
import { ChapterWorkflow, InMemoryWorkRepository } from '../src/index.ts';
import { ChapterReviewError, chapterReviewChecker, chapterReviewInput, validateChapterReview } from '../../../novel-service-core/src/chapter-review.ts';
import { emptyUsage, passChecker, QualityGateError } from '../../../novel-service-core/src/core.ts';
import type { ModelProvider } from '../../../novel-service-core/src/core.ts';
import { createReadyWork, fixtureChapterReview } from './fixtures.ts';
import { OpenAICompatibleChapterProvider } from '../../planner/src/index.ts';
import { passingStageOutput } from '../../planner/test/chapter-review-fixture.ts';

const policy = { version: 'review-test', required: ['deterministic_rules', chapterReviewChecker] };
const writer: ModelProvider = { generateChapter: () => ({ content: '他按住伤口，放弃追击，先将同伴带回城中。', proposedEvents: [], observedEvents: [] }) };

test('chapter review refuses missing dimensions, wrong binding and unrelated plan evidence', async () => {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, writer);
  const work = await createReadyWork(workflow, '评审完整性');
  const candidate = await workflow.generate(work.id, 1, 'contract');
  const input = chapterReviewInput((await repository.get(work.id))!, candidate);
  const valid = await fixtureChapterReview(input);
  for (const mutate of [
    (r: typeof valid) => { r.checks.pop(); },
    (r: typeof valid) => { r.checks[1] = r.checks[0]; },
    (r: typeof valid) => { r.inputHash = 'old'; },
    (r: typeof valid) => { r.checks.find(c => c.criterion === 'obligations')!.evidence = r.checks[0].evidence.filter(e => e.sourceId !== 'brief'); },
    (r: typeof valid) => { r.checks[0].evidence = []; },
  ]) {
    const broken = structuredClone(valid); mutate(broken);
    assert.throws(() => validateChapterReview(broken, input), ChapterReviewError);
  }
});

test('missing, insufficient and failed independent reviews block manual and sequential adoption', async () => {
  for (const verdict of ['missing', 'insufficient', 'revise', 'invalid'] as const) {
    const repository = new InMemoryWorkRepository();
    const provider: ModelProvider = { ...writer, reviewChapterAsync: verdict === 'missing' ? undefined : async input => {
      const result = await fixtureChapterReview(input);
      if (verdict === 'invalid') result.checks[0].evidence[0].quote = '这句根本不在正文中';
      else Object.assign(result.checks[0], { verdict, revisionAdvice: '补全行动代价与因果' });
      return result;
    } };
    const workflow = new ChapterWorkflow(repository, provider, undefined, { checkPolicy: policy });
    const work = await createReadyWork(workflow, verdict);
    const candidate = await workflow.generate(work.id, 1, 'manual');
    await workflow.check(work.id, candidate.id, [passChecker]);
    await assert.rejects(() => workflow.adopt(work.id, candidate.id, 0), QualityGateError);
    await assert.rejects(() => workflow.runUntil(work.id, 3, [passChecker], 'sequential'), QualityGateError);
    const saved = (await repository.get(work.id))!;
    assert.equal(saved.versions.size, 0);
    assert.equal(saved.checkpoints.get('sequential')?.phase, 'paused');
    assert.equal(saved.checkpoints.get('sequential')?.nextChapter, 1);
    const report = saved.candidates.get(candidate.id)!.checks.find(c => c.checker === chapterReviewChecker)!;
    assert.equal(report.status, verdict === 'insufficient' ? 'inconclusive' : verdict === 'revise' ? 'failed' : 'unavailable');
  }
});

test('review runs outside transactions, invalidates earlier pass while pending, and rejects changed inputs', async () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const signal = new Promise<void>(resolve => { started = resolve; });
  let wait = false;
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, { ...writer, reviewChapterAsync: async input => {
    if (wait) { started(); await gate; }
    return fixtureChapterReview(input);
  } }, undefined, { checkPolicy: policy });
  const work = await createReadyWork(workflow, '绑定快照');
  const candidate = await workflow.generate(work.id, 1, 'candidate');
  await workflow.check(work.id, candidate.id, [passChecker]);
  wait = true;
  const pending = workflow.check(work.id, candidate.id, [passChecker]);
  await signal;
  await assert.rejects(() => workflow.adopt(work.id, candidate.id, 0), QualityGateError);
  // This transaction can commit while the model is parked; revision number stays unchanged deliberately.
  await repository.transaction(work.id, ({ work }) => { work.worldPack!.summary += '新的规则'; });
  release();
  await pending;
  const saved = (await repository.get(work.id))!;
  const review = saved.candidates.get(candidate.id)!.checks.find(c => c.checker === chapterReviewChecker)!;
  assert.equal(review.status, 'unavailable');
  assert.ok(review.chapterReview?.result, 'stale result and citations retained for audit');
  assert.notEqual(review.chapterReview!.inputHash, chapterReviewInput(saved, saved.candidates.get(candidate.id)!).inputHash);
  await assert.rejects(() => workflow.adopt(work.id, candidate.id, 0), QualityGateError);
});

test('passing review cannot authorize changed facts and failed attempt remains after later pass', async () => {
  let failing = true;
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, { ...writer, reviewChapterAsync: async input => {
    if (failing) throw Object.assign(new Error('模型超时'), { usage: { ...emptyUsage(), calls: 1, failedCalls: 1 } });
    return fixtureChapterReview(input);
  } }, undefined, { checkPolicy: policy });
  const work = await createReadyWork(workflow, '保留失败');
  const candidate = await workflow.generate(work.id, 1, 'candidate');
  await workflow.check(work.id, candidate.id, [passChecker]);
  failing = false;
  await workflow.check(work.id, candidate.id, [passChecker]);
  const saved = (await repository.get(work.id))!;
  const attempts = saved.candidates.get(candidate.id)!.checkRuns;
  assert.ok(attempts.some(c => c.chapterReview?.error === '模型超时' && c.chapterReview.usage?.calls === 1));
  await repository.transaction(work.id, ({ work }) => { work.candidates.get(candidate.id)!.proposedEvents.push({ eventType: 'resource_change', subjectId: 'stone', predicate: 'balance', value: 100 }); });
  await assert.rejects(() => workflow.adopt(work.id, candidate.id, 0), QualityGateError);
});

test('sequential writing reviews each chapter and honors pause received during review', async () => {
  const repository = new InMemoryWorkRepository();
  let workflow!: ChapterWorkflow;
  let workId = '';
  const reviewed: number[] = [];
  workflow = new ChapterWorkflow(repository, { ...writer, reviewChapterAsync: async input => {
    reviewed.push(input.chapterNumber);
    if (input.chapterNumber === 2) await workflow.controlRun(workId, 'book', 'pause');
    return { ...await fixtureChapterReview(input), usage: { ...emptyUsage(), calls: 1 } };
  } }, undefined, { checkPolicy: policy });
  workId = (await createReadyWork(workflow, '逐章暂停')).id;
  const checkpoint = await workflow.runUntil(workId, 3, [passChecker], 'book');
  assert.equal(checkpoint.phase, 'paused');
  assert.equal(checkpoint.nextChapter, 2);
  assert.equal(checkpoint.usage?.calls, 2);
  assert.deepEqual(reviewed, [1, 2]);
  const saved = (await repository.get(workId))!;
  assert.equal(saved.versions.size, 1);
  assert.equal(saved.currentVersion(2), undefined);
});

test('pause during a raw review stage saves that stage and resumes before adopting', async () => {
  const repository = new InMemoryWorkRepository();
  let calls = 0;
  let workId = '';
  let workflow!: ChapterWorkflow;
  const labels: string[] = [];
  const reviewer = new OpenAICompatibleChapterProvider('', '', '', 10, 5000, true, { completeWithUsage: async request => {
    labels.push(JSON.parse(request.user).stage.label);
    if (++calls === 1) await workflow.controlRun(workId, 'staged-book', 'pause');
    return { text: passingStageOutput(request), usage: { ...emptyUsage(), calls: 1 } };
  } });
  workflow = new ChapterWorkflow(repository, { ...writer, reviewChapterAsync: reviewer.reviewChapterAsync.bind(reviewer) }, undefined, { checkPolicy: policy });
  workId = (await createReadyWork(workflow, '分批暂停')).id;
  await repository.transaction(workId, ({ work }) => { work.worldPack!.summary = '完整规则不能截断。'.repeat(36_000); });
  const paused = await workflow.runUntil(workId, 1, [passChecker], 'staged-book');
  assert.equal(paused.phase, 'paused');
  assert.equal(calls, 1);
  assert.equal(paused.usage?.calls, 1, 'stage and final pause record must not count the same call twice');
  assert.equal((await repository.get(workId))!.versions.size, 0);
  const finished = await workflow.runUntil(workId, 1, [passChecker], 'staged-book');
  assert.equal(finished.phase, 'complete');
  assert.equal(labels.filter(label => label === labels[0]).length, 1);
  assert.equal((await repository.get(workId))!.versions.size, 1);
  assert.equal(finished.usage?.calls, calls);
});

test('failed staged review persists failed calls once alongside completed stage usage', async () => {
  const repository = new InMemoryWorkRepository();
  let calls = 0;
  const reviewer = new OpenAICompatibleChapterProvider('', '', '', 10, 5000, true, { completeWithUsage: async request => {
    if (++calls === 2) throw new Error('第二批连接中断');
    return { text: passingStageOutput(request), usage: { ...emptyUsage(), calls: 1, inputTokens: 43, outputTokens: 11, costUsd: 0.02 } };
  } });
  const workflow = new ChapterWorkflow(repository, { ...writer, reviewChapterAsync: reviewer.reviewChapterAsync.bind(reviewer) }, undefined, { checkPolicy: policy });
  const work = await createReadyWork(workflow, '失败批次计量');
  await repository.transaction(work.id, ({ work }) => { work.worldPack!.summary = '完整规则不能截断。'.repeat(36_000); });
  await assert.rejects(() => workflow.runUntil(work.id, 1, [passChecker], 'failed-stages'), QualityGateError);
  const saved = (await repository.get(work.id))!;
  const expected = { calls: 2, failedCalls: 1, inputTokens: 43, outputTokens: 11, costUsd: 0.02, costKnown: false };
  assert.deepEqual(saved.checkpoints.get('failed-stages')!.usage, expected);
  const records = [...saved.candidates.values()][0].checkRuns.map(c => c.chapterReview).filter(Boolean);
  assert.deepEqual(records.find(r => r?.stage?.error)?.progress?.usage, expected);
  assert.deepEqual(records.at(-1)?.usage, expected, 'final history retains the full invocation usage, not just its uncounted remainder');
  assert.equal(saved.versions.size, 0);
});

test('late chapter reports remain historical and cannot replace a newer review', async () => {
  for (const lateVerdict of ['pass', 'revise'] as const) {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const signal = new Promise<void>(resolve => { started = resolve; });
    let calls = 0;
    const repository = new InMemoryWorkRepository();
    const workflow = new ChapterWorkflow(repository, { ...writer, reviewChapterAsync: async input => {
      const first = ++calls === 1;
      if (first) { started(); await gate; }
      const result = await fixtureChapterReview(input);
      const verdict = first ? lateVerdict : lateVerdict === 'pass' ? 'revise' : 'pass';
      if (verdict === 'revise') Object.assign(result.checks[0], { verdict, revisionAdvice: '补足转折因果' });
      return result;
    } }, undefined, { checkPolicy: policy });
    const work = await createReadyWork(workflow, '并发正文检查');
    const candidate = await workflow.generate(work.id, 1, 'concurrent');
    const old = workflow.check(work.id, candidate.id, [passChecker]);
    await signal;
    await workflow.check(work.id, candidate.id, [passChecker]);
    const currentId = (await repository.get(work.id))!.candidates.get(candidate.id)!.checks.find(c => c.checker === chapterReviewChecker)!.id;
    release(); await old;
    const saved = (await repository.get(work.id))!.candidates.get(candidate.id)!;
    assert.equal(saved.checks.find(c => c.checker === chapterReviewChecker)?.id, currentId);
    const historical = saved.checkRuns.at(-1)!;
    assert.equal(historical.chapterReview?.superseded, true);
    assert.equal(historical.status, 'unavailable');
    assert.equal(historical.chapterReview?.result?.checks[0].verdict, lateVerdict);
    if (lateVerdict === 'pass') await assert.rejects(() => workflow.adopt(work.id, candidate.id, 0), QualityGateError);
    else assert.equal((await workflow.adopt(work.id, candidate.id, 0)).version.chapterNumber, 1);
  }
});

test('late raw stages cannot interrupt a newer review or become its resume checkpoint', async () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const signal = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  const reviewer = new OpenAICompatibleChapterProvider('', '', '', 10, 5000, true, { completeWithUsage: async request => {
    if (++calls === 1) { started(); await gate; }
    return { text: passingStageOutput(request), usage: { ...emptyUsage(), calls: 1 } };
  } });
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, { ...writer, reviewChapterAsync: reviewer.reviewChapterAsync.bind(reviewer) }, undefined, { checkPolicy: policy });
  const work = await createReadyWork(workflow, '迟到批次');
  await repository.transaction(work.id, ({ work }) => { work.worldPack!.summary = '完整规则不能截断。'.repeat(36_000); });
  const candidate = await workflow.generate(work.id, 1, 'staged-concurrent');
  const old = workflow.check(work.id, candidate.id, [passChecker]);
  await signal;
  await workflow.check(work.id, candidate.id, [passChecker]);
  const callsAfterNew = calls;
  const currentId = (await repository.get(work.id))!.candidates.get(candidate.id)!.checks.find(c => c.checker === chapterReviewChecker)!.id;
  release(); await old;
  const saved = (await repository.get(work.id))!.candidates.get(candidate.id)!;
  assert.equal(calls, callsAfterNew, 'superseded run must stop after saving its in-flight stage');
  assert.equal(saved.checks.find(c => c.checker === chapterReviewChecker)?.id, currentId);
  assert.ok(saved.checkRuns.some(c => c.chapterReview?.superseded && c.chapterReview.stage?.result));
  await workflow.check(work.id, candidate.id, [passChecker]);
  assert.equal(calls, callsAfterNew, 'resume must reuse the newer completed run, not the late checkpoint');
  assert.equal((await workflow.adopt(work.id, candidate.id, 0)).version.chapterNumber, 1);
});
