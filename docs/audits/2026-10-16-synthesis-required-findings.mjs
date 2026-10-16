// Read-only regression probe against the real frozen review. No model calls.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as current from '../../novel-service-core/src/design-review-run.ts';
import { validateDesignReview } from '../../novel-service-core/src/design-review.ts';
import { JsonDesignPlanner } from '../../packages/planner/src/index.ts';
import { replayDesignReviewPrefix } from '../../scripts/audit-design-reviews.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file));
const control = 'data/audit-runtimes/design68-review';
const baseline = read(`${control}/baseline.json`);
const binding = read('data/audit-runtimes/design68-runtime-bound.json');
const inputBytes = fs.readFileSync(`${control}/inputs.json`);
assert.equal(sha(inputBytes), baseline.inputsSha256);
for (const [path, expected] of Object.entries(binding.sourceHashes)) assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
assert.equal(sha(fs.readFileSync('scripts/run-design68-review.mjs')), baseline.runnerSha256);
const checkpointBytes = fs.readFileSync(`${control}/result.json`);
const checkpoint = JSON.parse(checkpointBytes);
const original = JSON.stringify(checkpoint);
const frozen = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const inputs = JSON.parse(inputBytes);
const replays = [];
for (const run of checkpoint.runs) {
  assert.equal(run.scheduleVersion, 26);
  let comparedRequests = 0;
  for (const stage of run.stages) {
    if (!stage.result) break;
    assert.deepEqual(current.designReviewStageInput(run, stage), frozen.designReviewStageInput(run, stage));
    comparedRequests++;
  }
  const replay = await replayDesignReviewPrefix(run, inputs[run.input.area], { ...current, JsonDesignPlanner });
  replays.push({ area: run.input.area, comparedRequests, completedStages: replay.completedStages,
    responsesReplayed: replay.responsesReplayed, retainedFailures: replay.failures.length, responseReplay: replay.responseReplay });
}
const power = checkpoint.runs.find(run => run.input.area === 'power');
const oldStage = power.stages.find(stage => stage.id === 'synthesis-1');
const hypothetical = structuredClone(power);
hypothetical.scheduleVersion = 27;
const input = current.designReviewStageInput(hypothetical, hypothetical.stages.find(stage => stage.id === oldStage.id));
assert.deepEqual(input.stage.coverage.synthesis.requiredFindings, [{ stageId: 'batch-1', criterion: 'tiers', verdict: 'insufficient' }]);
assert.deepEqual(input.sources, frozen.designReviewStageInput(power, oldStage).sources);
let rejection;
assert.throws(() => validateDesignReview(input, oldStage.result), error => {
  rejection = error.message;
  return /batch-1\/tiers=insufficient/.test(rejection);
});
assert.equal(JSON.stringify(checkpoint), original);
const snapshotPath = `${control}/synthesis27-regression-snapshot.json`;
const proof = {
  kind: 'v27_real_synthesis_regression_and_v26_compatibility', observedAt: checkpoint.updatedAt,
  inputHash: baseline.inputHash, snapshotPath, snapshotSha256: sha(checkpointBytes),
  currentSourceHashes: Object.fromEntries(['novel-service-core/src/design-review-run.ts', 'novel-service-core/src/design-review.ts', 'packages/planner/src/index.ts'].map(path => [path, sha(fs.readFileSync(path))])),
  frozenSourceFilesUnchanged: Object.keys(binding.sourceHashes).length,
  oldScheduleRequestsExactlyMatch: true, replays,
  counterfactualProbe: { stageId: oldStage.id, originalSchedule: 26, proposedSchedule: 27,
    requiredFindings: input.stage.coverage.synthesis.requiredFindings, sourceTextUnchanged: true,
    oldFalsePassRejected: true, rejection,
    limitation: 'A detached copy tests request generation and validation only; it is not a migrated run, new review, repair response, or accepted result.' },
  modelCalls: 0, productionWrites: 0, formalAcceptance: false,
  limitation: 'The running frozen v26 worker is unchanged. This proves compatibility of the captured completed prefix and rejection of its known false local pass under v27; it does not semantically validate all reports or complete the novel.',
};
fs.writeFileSync(snapshotPath, checkpointBytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-synthesis-required-findings.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ replays, oldFalsePassRejected: true, frozenSourceFilesUnchanged: proof.frozenSourceFilesUnchanged, modelCalls: 0, productionWrites: 0 }));
