import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesignReviewRun, designReviewStageInput, acceptDesignReviewStage, completeDesignReviewRun, type DesignReviewRun } from '../../../novel-service-core/src/design-review-run.ts';
import { validateDesignReview, type DesignReviewInput, type DesignReviewResult } from '../../../novel-service-core/src/design-review.ts';
import { JsonDesignPlanner } from '../../planner/src/index.ts';

const originalQuestion = 'cross-1-2/causality';
function answer(input: DesignReviewInput): DesignReviewResult {
  return { summary: '范围验证用结论', checks: [{ criterion: 'causality', verdict: 'pass', explanation: '按本批实际原文核对，不能以目录替代来源。',
    evidence: [{ sourceId: input.sources[0].id, quote: input.sources[0].text.slice(0, 40) }], revisionAdvice: '' }] };
}
function fixture(version: 33 | 34 = 34, cited = true) {
  const input: DesignReviewInput = { area: 'story', inputHash: 'a'.repeat(64),
    scope: { worldPackRevision: 1, storyBibleRevision: 1, planRevisionId: 'plan', planRevision: 1 },
    rubric: { causality: '核对动作是否符合承力规则' }, sources: [
      { id: 'world/axioms/rule', text: '轻物只能在未承重时御动；箱子由船桩、水手与撬杠承重。' },
      ...[1, 2, 3, 4].flatMap(chapterNumber => [
        { id: `plan/chapters/${chapterNumber}`, text: JSON.stringify({ chapterNumber, content: `第${chapterNumber}章完整原文。`.repeat(8000) }) },
        { id: `story/chapterPlans/${chapterNumber}`, text: JSON.stringify({ chapterNumber, purpose: '同章的设定摘要，不能替代细纲原文。' }) },
      ]),
    ] };
  const run = createDesignReviewRun(input, undefined, version);
  const original = run.stages.find(s => s.id === 'cross-1-2')!;
  for (const stage of run.stages.slice(0, run.stages.indexOf(original))) acceptDesignReviewStage(run, stage, answer(designReviewStageInput(run, stage)));
  const request = designReviewStageInput(run, original), result = answer(request);
  result.checks[0] = { ...result.checks[0], verdict: 'insufficient', explanation: '本批宏观动作的承力者须与第3章核对。',
    revisionAdvice: '补读完整第3章，不假设御物承担箱重。', awaitingSources: ['plan/chapters/3'],
    evidence: cited ? ['world/axioms/rule', 'plan/chapters/1'].map(sourceId => {
      const unit = request.stage!.sourceMap.find(u => u.sourceId === sourceId)!;
      const source = request.sources.find(s => s.id === unit.id)!;
      return { sourceId: source.id, quote: source.text.slice(0, 40) };
    }) : [],
  };
  acceptDesignReviewStage(run, original, result);
  const next = run.stages.find(s => s.id === 'cross-1-3')!;
  return { run, original, next, request: designReviewStageInput(run, next) };
}
function resolution(input: DesignReviewInput): DesignReviewResult {
  const result = answer(input), pending = input.stage!.coverage!.pendingChecks!.find(p => p.id === originalQuestion)!;
  result.checks[0].resolves = [pending.id];
  const ids = [pending.questionSourceId, ...[...pending.priorSourceIds!, ...pending.requiredSourceIds].map(id => input.stage!.sourceMap.find(u => u.sourceId === id)!.id)];
  result.checks[0].evidence = [...new Set(ids)].map(id => ({ sourceId: id, quote: input.sources.find(s => s.id === id)!.text.slice(0, 40) }));
  return result;
}
function finish(run: DesignReviewRun) {
  while (true) {
    const stage = run.stages.find(s => !s.result);
    if (!stage) break;
    const input = designReviewStageInput(run, stage), result = answer(input);
    if (stage.followupFor || input.stage?.coverage?.synthesis?.requiredFindings?.length) {
      result.checks[0].verdict = 'insufficient'; result.checks[0].revisionAdvice = '保留未实际解决的原问题。';
    }
    acceptDesignReviewStage(run, stage, result);
  }
  return completeDesignReviewRun(run);
}

