// Verify retained failure and exact-checkpoint recovery. No model or DB writes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const control = 'data/audit-runtimes/design68-review';
const previousBytes = fs.readFileSync(`${control}/segment-0.json`);
assert.equal(sha(previousBytes), '72f06a5219ebb568884d6600b18f953495ad0f952e69b0ea7dd21510cb75bcec');
const previous = JSON.parse(previousBytes);
assert.equal(previous.status, 'stopped_after_failure');
assert.equal(previous.totalCalls, 104);
const runId = 'design_run_1a9589a8-f222-4b9b-861c-99adc2d45c80';
const stageId = 'followup-batch-1/tiers';
const oldRun = previous.runs.find(r => r.id === runId);
const oldStage = oldRun.stages.find(s => s.id === stageId);
assert.equal(oldStage.result, undefined);
const failure = oldStage.failures.at(-1);
assert.match(failure.error, /at most 96/);
const responseCounts = failure.modelResponses.map(raw => {
  const result = JSON.parse(raw);
  assert.equal(result.checks[0].evidence.length, 191);
  return { sha256: sha(raw), evidenceCount: result.checks[0].evidence.length,
    unacceptedExplanation: result.checks[0].explanation };
});
assert.equal(responseCounts.length, 2);
const current = JSON.parse(fs.readFileSync(`${control}/result.json`));
assert.equal(current.segment, 1);
assert.equal(current.previousCalls, 104);
assert.equal(current.priorCheckpointSha256, sha(previousBytes));
assert.equal(current.inputHash, previous.inputHash);
assert.equal(current.runnerSha256, previous.runnerSha256);
assert.equal(current.settingsSha256, previous.settingsSha256);
assert.equal(current.maxCalls, previous.maxCalls);
assert.equal(current.model, previous.model);
assert.equal(current.fallback, false);
const run = current.runs.find(r => r.id === runId);
assert.deepEqual(run.input, oldRun.input);
for (const stage of oldRun.stages.filter(s => s.result)) {
  assert.deepEqual(run.stages.find(s => s.id === stage.id), stage);
}
assert.deepEqual(run.stages.find(s => s.id === stageId).failures[0], failure);
// An unaccepted response also mixes two different actors' resource accounts.
const source = id => oldRun.input.sources.find(s => s.id === id);
const s43 = source('plan/chapters/43'), s44 = source('plan/chapters/44');
const c43 = JSON.parse(s43.text), c44 = JSON.parse(s44.text);
assert.ok(c43.cost.includes('凝元伙计一次送钩支出半成真元'));
assert.ok(c43.endState.includes('林敲钟已获岗役回应，现扶栏登船坐稳握剑，尚未施术'));
assert.ok(c44.cost.includes('保守余量五成，一式二成后余三成'));
assert.ok(c44.cost.includes('送钩伙计承接43章四成半真元'));
assert.equal(5 - 0.5, 4.5); // Crew member; never Lin's expenditure.
assert.equal(5 - 2, 3); // Lin; no chapter43 casting.
const proof = {
  kind: 'design68_power_failed_format_recovery_and_actor_account_dispute',
  observedAt: current.updatedAt, checkpointPath: `${control}/segment-0.json`,
  checkpointSha256: sha(previousBytes), runId, stageId,
  oldPid: previous.pid, resumedPid: current.pid, segment: current.segment,
  previousCalls: current.previousCalls, totalCallCeiling: current.maxCalls,
  sameInputsRuntimeSettingsAndModel: true, sameRunId: true,
  completedStagesPreservedExactly: oldRun.stages.filter(s => s.result).length,
  originalFailurePreservedExactly: true, failedResponses: responseCounts,
  dispute: {
    status: 'unaccepted_response_misattributed_crew_cost_to_protagonist',
    explanation: 'Both invalid-format responses assign the crew member’s chapter43 half-unit expenditure to Lin. Chapter43 explicitly says Lin has not cast; chapter44 separately carries crew4.5 and Lin5−2=3. Do not change correct balances based on these unaccepted responses.',
    evidence: [s43, s44].map(s => ({ id: s.id, sha256: sha(s.text), cost: JSON.parse(s.text).cost })),
    equations: { crew: '5−0.5=4.5', protagonist: '5−2=3' },
  },
  modelCallsByThisAudit: 0, productionWritesByThisAudit: 0,
  workerHistoryAssertion: current.protectedHistoryUnchanged,
  formalAcceptance: false, questionsClosed: 0,
  limitation: 'Checkpoint/failure retention and actor-account counterevidence only. Worker liveness is verified separately by ps; this file does not prove completed review, design approval, or prose acceptance.',
};
fs.writeFileSync('docs/audits/2026-10-16-design68-power-resume-1.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ sameRunId: true, resumedPid: current.pid, preservedStages: proof.completedStagesPreservedExactly, failedEvidenceCounts: responseCounts.map(r => r.evidenceCount), modelCallsByThisAudit: 0, productionWritesByThisAudit: 0 }));
