import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Index every historical insufficiency after the caller has reconstructed the
 * final report with its original runtime. This is not a citation validator or
 * an approval mechanism; it preserves ordinary gaps even if a revise wins the
 * final criterion, and separates explicitly resolved source deferrals. */
export function collectDesignReviewInsufficiencies(run, verifiedReport) {
  assert.equal(run.status, 'completed', 'A final report requires a completed run');
  assert.ok(run.stages.length && run.stages.every(stage => stage.result), 'Unfinished review stage');
  assert.equal(run.reportId, verifiedReport.id, 'Report binding differs');
  assert.equal(verifiedReport.runId, run.id, 'Run binding differs');
  assert.equal(verifiedReport.inputHash, run.input.inputHash, 'Report materials differ');
  const rows = run.stages.flatMap((stage, stageIndex) => stage.result.checks
    .filter(check => check.verdict === 'insufficient')
    .map(check => ({ stage, stageIndex, check, checkId: `${stage.id}/${check.criterion}` })));
  assert.equal(new Set(rows.map(row => row.checkId)).size, rows.length, 'Duplicate insufficiency');
  const resolutions = new Map();
  for (const resolution of verifiedReport.resolvedDeferrals ?? []) {
    assert.ok(!resolutions.has(resolution.checkId), 'Duplicate resolution');
    const original = rows.find(row => row.checkId === resolution.checkId);
    assert.ok(original?.check.awaitingSources?.length && original.stage.kind !== 'synthesis'
      && !original.stage.followupFor, 'Only an explicit original source deferral may be resolved');
    const resolverIndex = run.stages.findIndex(stage => stage.id === resolution.resolvedByStageId);
    const resolver = run.stages[resolverIndex];
    assert.ok(resolverIndex > original.stageIndex && resolver.kind !== 'synthesis'
      && resolver.result.checks.some(check => check.criterion === original.check.criterion
        && check.verdict === 'pass' && check.resolves?.includes(original.checkId)), 'Missing later raw resolution');
    resolutions.set(resolution.checkId, resolution.resolvedByStageId);
  }
  return rows.map(({ stage, check, checkId }) => {
    const resolvedByStageId = resolutions.get(checkId);
    if (!resolvedByStageId) assert.ok(['insufficient', 'revise'].includes(
      verifiedReport.checks.find(item => item.criterion === check.criterion)?.verdict), 'Unresolved insufficiency lost from final verdict');
    return {
      area: run.input.area, runId: run.id, stageId: stage.id, checkId, criterion: check.criterion,
      kind: check.awaitingSources?.length ? 'awaiting_sources' : 'ordinary_insufficiency',
      disposition: resolvedByStageId ? 'resolved_by_raw_review' : 'unresolved',
      ...(resolvedByStageId ? { resolvedByStageId } : {}),
      originalCheck: structuredClone(check), stageResultSha256: hash(stage.result),
    };
  });
}
