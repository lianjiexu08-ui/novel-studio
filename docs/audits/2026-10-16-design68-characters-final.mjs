// Reconcile a completed frozen review. Never finish, retry or edit a live run.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayDesignReviewPrefix } from '../../scripts/audit-design-reviews.mjs';
const read = path => JSON.parse(fs.readFileSync(path));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.parse(JSON.stringify(value));
const control = 'data/audit-runtimes/design68-review';
const checkpointBytes = fs.readFileSync(`${control}/result.json`);
const checkpoint = JSON.parse(checkpointBytes);
const baseline = read(`${control}/baseline.json`);
const binding = read('data/audit-runtimes/design68-runtime-bound.json');
const inputsBytes = fs.readFileSync(`${control}/inputs.json`);
assert.equal(sha(inputsBytes), baseline.inputsSha256);
assert.equal(checkpoint.inputHash, baseline.inputHash);
assert.equal(sha(fs.readFileSync('scripts/run-design68-review.mjs')), baseline.runnerSha256);
for (const [path, expected] of Object.entries(binding.sourceHashes)) assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
const run = checkpoint.runs.find(run => run.input.area === 'characters');
assert.equal(run.status, 'completed', 'Wait for the same worker to complete character review');
const report = checkpoint.reports.find(report => report.id === run.reportId);
assert.ok(report);
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const replay = await replayDesignReviewPrefix(run, JSON.parse(inputsBytes).characters, { ...runtime, JsonDesignPlanner });
const rebuilt = runtime.completeDesignReviewRun(run);
assert.equal(report.runId, run.id);
assert.equal(report.inputHash, baseline.inputHash);
assert.deepEqual(report.scope, rebuilt.input.scope);
assert.deepEqual(report.sources, rebuilt.input.sources);
for (const key of ['summary', 'checks', 'resolvedDeferrals']) assert.deepEqual(canonical(report[key] ?? null), canonical(rebuilt.result[key] ?? null), key);
const rank = { pass: 0, insufficient: 1, revise: 2 };
const resolved = new Set((report.resolvedDeferrals ?? []).map(item => item.checkId));
const retainedFindings = run.stages.filter(stage => stage.kind !== 'synthesis').flatMap(stage => stage.result.checks
  .filter(check => check.verdict !== 'pass' && !(check.awaitingSources && resolved.has(`${stage.id}/${check.criterion}`)))
  .map(({ evidence, ...check }) => ({ stageId: stage.id, ...check, evidenceCount: evidence.length,
    evidenceSha256: sha(JSON.stringify(evidence)), stageSha256: sha(JSON.stringify(stage)) })));
