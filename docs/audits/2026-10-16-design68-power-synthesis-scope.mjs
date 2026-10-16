// Preserve a local synthesis overclaim without changing the live verdict.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => JSON.parse(fs.readFileSync(path));
const control = 'data/audit-runtimes/design68-review';
const checkpointBytes = fs.readFileSync(`${control}/result.json`);
const checkpoint = JSON.parse(checkpointBytes);
const baseline = read(`${control}/baseline.json`);
const binding = read('data/audit-runtimes/design68-runtime-bound.json');
const inputBytes = fs.readFileSync(`${control}/inputs.json`);
assert.equal(sha(inputBytes), baseline.inputsSha256);
for (const [path, expected] of Object.entries(binding.sourceHashes)) assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
const run = checkpoint.runs.find(run => run.input.area === 'power');
assert.deepEqual(run.input, JSON.parse(inputBytes).power);
const stage = run.stages.find(stage => stage.id === 'synthesis-1');
const { designReviewStageInput } = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const request = designReviewStageInput(run, stage);
let calls = 0;
const planner = new JsonDesignPlanner({ complete: async () => {
  assert.ok(calls < stage.modelResponses.length);
  return stage.modelResponses[calls++];
} });
const { modelResponses, ...result } = await planner.reviewDesignContent(request);
assert.deepEqual(JSON.parse(JSON.stringify(result)), stage.result);
assert.deepEqual(modelResponses, stage.modelResponses);
assert.equal(request.stage.coverage.synthesis.scope, 'partial_reports');
assert.deepEqual(request.stage.coverage.synthesis.coveredStageIds, ['batch-1', 'batch-2']);
const resolutions = request.stage.coverage.resolvedDeferrals;
assert.ok(!resolutions.some(item => item.checkId === 'batch-1/tiers'));
const source = request.sources.find(source => source.id === 'review-result/batch-1');
const original = run.stages.find(stage => stage.id === 'batch-1').result.checks.find(check => check.criterion === 'tiers');
assert.equal(original.verdict, 'insufficient');
assert.ok(original.awaitingSources.length);
assert.ok(source.text.includes('"criterion": "tiers",\n  "verdict": "insufficient"'));
assert.ok(source.text.includes('其他返修和普通不足仍然有效'));
assert.ok(stage.result.summary.includes('历史材料不足已由系统登记的原文复核解决'));
assert.equal(stage.result.checks.find(check => check.criterion === 'tiers').verdict, 'pass');
const followup = run.stages.find(stage => stage.id === 'followup-batch-1/tiers');
assert.equal(followup.result.checks[0].verdict, 'revise');
const snapshotPath = `${control}/power-synthesis-scope.json`;
const proof = {
  kind: 'design68_local_synthesis_unresolved_deferral_overclaim', observedAt: checkpoint.updatedAt,
  inputHash: baseline.inputHash, runId: run.id, stageId: stage.id,
  snapshotPath, snapshotSha256: sha(checkpointBytes), requestSha256: sha(JSON.stringify(request)),
  stageSha256: sha(JSON.stringify(stage)), savedResponsesReplayed: calls,
  scope: request.stage.coverage.synthesis,
  originalSummary: stage.result.summary,
  originalTierCheck: stage.result.checks.find(check => check.criterion === 'tiers'),
  resolvedBatch1Checks: resolutions.filter(item => item.checkId.startsWith('batch-1/')),
  unresolvedOriginalCheck: original,
  deliveredReportSource: { id: source.id, sha256: sha(source.text), prefix: source.text.slice(0, source.text.indexOf('BEGIN INDEPENDENT QUOTE')) },
  existingFollowup: { stageId: followup.id, verdict: 'revise', sha256: sha(JSON.stringify(followup)),
    limitation: 'The followup itself contains a disputed character-weight attribution. Its existence proves a retained negative, not the correctness of every claim in it.' },
  adjudication: 'Local synthesis claims prior 1–50 source insufficiencies were resolved, although batch-1/tiers is absent from the explicit resolution ledger and its insufficient check remains in the delivered child report. Do not use the local pass as overall acceptance or as a closure event.',
  modelCalls: 0, productionWrites: 0, originalVerdictsChanged: false, questionsClosed: 0, formalAcceptance: false,
  nextStep: 'Preserve the contradiction for the complete power report reconstruction and semantic reconciliation. Verify that retained original negatives still determine the final outcome; do not infer that outcome before all synthesis stages finish.',
};
fs.writeFileSync(snapshotPath, checkpointBytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-power-synthesis-scope.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ stageId: stage.id, savedResponsesReplayed: calls, scope: proof.scope, unresolved: 'batch-1/tiers', modelCalls: 0, productionWrites: 0 }));
