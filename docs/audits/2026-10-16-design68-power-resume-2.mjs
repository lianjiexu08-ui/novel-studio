import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const control = 'data/audit-runtimes/design68-review';
const oldBytes = fs.readFileSync(`${control}/segment-1.json`);
assert.equal(sha(oldBytes), '015a3afc4da4cf1dfa689c24e229aa88b4bc22715e3be8f80610ae8b0f7231f6');
const old = JSON.parse(oldBytes), current = JSON.parse(fs.readFileSync(`${control}/result.json`));
assert.equal(old.status, 'stopped_after_failure');
assert.equal(current.segment, 2);
assert.equal(current.priorCheckpointSha256, sha(oldBytes));
assert.equal(current.previousCalls, old.totalCalls);
assert.equal(current.previousCalls, 118);
for (const key of ['inputHash', 'runnerSha256', 'settingsSha256', 'model', 'maxCalls', 'fallback']) assert.equal(current[key], old[key]);
let preservedStages = 0, preservedFailures = 0;
for (const previousRun of old.runs) {
  const run = current.runs.find(r => r.id === previousRun.id);
  assert.ok(run);
  assert.deepEqual(run.input, previousRun.input);
  for (const previousStage of previousRun.stages) {
    const stage = run.stages.find(s => s.id === previousStage.id);
    assert.ok(stage);
    if (previousStage.result) { assert.deepEqual(stage, previousStage); preservedStages++; }
    for (const [index, failure] of (previousStage.failures ?? []).entries()) {
      assert.deepEqual(stage.failures[index], failure); preservedFailures++;
    }
  }
}
for (const report of old.reports) assert.deepEqual(current.reports.find(r => r.id === report.id), report);
const stageId = 'followup-cross-1-2/counters';
const stage = old.runs.find(r => r.input.area === 'power').stages.find(s => s.id === stageId);
assert.equal(stage.result, undefined);
const failure = stage.failures.at(-1);
const responses = failure.modelResponses.map(raw => {
  const check = JSON.parse(raw).checks[0];
  return { sha256: sha(raw), criterion: check.criterion, verdict: check.verdict, evidenceCount: check.evidence.length, resolves: check.resolves ?? null };
});
assert.equal(responses[0].evidenceCount, 147);
assert.deepEqual(responses[0].resolves, ['cross-1-2/counters']);
assert.equal(responses[1].evidenceCount, 39);
assert.equal(responses[1].resolves, null);
const proof = {
  kind: 'design68_exact_checkpoint_resume_segment_2', observedAt: current.updatedAt,
  previousCheckpointPath: `${control}/segment-1.json`, previousCheckpointSha256: sha(oldBytes),
  previousPid: old.pid, resumedPid: current.pid, inputHash: current.inputHash,
  stageId, sameRunId: true, previousCalls: 118, totalCallCeilingUnchanged: current.maxCalls,
  preservedCompletedStages: preservedStages, preservedFailureRecords: preservedFailures,
  preservedReports: old.reports.length, failure: { error: failure.error, responses },
  sameInputsRuntimeSettingsModelAndBudget: true,
  workerHistoryAssertion: current.protectedHistoryUnchanged,
  modelCallsByThisAudit: 0, productionWritesByThisAudit: 0, formalAcceptance: false,
  limitation: 'Verifies checkpoint lineage, completed stages and retained failures/reports. Does not validate an unaccepted response, fill missing resolves, approve design or independently compare the production database. Process liveness is checked separately with ps.',
};
fs.writeFileSync('docs/audits/2026-10-16-design68-power-resume-2.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ resumedPid: current.pid, preservedStages, preservedFailures, evidenceCounts: responses.map(r => r.evidenceCount), productionWritesByThisAudit: 0 }));
