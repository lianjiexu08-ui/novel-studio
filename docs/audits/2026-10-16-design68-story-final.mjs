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
const run = checkpoint.runs.find(run => run.input.area === 'story');
assert.equal(run.status, 'completed', 'Wait for the same worker to complete story review');
const report = checkpoint.reports.find(report => report.id === run.reportId);
assert.ok(report);
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const replay = await replayDesignReviewPrefix(run, JSON.parse(inputsBytes).story, { ...runtime, JsonDesignPlanner });
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
const synthesisFindings = run.stages.filter(stage => stage.kind === 'synthesis').flatMap(stage => stage.result.checks
  .filter(check => check.verdict !== 'pass')
  .map(({ evidence, ...check }) => ({ stageId: stage.id, ...check, evidenceCount: evidence.length,
    evidenceSha256: sha(JSON.stringify(evidence)), stageSha256: sha(JSON.stringify(stage)) })));
for (const finding of [...retainedFindings, ...synthesisFindings]) {
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
  'docs/audits/2026-10-16-design68-story-explanation-disputes.json',
  'docs/audits/2026-10-16-design68-story-route-dispute.json',
  'docs/audits/2026-10-16-design68-story-resolution-dispute.json',
  'docs/audits/2026-10-16-design68-story-followup-material.json',
].map(path => ({ path, sha256: sha(fs.readFileSync(path)) }));
// Preserve explanations along the actual parent paths for semantic inspection;
// string presence alone cannot prove either correction or propagation.
const disputedExplanationPaths = [
  ...read('docs/audits/2026-10-16-design68-story-explanation-disputes.json').disputes,
  ...read('docs/audits/2026-10-16-design68-story-route-dispute.json').disputes,
  ...read('docs/audits/2026-10-16-design68-story-resolution-dispute.json').disputes,
]
  .map(dispute => ({ issue: dispute.id, stages: dispute.parentPath, criteria: [dispute.criterion] }))
.map(path => ({ issue: path.issue, stages: path.stages.map(id => {
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
assert.equal(run.stages.filter(stage => stage.kind !== 'synthesis').length, 36);
assert.equal(run.stages.length, 71);
assert.equal(report.resolvedDeferrals.length, 23);
const finalOpening = report.checks.find(check => check.criterion === 'opening');
assert.ok(finalOpening.explanation.includes('第44章仓火救援'));
const sceneCounterevidence = ['plan/chapters/37', 'plan/chapters/44'].map(id => {
  const source = run.input.sources.find(source => source.id === id);
  const { title, summary } = JSON.parse(source.text);
  return { sourceId: id, sourceSha256: sha(source.text), title, field: 'summary', quote: summary };
});
assert.equal(sceneCounterevidence[0].title, '火仓留人');
assert.equal(sceneCounterevidence[1].title, '浅滩一剑');
assert.ok(sceneCounterevidence[0].quote.includes('获救伙计自报陆沉川'));
assert.ok(sceneCounterevidence[1].quote.includes('紧接43章244日戌初钩索拖偏的瞬间'));
const finalExplanationDisputes = [{
  issue: 'chapter44_mislabelled_as_warehouse_fire', stageId: 'synthesis-35', criterion: 'opening',
  formalExplanation: finalOpening.explanation,
  correction: '仓火救陆沉川是第37章、第225日夜；第44章、第244日是切索、浅滩过板及落水救援。最终说明把两场行动的章节、场景与部分代价混在一起，不能据此改写正确章纲或增加另一场仓火。',
  evidence: sceneCounterevidence,
}];
const snapshotPath = `${control}/story-completed.json`;
const proof = {
  kind: 'design68_story_final_report_reconciled', observedAt: checkpoint.updatedAt,
  inputHash: baseline.inputHash, scope: report.scope, runId: run.id, reportId: report.id,
  snapshotPath, snapshotSha256: sha(checkpointBytes), reportSha256: sha(JSON.stringify(report)),
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  stagesCompleted: replay.completedStages, totalStages: replay.totalStages,
  originalResponsesReplayed: replay.responsesReplayed, responseReplay: replay.responseReplay,
  retainedFailures: replay.failures, finalReportMatchesReconstruction: true, reportStatus: report.status,
  resolvedSourceDeferrals: report.resolvedDeferrals,
  checks: report.checks.map(({ evidence, ...check }) => ({ ...check, evidenceCount: evidence.length })),
  retainedFindings, synthesisFindings, weakenedIntermediateFindings, selectedFinalOrigins,
  finalVerdictsRetainRawNegativeSeverity: true, finalVerdictsRetainSynthesisNegativeSeverity: true,
  adjudicationSources, disputedExplanationPaths, finalExplanationDisputes,
  workerProtectedHistoryCheck: checkpoint.protectedHistoryUnchanged,
  otherAreas: checkpoint.runs.filter(run => run.input.area !== 'story').map(run => ({ area: run.input.area, status: run.status })),
  modelCalls: 0, productionWrites: 0, questionsClosed: 0, designApproved: false, proseGenerated: false,
  limitation: 'Replay verifies provenance, canonical requests, final report reconstruction and retained verdict severity. It does not prove the semantic correctness of passing or negative explanations, inclusion of every independent issue in a single criterion explanation, or design acceptance. Reconcile the preserved primary-source counterevidence and genuine gaps before revising. History protection is the worker assertion, not an independent database snapshot.',
};
fs.writeFileSync(snapshotPath, checkpointBytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-story-final.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ reportStatus: proof.reportStatus, stages: proof.stagesCompleted,
  responsesReplayed: proof.originalResponsesReplayed, retainedFailures: replay.failures.length,
  retainedFindings: retainedFindings.map(check => `${check.stageId}/${check.criterion}=${check.verdict}`),
  synthesisFindings: synthesisFindings.map(check => `${check.stageId}/${check.criterion}=${check.verdict}`),
  weakenedIntermediateFindings, checks: proof.checks,
  finalReportMatchesReconstruction: true, modelCalls: 0, productionWrites: 0 }));