for (const finding of retainedFindings) {
  assert.ok(rank[report.checks.find(check => check.criterion === finding.criterion).verdict] >= rank[finding.verdict], `Final criterion weakened ${finding.stageId}/${finding.criterion}`);
}
const weakenedIntermediateFindings = [];
for (const stage of run.stages.filter(stage => stage.kind === 'synthesis')) {
  const request = runtime.designReviewStageInput(run, stage);
  const localResolved = new Set((request.stage.coverage.resolvedDeferrals ?? []).map(item => item.checkId));
  for (const childId of stage.children) for (const childCheck of run.stages.find(item => item.id === childId).result.checks) {
    if (childCheck.verdict === 'pass' || childCheck.awaitingSources && localResolved.has(`${childId}/${childCheck.criterion}`)) continue;
    const selected = stage.result.checks.find(check => check.criterion === childCheck.criterion);
    if (rank[selected.verdict] < rank[childCheck.verdict]) weakenedIntermediateFindings.push({
      stageId: stage.id, childId, criterion: childCheck.criterion, childVerdict: childCheck.verdict,
      synthesisVerdict: selected.verdict, stageSha256: sha(JSON.stringify(stage)),
    });
  }
}
const adjudicationSources = [
  'docs/audits/2026-10-16-design68-characters-order-dispute.json',
  'docs/audits/2026-10-16-design68-characters-brother-dispute.json',
].map(path => ({ path, sha256: sha(fs.readFileSync(path)) }));
// Preserve explanations along the actual parent paths for semantic inspection;
// string presence alone cannot prove either correction or propagation.
const disputedExplanationPaths = [
  { issue: 'father_archive_and_convoy_order', stages: ['synthesis-10', 'synthesis-17', 'synthesis-21', 'synthesis-23', 'synthesis-24'], criteria: ['knowledge'] },
  { issue: 'lu_brother_identity', stages: ['synthesis-16', 'synthesis-20', 'synthesis-22', 'synthesis-24'], criteria: ['agency', 'relationships'] },
].map(path => ({ issue: path.issue, stages: path.stages.map(id => {
  const stage = run.stages.find(stage => stage.id === id);
  assert.ok(stage?.result, id);
  return { stageId: id, children: stage.children, stageSha256: sha(JSON.stringify(stage)),
    checks: stage.result.checks.filter(check => path.criteria.includes(check.criterion))
      .map(({ evidence, ...check }) => ({ ...check, evidenceCount: evidence.length })) };
}) }));
const selectedFinalOrigins = report.checks.map(check => ({ criterion: check.criterion,
  matchingStages: run.stages.filter(stage => stage.result.checks.some(item => {
    const { awaitingSources, resolves, ...finalShape } = item;
    return JSON.stringify(finalShape) === JSON.stringify(check);
  })).map(stage => ({ stageId: stage.id, kind: stage.kind })),
}));
assert.ok(selectedFinalOrigins.every(item => item.matchingStages.length), 'Final checks must match retained stage judgments');
const snapshotPath = `${control}/characters-completed.json`;
const proof = {
  kind: 'design68_characters_final_report_reconciled', observedAt: checkpoint.updatedAt,
  inputHash: baseline.inputHash, scope: report.scope, runId: run.id, reportId: report.id,
  snapshotPath, snapshotSha256: sha(checkpointBytes), reportSha256: sha(JSON.stringify(report)),
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  stagesCompleted: replay.completedStages, totalStages: replay.totalStages,
  originalResponsesReplayed: replay.responsesReplayed, responseReplay: replay.responseReplay,
  retainedFailures: replay.failures, finalReportMatchesReconstruction: true, reportStatus: report.status,
  resolvedSourceDeferrals: report.resolvedDeferrals,
  checks: report.checks.map(({ evidence, ...check }) => ({ ...check, evidenceCount: evidence.length })),
  retainedFindings, weakenedIntermediateFindings, selectedFinalOrigins, finalVerdictsRetainRawNegativeSeverity: true,
  adjudicationSources, disputedExplanationPaths,
  workerProtectedHistoryCheck: checkpoint.protectedHistoryUnchanged,
  otherAreas: checkpoint.runs.filter(run => run.input.area !== 'characters').map(run => ({ area: run.input.area, status: run.status })),
  modelCalls: 0, productionWrites: 0, questionsClosed: 0, designApproved: false, proseGenerated: false,
  limitation: 'Replay verifies provenance, canonical requests, final report reconstruction and retained verdict severity. It does not prove the semantic correctness of passing or negative explanations, inclusion of every independent issue in a single criterion explanation, or design acceptance. Reconcile the preserved primary-source counterevidence and genuine gaps before revising. History protection is the worker assertion, not an independent database snapshot.',
};
fs.writeFileSync(snapshotPath, checkpointBytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-characters-final.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ reportStatus: proof.reportStatus, stages: proof.stagesCompleted,
  responsesReplayed: proof.originalResponsesReplayed, retainedFailures: replay.failures.length,
  retainedFindings: retainedFindings.map(check => `${check.stageId}/${check.criterion}=${check.verdict}`),
  weakenedIntermediateFindings, checks: proof.checks,
  finalReportMatchesReconstruction: true, modelCalls: 0, productionWrites: 0 }));
