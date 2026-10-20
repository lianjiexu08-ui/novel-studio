import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptDesignReviewStage, completeDesignReviewRun, createDesignReviewRun, designReviewStageInput, queueDesignReviewReconsideration, type DesignReviewRun } from '../../../novel-service-core/src/design-review-run.ts';
import { validateDesignReview, type DesignReviewInput, type DesignReviewResult } from '../../../novel-service-core/src/design-review.ts';
import { designReviewCheckHash } from '../../../novel-service-core/src/design-review-annotations.ts';
import type { DesignReviewAnnotationDto } from 'novel-studio-contracts';
import { JsonDesignPlanner } from '../../planner/src/index.ts';

function answer(input: DesignReviewInput): DesignReviewResult {
  return { summary: '测试判定', checks: Object.keys(input.rubric).map(criterion => ({ criterion, verdict: 'pass', explanation: '核对本批原文。', revisionAdvice: '',
    evidence: [{ sourceId: input.sources[0].id, quote: input.sources[0].text.slice(0, 40) }] })) };
}
export function reconsiderationFixture() {
  const run = createDesignReviewRun({ area: 'power', inputHash: 'a'.repeat(64),
    scope: { worldPackRevision: 1, storyBibleRevision: 1, planRevisionId: 'plan', planRevision: 1 }, rubric: { costs: '核对来源和代价', tiers: '核对等级' },
    sources: [1, 2, 3, 4].map(i => ({ id: `source/${i}`, text: `第${i}份完整规则与行动：有偿检查消耗半点真元。`.repeat(3500) })) });
  const original = run.stages[0], input = designReviewStageInput(run, original), result = answer(input);
  result.checks[0] = { ...result.checks[0], verdict: 'revise', explanation: '检查没有说明代价，必须返修。', revisionAdvice: '补全检查规则。' };
  acceptDesignReviewStage(run, original, result);
  original.attempts = 1; original.modelResponses = ['原始回答不得替换'];
  const note: DesignReviewAnnotationDto = { id: 'note-1', createdAt: '2026-10-19T00:00:00.000Z', requestKey: 'challenge-1', runId: run.id,
    stageId: original.id, criterion: 'costs', expectedInputHash: run.input.inputHash, expectedCheckHash: designReviewCheckHash(result.checks[0]),
    claimQuote: '检查没有说明代价', explanation: '第4份完整来源写明检查消耗。仍需评审整项。', scope: structuredClone(run.input.scope),
    evidence: [{ sourceId: 'source/4', quote: '有偿检查消耗半点真元' }] };
  return { run, note, original };
}
function resolved(input: DesignReviewInput): DesignReviewResult {
  const result = answer(input), pending = input.stage!.coverage!.pendingChecks!.find(item => item.id === input.stage!.reconsiderationFor)!;
  const ids = [pending.questionSourceId, ...new Set([...pending.priorSourceIds!, ...pending.requiredSourceIds].map(id => input.stage!.sourceMap.find(unit => unit.sourceId === id)!.id))];
  result.checks[0].resolves = [pending.id];
  result.checks[0].evidence = ids.map(id => ({ sourceId: id, quote: input.sources.find(source => source.id === id)!.text.slice(0, 40) }));
  return result;
}
function finish(run: DesignReviewRun) {
  let next;
  while ((next = run.stages.find(stage => !stage.result))) {
    const input = designReviewStageInput(run, next), result = answer(input);
    for (const finding of input.stage?.coverage?.synthesis?.requiredFindings ?? []) {
      const check = result.checks.find(check => check.criterion === finding.criterion)!;
      if (check.verdict !== 'revise') check.verdict = finding.verdict; check.revisionAdvice = '保留原问题。';
    }
    acceptDesignReviewStage(run, next, result);
  }
  return completeDesignReviewRun(run);
}

test('formal recheck preserves original request/result and only resolves the explicitly evidenced negative', () => {
  const { run, note, original } = reconsiderationFixture();
  const before = structuredClone(original), request = designReviewStageInput(run, original), frozenInput = structuredClone(run.input);
  const stage = queueDesignReviewReconsideration(run, note), input = designReviewStageInput(run, stage);
  assert.equal(run.stages[1].id, stage.id);
  assert.deepEqual(run.input, frozenInput);
  assert.deepEqual(run.stages[0], before);
  assert.deepEqual(designReviewStageInput(run, run.stages[0]), request);
  for (const id of new Set(original.unitIds.map(id => run.units.find(unit => unit.id === id)!.sourceId).concat('source/4'))) {
    const actual = input.stage!.sourceMap.filter(unit => unit.sourceId === id).map(unit => input.sources.find(source => source.id === unit.id)!.text).join('');
    assert.equal(actual, run.input.sources.find(source => source.id === id)!.text);
  }
  assert.deepEqual(Object.keys(input.rubric), ['costs']);
  const beforeRetry = structuredClone(run);
  assert.equal(queueDesignReviewReconsideration(run, note).id, stage.id);
  assert.deepEqual(run, beforeRetry);
  assert.throws(() => queueDesignReviewReconsideration(run, note, ['source/2']), /绑定其他/);
  acceptDesignReviewStage(run, stage, resolved(input));
  const final = finish(run);
  assert.equal(final.result.checks.find(check => check.criterion === 'costs')!.verdict, 'pass');
  assert.deepEqual(final.result.resolvedReconsiderations, [{ checkId: `${original.id}/costs`, resolvedByStageId: stage.id, kind: 'reconsideration' }]);
  assert.equal(final.result.resolvedDeferrals, undefined);
  assert.deepEqual(run.stages[0], before);
  assert.ok(final.input.sources.some(source => source.text.includes('resolved_by_raw_reconsideration')));
  const corrupt = structuredClone(run); corrupt.reconsiderations![0].afterStageId = 'unknown';
  assert.throws(() => completeDesignReviewRun(corrupt), /复核|覆盖/);
  const partial = structuredClone(run); partial.stages[1].unitIds.pop();
  assert.throws(() => completeDesignReviewRun(partial), /覆盖|完整/);
});

