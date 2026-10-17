import test from 'node:test';
import assert from 'node:assert/strict';
import { designReviewChapterTimes } from '../src/design-review-scope.ts';
import { createDesignReviewRun, designReviewStageInput, acceptDesignReviewStage, completeDesignReviewRun } from '../src/design-review-run.ts';
import { validateDesignReview, type DesignReviewInput, type DesignReviewResult } from '../src/design-review.ts';

const source = (id: string, value: unknown) => ({ id, text: JSON.stringify(value) });
const input = (): DesignReviewInput => ({ area: 'story', inputHash: 'a'.repeat(64),
  scope: { worldPackRevision: 1, storyBibleRevision: 1, planRevisionId: 'p', planRevision: 1 }, rubric: { timeline: '核对实际行动时间' },
  sources: [
    source('plan/chapters/39', { chapterNumber: 39, storyTime: '第229日至第230日', summary: '239日前不可握剑。' }),
    source('plan/chapters/42', { chapterNumber: 42, storyTime: '第239日至第243日', summary: '239日复测五成，试注后实际吐纳回五成。' }),
    source('plan/chapters/44', { chapterNumber: 44, storyTime: '第244日戌初至入夜；承接43章', summary: '沿用239日复测的五成，一式后余三成。' }),
  ] });
const pass = (request: DesignReviewInput): DesignReviewResult => ({ summary: 'Schedule test fixture only', checks: [{
  criterion: 'timeline', verdict: 'pass', explanation: 'Fixture for restoration, not a real quality judgment',
  evidence: [{ sourceId: request.sources[0].id, quote: request.sources[0].text.slice(0, 40) }], revisionAdvice: '',
}] });

test('time navigation separates chapter numbers from days and retains conflicting declarations verbatim', () => {
  const original = input();
  original.sources.push(
    source('story/chapterPlans/mirror', { chapterNumber: 42, storyTime: '  插叙：第230日\n回到第244日  ' }),
    source('plan/chapters/99', { chapterNumber: 12, storyTime: '同日午后' }),
    source('plan/chapters/missing-number', { storyTime: '第239日' }),
    source('plan/chapters/summary-only', { chapterNumber: 45, summary: '第245日，不能从正文猜字段。' }),
    source('plan/chapters/invalid', { chapterNumber: 0, storyTime: '第239日' }),
    source('plan/chapters/numeric', { chapterNumber: 46, storyTime: 246 }),
    source('plan/chapters/blank', { chapterNumber: 47, storyTime: '  ' }),
    source('world/axioms/time', { chapterNumber: 48, storyTime: '非章纲不得收录' }),
    { id: 'plan/chapters/broken', text: '{invalid' },
  );
  const before = JSON.stringify(original), times = designReviewChapterTimes(original);
  assert.deepEqual(times, [
    { sourceId: 'plan/chapters/39', chapterNumber: 39, storyTime: '第229日至第230日' },
    { sourceId: 'plan/chapters/42', chapterNumber: 42, storyTime: '第239日至第243日' },
    { sourceId: 'plan/chapters/44', chapterNumber: 44, storyTime: '第244日戌初至入夜；承接43章' },
    { sourceId: 'story/chapterPlans/mirror', chapterNumber: 42, storyTime: '  插叙：第230日\n回到第244日  ' },
    { sourceId: 'plan/chapters/99', chapterNumber: 12, storyTime: '同日午后' },
  ]);
  times[0].storyTime = '不能修改原文';
  assert.equal(JSON.stringify(original), before);
});

test('v32 navigation survives full staged restoration without altering v31 coverage or accepting index citations', () => {
  const original = input();
  original.sources.push({ id: 'large', text: '其他完整原文。'.repeat(45000) });
  const old = createDesignReviewRun(original, undefined, 31), run = createDesignReviewRun(original, old.createdAt, 32);
  assert.equal(run.scheduleVersion, 32);
  assert.deepEqual(run.units, old.units);
  assert.deepEqual(run.stages, old.stages);
  const prior = designReviewStageInput(old, old.stages[0]);
  assert.equal(prior.stage!.coverage!.chapterTimes, undefined);
  const expected = designReviewChapterTimes(original);
  for (const stage of run.stages) {
    const request = designReviewStageInput(run, stage);
    assert.deepEqual(request.stage!.coverage!.chapterTimes, expected);
    const restored = JSON.parse(JSON.stringify(run));
    assert.deepEqual(designReviewStageInput(restored, restored.stages.find((s: { id: string }) => s.id === stage.id)), request);
    const invalid = pass(request);
    invalid.checks[0].evidence = [{ sourceId: 'coverage.chapterTimes', quote: '第239日至第243日' }];
    assert.throws(() => validateDesignReview(request, invalid));
    acceptDesignReviewStage(run, stage, pass(request));
  }
  assert.deepEqual(completeDesignReviewRun(JSON.parse(JSON.stringify(run))), completeDesignReviewRun(run));
  assert.deepEqual(designReviewStageInput(old, old.stages[0]), prior);
});

test('oversized time navigation is omitted as a whole while every original byte remains covered', () => {
  const original = input();
  original.sources.push(source('plan/chapters/100', { chapterNumber: 100, storyTime: '很长的原始时间说明'.repeat(6000) }));
  const run = createDesignReviewRun(original), request = designReviewStageInput(run, run.stages[0]);
  assert.equal(request.stage!.coverage!.chapterTimes, undefined);
  assert.equal(request.stage!.coverage!.chapterTimesOmitted, 'capacity');
  assert.ok(JSON.stringify(request.stage!.coverage).length <= 40000);
  for (const raw of original.sources) {
    const units = run.units.filter(unit => unit.sourceId === raw.id);
    assert.equal(units.map(unit => raw.text.slice(unit.start, unit.end)).join(''), raw.text);
    assert.ok(units.every(unit => run.stages.some(stage => stage.kind === 'batch' && stage.unitIds.includes(unit.id))));
  }
});

test('prose review retains its existing default schedule and never adds design time navigation', () => {
  const original = { ...input(), purpose: 'chapter_review' as const };
  assert.equal(createDesignReviewRun(original).scheduleVersion, 31);
  const explicit = createDesignReviewRun(original, undefined, 32);
  assert.equal(designReviewStageInput(explicit, explicit.stages[0]).stage!.coverage!.chapterTimes, undefined);
});
