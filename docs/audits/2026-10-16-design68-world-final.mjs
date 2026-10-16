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
for (const [path, expected] of Object.entries(binding.sourceHashes)) {
  assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
}
const run = checkpoint.runs.find(run => run.input.area === 'world');
assert.equal(run.status, 'completed', 'Wait for the same worker to complete world review');
const report = checkpoint.reports.find(report => report.id === run.reportId);
assert.ok(report);
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const replay = await replayDesignReviewPrefix(run, JSON.parse(inputsBytes).world, { ...runtime, JsonDesignPlanner });
const rebuilt = runtime.completeDesignReviewRun(run);
assert.equal(report.runId, run.id);
assert.equal(report.inputHash, baseline.inputHash);
assert.deepEqual(report.scope, rebuilt.input.scope);
assert.deepEqual(report.sources, rebuilt.input.sources);
for (const key of ['summary', 'checks', 'resolvedDeferrals']) {
  assert.deepEqual(canonical(report[key] ?? null), canonical(rebuilt.result[key] ?? null), key);
}
assert.equal(report.status, 'needs_revision');
assert.equal(report.checks.find(check => check.criterion === 'geography').verdict, 'revise');
const path = ['cross-5-6', 'synthesis-11', 'synthesis-25', 'synthesis-31', 'synthesis-35', 'synthesis-36', 'synthesis-37'];
const propagation = path.map(id => {
  const stage = run.stages.find(stage => stage.id === id);
  const check = stage.result.checks.find(check => check.criterion === 'geography');
  assert.equal(check.verdict, 'revise', `Negative finding lost at ${id}`);
  return { stageId: id, verdict: check.verdict, stageSha256: sha(JSON.stringify(stage)) };
});
const snapshotPath = `${control}/world-completed.json`;
const proof = {
  kind: 'design68_world_final_report_reconciled', observedAt: checkpoint.updatedAt,
  inputHash: baseline.inputHash, scope: report.scope, runId: run.id, reportId: report.id,
  snapshotPath, snapshotSha256: sha(checkpointBytes), reportSha256: sha(JSON.stringify(report)),
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  sourceCount: run.input.sources.length, sourceCharacters: run.input.sources.reduce((sum, source) => sum + source.text.length, 0),
  stagesCompleted: replay.completedStages, totalStages: replay.totalStages,
  originalResponsesReplayed: replay.responsesReplayed, responseReplay: replay.responseReplay,
  finalReportMatchesReconstruction: true, reportStatus: report.status,
  resolvedSourceDeferrals: report.resolvedDeferrals,
  checks: report.checks.map(({ evidence, ...check }) => ({ ...check, evidenceCount: evidence.length })),
  negativePropagation: propagation,
  workerProtectedHistoryCheck: checkpoint.protectedHistoryUnchanged,
  otherAreas: checkpoint.runs.filter(run => run.input.area !== 'world').map(run => ({ area: run.input.area, status: run.status })),
  modelCalls: 0, productionWrites: 0, questionsClosed: 0, designApproved: false, proseGenerated: false,
  limitation: 'Verifies the completed world report and response provenance only. The report requires revision; power, characters, story, candidate validation, blocker disposition and prose acceptance remain separate. History protection is the worker checkpoint assertion, not a new independent database comparison.',
};
fs.writeFileSync(snapshotPath, checkpointBytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-world-final.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ reportStatus: proof.reportStatus, stages: proof.stagesCompleted,
  responsesReplayed: proof.originalResponsesReplayed, negativePropagation: propagation,
  finalReportMatchesReconstruction: true, modelCalls: 0, productionWrites: 0 }));