test('bare pass, missing supplemental citation, wrong check and altered note cannot clear a negative', () => {
  const { run, note } = reconsiderationFixture();
  const stage = queueDesignReviewReconsideration(run, note), input = designReviewStageInput(run, stage);
  assert.throws(() => validateDesignReview(input, answer(input)), /显式/);
  const missing = resolved(input); missing.checks[0].evidence = missing.checks[0].evidence.filter(e => e.sourceId !== input.stage!.sourceMap.find(unit => unit.sourceId === 'source/4')!.id);
  assert.throws(() => validateDesignReview(input, missing), /新增来源/);
  const wrong = resolved(input); wrong.checks[0].resolves = ['batch-1/tiers'];
  assert.throws(() => validateDesignReview(input, wrong), /显式|覆盖/);
  const failed = answer(input); failed.checks[0] = { ...failed.checks[0], verdict: 'insufficient', revisionAdvice: '完整材料仍不能解释另一笔支出。' };
  acceptDesignReviewStage(run, stage, failed);
  const final = finish(run);
  assert.equal(final.result.checks[0].verdict, 'revise');
  assert.equal(final.result.resolvedReconsiderations, undefined);
});

test('formal recheck rejects leases, stale bindings, started suffixes and over-capacity complete sources atomically', () => {
  for (const mutate of [
    (run: DesignReviewRun) => { run.leaseToken = 'held'; },
    (run: DesignReviewRun) => { run.stages[1].attempts = 1; },
    (run: DesignReviewRun) => { run.stages.find(stage => stage.kind === 'synthesis')!.attempts = 1; },
    (run: DesignReviewRun) => { run.input.sources[3].text += '过长'.repeat(200000); run.units.filter(unit => unit.sourceId === 'source/4').at(-1)!.end = run.input.sources[3].text.length; },
  ]) {
    const { run, note } = reconsiderationFixture(); mutate(run); const before = structuredClone(run);
    assert.throws(() => queueDesignReviewReconsideration(run, note)); assert.deepEqual(run, before);
  }
  const { run, note } = reconsiderationFixture();
  assert.throws(() => queueDesignReviewReconsideration(run, { ...note, expectedCheckHash: 'b'.repeat(64) }), /原判定/);
  assert.throws(() => queueDesignReviewReconsideration(run, { ...note, evidence: [{ sourceId: 'source/4', quote: '并不存在的证据' }] }), /引文/);
});

test('model receives a targeted challenge and mandatory raw citations, not a detached approval request', async () => {
  const { run, note } = reconsiderationFixture();
  const stage = queueDesignReviewReconsideration(run, note), input = designReviewStageInput(run, stage);
  let calls = 0;
  const planner = new JsonDesignPlanner({ complete: async request => {
    calls++;
    assert.ok(request.system.includes('正式复核扩展规则'));
    const sent = JSON.parse(request.user), requirements = sent.citationRequirements;
    assert.equal(requirements.checkId, stage.reconsiderationFor);
    return JSON.stringify({ requestId: sent.requestId, summary: '完整复核判定', checks: [{ criterion: 'costs', verdict: 'pass', explanation: '逐项核验完整规则与行动后，原问题已解决。', revisionAdvice: '', resolves: [requirements.checkId],
      evidence: requirements.sources.map((source: { units: Array<{ fragmentIds: string[] }> }) => ({ fragmentId: source.units[0].fragmentIds[0] })) }] });
  } });
  const result = await planner.reviewDesignContent(input);
  assert.equal(calls, 1); acceptDesignReviewStage(run, stage, result);
  assert.equal(result.modelResponses!.length, 1);
});

test('resolving one negative never clears another criterion or a later adverse raw check', () => {
  const { run, note } = reconsiderationFixture();
  const original = run.stages[0];
  original.result!.checks[1] = { ...original.result!.checks[1], verdict: 'revise', revisionAdvice: '等级冲突仍需修订。' };
  const stage = queueDesignReviewReconsideration(run, note);
  acceptDesignReviewStage(run, stage, resolved(designReviewStageInput(run, stage)));
  const next = run.stages.find(stage => !stage.result)!;
  const result = answer(designReviewStageInput(run, next));
  result.checks[0] = { ...result.checks[0], verdict: 'revise', revisionAdvice: '另一笔费用仍有冲突。' };
  acceptDesignReviewStage(run, next, result);
  const final = finish(run);
  assert.deepEqual(final.result.checks.map(check => check.verdict), ['revise', 'revise']);
  assert.equal(final.result.resolvedReconsiderations!.length, 1);
});

