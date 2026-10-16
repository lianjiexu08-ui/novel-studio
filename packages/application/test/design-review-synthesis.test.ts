import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesignReviewRun, designReviewStageInput, acceptDesignReviewStage, completeDesignReviewRun } from '../../../novel-service-core/src/design-review-run.ts';
import type { DesignReviewInput, DesignReviewResult } from '../../../novel-service-core/src/design-review.ts';

const input = (): DesignReviewInput => ({ area: 'story', inputHash: 'a'.repeat(64),
  scope: { worldPackRevision: 1, storyBibleRevision: 1, planRevisionId: 'p', planRevision: 1 },
  rubric: { timeline: '核对收信时间', payoff: '保留代价' }, sources: [
    { id: 'early', text: '第9日寄出书信。' + '寄出记录。'.repeat(17000) },
    { id: 'other', text: '另一条支线仍缺代价。' + '支线记录。'.repeat(17000) },
    { id: 'arrival', text: '第12日收到书信。' + '送达记录。'.repeat(17000) },
  ] });
const pass = (request: DesignReviewInput): DesignReviewResult => ({ summary: '检查报告', checks: Object.keys(request.rubric).map(criterion => ({
  criterion, verdict: 'pass', explanation: '根据本次来源', revisionAdvice: '',
  evidence: [{ sourceId: request.sources[0].id, quote: request.sources[0].text.slice(0, 12) }],
})) });

for (const resolve of [false, true]) test(`v27 keeps ordinary negatives while a source deferral is ${resolve ? 'explicitly resolved' : 'still unresolved'}`, () => {
  const run = createDesignReviewRun(input(), undefined, 27);
  assert.equal(run.scheduleVersion, 27);
  for (const stage of [...run.stages.filter(stage => stage.kind !== 'synthesis')]) {
    const request = designReviewStageInput(run, stage), result = pass(request);
    if (stage.id === 'batch-2') Object.assign(result.checks[1], { verdict: 'revise', explanation: '支线缺少代价', revisionAdvice: '补齐代价' });
    if (stage.id === 'cross-1-2') Object.assign(result.checks[0], { verdict: 'insufficient', explanation: '尚未读到送达原文', revisionAdvice: '补读送达记录', awaitingSources: ['arrival'],
      evidence: [{ sourceId: request.stage!.sourceMap.find(unit => unit.sourceId === 'early')!.id, quote: '第9日寄出书信。' }] });
    acceptDesignReviewStage(run, stage, result);
  }
  const followup = run.stages.find(stage => stage.followupFor === 'cross-1-2/timeline')!;
  assert.ok(followup);
  const request = designReviewStageInput(run, followup), result = pass(request);
  if (resolve) {
    const pending = request.stage!.coverage!.pendingChecks![0];
    result.checks[0].resolves = [pending.id];
    result.checks[0].evidence = [
      { sourceId: pending.questionSourceId, quote: '尚未读到送达原文' },
      { sourceId: request.stage!.sourceMap.find(unit => unit.sourceId === 'early')!.id, quote: '第9日寄出书信。' },
      { sourceId: request.stage!.sourceMap.find(unit => unit.sourceId === 'arrival')!.id, quote: '第12日收到书信。' },
    ];
  } else Object.assign(result.checks[0], { verdict: 'insufficient', explanation: '补读仍有待核内容', revisionAdvice: '继续核查' });
  acceptDesignReviewStage(run, followup, result);
  const rawBefore = JSON.stringify(run.stages.filter(stage => stage.kind !== 'synthesis'));
  let checked = 0;
  for (const stage of run.stages.filter(stage => stage.kind === 'synthesis')) {
    const request = designReviewStageInput(run, stage), result = pass(request);
    const required = request.stage!.coverage!.synthesis!.requiredFindings!;
    assert.ok(required.every(finding => stage.children.includes(finding.stageId)));
    if (required.length) {
      assert.throws(() => acceptDesignReviewStage(run, stage, result), /不得弱化/);
      assert.equal(stage.result, undefined, 'rejected output must not mutate progress');
      checked++;
    }
    for (const check of result.checks) {
      const findings = required.filter(finding => finding.criterion === check.criterion);
      if (!findings.length) continue;
      check.verdict = findings.some(finding => finding.verdict === 'revise') ? 'revise' : 'insufficient';
      check.revisionAdvice = '保留原问题，等待独立复核';
      if (check.verdict === 'revise') {
        const weaker = structuredClone(result);
        weaker.checks.find(item => item.criterion === check.criterion)!.verdict = 'insufficient';
        assert.throws(() => acceptDesignReviewStage(run, stage, weaker), /不得弱化/);
      }
    }
    acceptDesignReviewStage(run, stage, result);
  }
  assert.ok(checked > 0);
  assert.equal(JSON.stringify(run.stages.filter(stage => stage.kind !== 'synthesis')), rawBefore);
  const restored = JSON.parse(JSON.stringify(run));
  assert.deepEqual(completeDesignReviewRun(restored).result.checks.map(check => [check.criterion, check.verdict]),
    [['timeline', resolve ? 'pass' : 'insufficient'], ['payoff', 'revise']]);
});

test('v26 requests remain unchanged; v27 adds only child findings to synthesis input', () => {
  const old = createDesignReviewRun(input(), '2026-10-16T00:00:00Z', 26);
  const current = createDesignReviewRun(input(), old.createdAt, 27);
  assert.deepEqual(current.units, old.units);
  assert.deepEqual(current.stages, old.stages);
  for (const stage of current.stages) {
    const prior = old.stages.find(item => item.id === stage.id)!;
    const request = designReviewStageInput(current, stage), legacy = designReviewStageInput(old, prior);
    const withoutNewMetadata = structuredClone(request);
    if (withoutNewMetadata.stage?.coverage?.synthesis) delete withoutNewMetadata.stage.coverage.synthesis.requiredFindings;
    assert.deepEqual(withoutNewMetadata, legacy);
    const result = pass(request);
    acceptDesignReviewStage(current, stage, result);
    acceptDesignReviewStage(old, prior, result);
  }
  assert.deepEqual(completeDesignReviewRun(current).result, completeDesignReviewRun(old).result);
});