test('later raw check can explicitly resolve a question with its complete cited basis and requested sources', async () => {
  const { run, original, next, request } = fixture();
  assert.ok(!original.unitIds.every(id => next.unitIds.includes(id)), 'The unrelated chapter is not repeated');
  const pending = request.stage!.coverage!.pendingChecks!.find(p => p.id === originalQuestion)!;
  assert.deepEqual(pending.priorSourceIds, ['world/axioms/rule', 'plan/chapters/1']);
  for (const id of [...pending.priorSourceIds!, ...pending.requiredSourceIds]) {
    const units = request.stage!.sourceMap.filter(u => u.sourceId === id);
    assert.equal(units.map(u => request.sources.find(s => s.id === u.id)!.text).join(''), run.input.sources.find(s => s.id === id)!.text);
  }
  let calls = 0;
  const planner = new JsonDesignPlanner({ complete: async call => {
    calls++;
    const sent = JSON.parse(call.user), required = sent.pendingCitationRequirements.find((p: { checkId: string }) => p.checkId === originalQuestion);
    assert.deepEqual(required.requiredSources.map((s: { sourceId: string }) => s.sourceId), [pending.questionSourceId, ...pending.priorSourceIds!, ...pending.requiredSourceIds]);
    return JSON.stringify({ requestId: sent.requestId, summary: '按实际来源解决原问题', checks: [{ criterion: 'causality', verdict: 'pass',
      explanation: '本批完整读取原规则、宏观动作与所请求细纲，核对承力者后明确解决原问题。', revisionAdvice: '', resolves: [originalQuestion],
      evidence: required.requiredSources.map((s: { units: Array<{ fragmentIds: string[] }> }) => ({ fragmentId: s.units[0].fragmentIds[0] })) }] });
  } });
  const { modelResponses, ...result } = await planner.reviewDesignContent(request);
  assert.equal(calls, 1); assert.equal(modelResponses!.length, 1);
  acceptDesignReviewStage(run, next, result);
  const completed = finish(run);
  assert.equal(completed.result.checks[0].verdict, 'pass');
  assert.deepEqual(completed.result.resolvedDeferrals, [{ checkId: originalQuestion, resolvedByStageId: next.id }]);
  assert.ok(!run.stages.some(s => s.followupFor === originalQuestion), 'No redundant dedicated read after explicit resolution');
  assert.equal(original.result!.checks[0].verdict, 'insufficient', 'Original negative stays intact');
  assert.deepEqual(completeDesignReviewRun(JSON.parse(JSON.stringify(run))), completed);
});

test('all original cited sources are mandatory, not just one arbitrary original unit', () => {
  const { request } = fixture(), result = resolution(request);
  const ruleUnit = request.stage!.sourceMap.find(u => u.sourceId === 'world/axioms/rule')!.id;
  result.checks[0].evidence = result.checks[0].evidence.filter(e => e.sourceId !== ruleUnit);
  assert.throws(() => validateDesignReview(request, result), /每个原始来源/);
});

for (const sourceId of ['plan/chapters/1', 'plan/chapters/3']) test(`partial original or requested source cannot authorize resolution: ${sourceId}`, () => {
  const { run, next, request } = fixture(), result = resolution(request);
  const missing = run.units.filter(u => u.sourceId === sourceId).at(-1)!;
  next.unitIds = next.unitIds.filter(id => id !== missing.id);
  const partial = designReviewStageInput(run, next);
  assert.ok(!partial.stage!.coverage!.pendingChecks?.some(p => p.id === originalQuestion));
  assert.throws(() => validateDesignReview(partial, result), /没有符合本批覆盖范围/);
});

test('a raw pass without explicit resolution leaves the original question blocking', () => {
  const { run, next, request } = fixture();
  acceptDesignReviewStage(run, next, answer(request));
  const completed = finish(run);
  assert.equal(completed.result.checks[0].verdict, 'insufficient');
  assert.equal(completed.result.resolvedDeferrals, undefined);
});

test('v33 keeps full original batch coverage; absent original evidence is never guessed in v34', () => {
  assert.ok(!fixture(33).request.stage!.coverage!.pendingChecks?.some(p => p.id === originalQuestion));
  assert.ok(!fixture(34, false).request.stage!.coverage!.pendingChecks?.some(p => p.id === originalQuestion));
});