function navigationFixture() {
  const fixture = reconsiderationFixture(), check = fixture.original.result!.checks[0];
  check.verdict = 'insufficient'; check.insufficiencyReason = 'unlocatable_sources';
  check.explanation = '尚未读到检查规则，目前无法定位所需原文。';
  fixture.note.claimQuote = '目前无法定位所需原文';
  fixture.note.expectedCheckHash = designReviewCheckHash(check);
  return fixture;
}

test('source navigation recheck reads complete cited basis and additions without replacing the original insufficient answer', async () => {
  const { run, note, original } = navigationFixture(), before = structuredClone(original);
  const originalRequest = designReviewStageInput(run, original);
  const stage = queueDesignReviewReconsideration(run, note), input = designReviewStageInput(run, stage);
  assert.equal(run.reconsiderations![0].version, 2);
  assert.equal(input.stage!.reconsiderationKind, 'source_navigation');
  assert.deepEqual(designReviewStageInput(run, original), originalRequest);
  const pending = input.stage!.coverage!.pendingChecks![0];
  for (const id of [...pending.priorSourceIds!, ...pending.requiredSourceIds]) {
    assert.equal(input.stage!.sourceMap.filter(unit => unit.sourceId === id).map(unit => input.sources.find(source => source.id === unit.id)!.text).join(''), run.input.sources.find(source => source.id === id)!.text);
  }
  assert.throws(() => acceptDesignReviewStage(run, stage, answer(input)), /显式/);
  const missing = resolved(input); missing.checks[0].evidence = missing.checks[0].evidence.filter(e => e.sourceId !== input.stage!.sourceMap.find(unit => unit.sourceId === 'source/4')!.id);
  assert.throws(() => acceptDesignReviewStage(run, stage, missing), /新增来源/);
  const planner = new JsonDesignPlanner({ complete: async request => {
    assert.ok(request.system.includes('来源定位正式复核'));
    assert.ok(!request.system.includes('指向已有revise'));
    const sent = JSON.parse(request.user), requirements = sent.citationRequirements;
    return JSON.stringify({ requestId: sent.requestId, summary: '读到完整规则后核实原不足', checks: [{ criterion: 'costs', verdict: 'pass', explanation: '原问题与完整原依据、补充规则一致，检查有明确代价。', revisionAdvice: '', resolves: [requirements.checkId], evidence: requirements.sources.map((source: { units: Array<{ fragmentIds: string[] }> }) => ({ fragmentId: source.units[0].fragmentIds[0] })) }] });
  } });
  acceptDesignReviewStage(run, stage, await planner.reviewDesignContent(input));
  const final = finish(run);
  assert.equal(final.result.checks[0].verdict, 'pass');
  assert.equal(final.result.resolvedReconsiderations!.length, 1);
  assert.ok(final.input.sources.some(source => source.text.includes('原始insufficient是已正式复核解决')));
  assert.deepEqual(original, before);
  const corrupt = structuredClone(run); corrupt.reconsiderations![0].version = 1;
  assert.throws(() => completeDesignReviewRun(corrupt), /复核版本|旧版/);
});

test('navigation notes cannot erase other insufficiencies, skip new sources or clear unresolved rechecks', () => {
  for (const reason of ['missing_design', 'capacity_limit'] as const) {
    const { run, note, original } = navigationFixture(); original.result!.checks[0].insufficiencyReason = reason;
    note.expectedCheckHash = designReviewCheckHash(original.result!.checks[0]);
    const before = structuredClone(run); assert.throws(() => queueDesignReviewReconsideration(run, note), /仅支持/); assert.deepEqual(run, before);
  }
  const { run, note, original } = navigationFixture();
  const unit = run.units.find(unit => unit.id === original.unitIds[0])!, source = run.input.sources.find(source => source.id === unit.sourceId)!;
  assert.throws(() => queueDesignReviewReconsideration(run, { ...note, evidence: [{ sourceId: source.id, quote: source.text.slice(0, 40) }] }), /未读到/);
  original.result!.checks[1] = { ...original.result!.checks[1], verdict: 'insufficient', insufficiencyReason: 'missing_design', revisionAdvice: '仍需补设计' };
  const stage = queueDesignReviewReconsideration(run, note), input = designReviewStageInput(run, stage), failed = answer(input);
  failed.checks[0] = { ...failed.checks[0], verdict: 'insufficient', revisionAdvice: '读到新来源后仍有前置条件未核实。' };
  acceptDesignReviewStage(run, stage, failed);
  const final = finish(run);
  assert.deepEqual(final.result.checks.map(check => check.verdict), ['insufficient', 'insufficient']);
  assert.equal(final.result.resolvedReconsiderations, undefined);
});
