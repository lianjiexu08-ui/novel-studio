import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDesignReviewInsufficiencies } from './collect-design-review-insufficiencies.mjs';

const check = (criterion, verdict, extra = {}) => ({ criterion, verdict,
  explanation: `${criterion} original explanation`, evidence: [{ sourceId: 'raw', quote: 'original evidence' }], revisionAdvice: 'retain the obligation', ...extra });
function fixture() {
  const run = { id: 'run', reportId: 'report', status: 'completed', input: { inputHash: 'frozen', area: 'power' }, stages: [
    { id: 'batch-1', kind: 'batch', result: { checks: [check('tiers', 'insufficient', { awaitingSources: ['plan/chapter/2'] }), check('costs', 'insufficient', { insufficiencyReason: 'capacity_limit' })] } },
    { id: 'followup', kind: 'cross', followupFor: 'batch-1/tiers', result: { checks: [check('tiers', 'pass', { resolves: ['batch-1/tiers'] })] } },
    { id: 'cross', kind: 'cross', result: { checks: [check('costs', 'revise')] } },
    { id: 'final', kind: 'synthesis', result: { checks: [check('tiers', 'pass'), check('costs', 'revise')] } },
  ] };
  const report = { id: 'report', runId: 'run', inputHash: 'frozen', checks: structuredClone(run.stages.at(-1).result.checks),
    resolvedDeferrals: [{ checkId: 'batch-1/tiers', resolvedByStageId: 'followup' }] };
  return { run, report };
}

test('retains ordinary insufficiency alongside a more severe final revise and preserves resolved history', () => {
  const { run, report } = fixture(), before = structuredClone({ run, report });
  const rows = collectDesignReviewInsufficiencies(run, report);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].disposition, 'resolved_by_raw_review');
  assert.equal(rows[0].resolvedByStageId, 'followup');
  assert.deepEqual(rows[0].originalCheck.awaitingSources, ['plan/chapter/2']);
  assert.equal(rows[1].disposition, 'unresolved');
  assert.equal(rows[1].kind, 'ordinary_insufficiency');
  assert.equal(rows[1].originalCheck.insufficiencyReason, 'capacity_limit');
  rows[1].originalCheck.evidence[0].quote = 'changed output';
  assert.deepEqual({ run, report }, before);
});

test('does not infer a resolution from a later pass absent the verified ledger', () => {
  const { run, report } = fixture(); report.resolvedDeferrals = [];
  report.checks[0].verdict = 'insufficient';
  assert.equal(collectDesignReviewInsufficiencies(run, report)[0].disposition, 'unresolved');
});

test('keeps ordinary synthesis gaps visible, including disputed scope findings', () => {
  const { run, report } = fixture();
  run.stages.at(-1).result.checks[0] = check('tiers', 'insufficient');
  report.checks[0].verdict = 'insufficient';
  const rows = collectDesignReviewInsufficiencies(run, report);
  assert.equal(rows.at(-1).checkId, 'final/tiers');
  assert.equal(rows.at(-1).kind, 'ordinary_insufficiency');
  assert.equal(rows.at(-1).disposition, 'unresolved');
});

for (const [name, corrupt, error] of [
  ['a running prefix', ({ run }) => { run.status = 'running'; }, /completed run/],
  ['an unfinished stage', ({ run }) => { delete run.stages[2].result; }, /Unfinished/],
  ['another input hash', ({ report }) => { report.inputHash = 'other'; }, /materials differ/],
  ['ordinary gap relabeled as resolved', ({ report }) => { report.resolvedDeferrals.push({ checkId: 'batch-1/costs', resolvedByStageId: 'cross' }); }, /explicit original source deferral/],
  ['a synthesis acting as resolver', ({ report }) => { report.resolvedDeferrals[0].resolvedByStageId = 'final'; }, /later raw resolution/],
  ['missing explicit resolution declaration', ({ run }) => { delete run.stages[1].result.checks[0].resolves; }, /later raw resolution/],
  ['a final pass hiding ordinary insufficiency', ({ report }) => { report.checks[1].verdict = 'pass'; }, /Unresolved insufficiency lost/],
  ['a duplicate ledger entry', ({ report }) => { report.resolvedDeferrals.push(report.resolvedDeferrals[0]); }, /Duplicate resolution/],
]) test(`rejects ${name}`, () => {
  const state = fixture(); corrupt(state);
  assert.throws(() => collectDesignReviewInsufficiencies(state.run, state.report), error);
});
