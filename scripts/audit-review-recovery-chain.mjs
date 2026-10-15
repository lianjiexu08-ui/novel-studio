import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const hash = value => digest(JSON.stringify(value));
const terminal = new Set(['completed_with_failures', 'stopped_after_failure', 'completed']);

function uniqueMap(items, label) {
  assert.ok(Array.isArray(items), `${label} must be an array`);
  const map = new Map();
  for (const item of items) {
    assert.ok(item.id && !map.has(item.id), `${label} contains duplicate or missing IDs`);
    map.set(item.id, item);
  }
  return map;
}

/** Verify ordered checkpoint bytes; never read a database or accept a design.
 * The last checkpoint may be running for a prefix audit. Final acceptance must
 * independently check worker exit, persisted state, schedules and final reports.
 */
export function auditReviewRecoveryChain(checkpointBytes) {
  assert.ok(checkpointBytes.length >= 2, 'Supply the original and every recovery checkpoint');
  const chain = checkpointBytes.map(bytes => ({ value: JSON.parse(bytes.toString()), sha256: digest(bytes) }));
  assert.equal(chain[0].value.priorCheckpointSha256, undefined, 'Chain must start at the original queue');
  const records = [];
  let previous;
  for (const entry of chain) {
    const current = entry.value;
    assert.equal(current.protectedHistoryUnchanged, true, 'Protected history check is missing');
    const runs = uniqueMap(current.runs, 'runs'), reports = uniqueMap(current.reports, 'reports');
    assert.ok(Array.isArray(current.areas) && current.areas.length > 0, 'Missing areas');
    assert.equal(new Set(current.areas.map(a => a.area)).size, current.areas.length, 'Duplicate area');
    assert.equal(new Set(current.areas.map(a => a.runId)).size, current.areas.length, 'Duplicate area run');
    assert.equal(runs.size, current.areas.length, 'Unexpected run count');
    for (const area of current.areas) {
      assert.equal(runs.get(area.runId)?.input.area, area.area, 'Area points to a different run');
    }
    for (const run of runs.values()) {
      uniqueMap(run.stages, 'stages');
      if (run.reportId) assert.ok(reports.has(run.reportId), 'Missing saved report');
    }
    const calls = previous ? current.totalCalls : current.usage?.calls;
    assert.ok(Number.isSafeInteger(calls) && calls >= 0, 'Invalid cumulative call count');
    assert.ok(Number.isSafeInteger(current.maxCalls) && calls <= current.maxCalls, 'Call budget exceeded');
    if (previous) {
      const prior = previous.value;
      assert.ok(terminal.has(prior.status), 'Cannot recover from a nonterminal checkpoint');
      assert.equal(current.priorCheckpointSha256, previous.sha256, 'Missing or modified recovery checkpoint');
      for (const key of ['runtimeCommit', 'rubricVersion', 'scheduleVersion', 'scope', 'areas', 'maxCalls']) {
        assert.equal(hash(current[key]), hash(prior[key]), `Recovery changed ${key}`);
      }
      const priorCalls = prior.totalCalls ?? prior.usage.calls;
      assert.equal(current.priorUsage?.calls, priorCalls, 'Recovery reset earlier usage');
      assert.ok(Number.isSafeInteger(current.resumeUsage?.calls) && current.resumeUsage.calls >= 0, 'Invalid recovery usage');
      assert.equal(calls, priorCalls + current.resumeUsage.calls, 'Recovery cumulative usage mismatch');
      for (const oldRun of prior.runs) {
        const run = runs.get(oldRun.id);
        assert.ok(run, 'Recovery lost an original run');
        assert.equal(hash(run.input), hash(oldRun.input), 'Recovery changed review input');
        assert.equal(run.scheduleVersion, oldRun.scheduleVersion, 'Recovery changed run schedule');
        if (oldRun.status === 'completed') assert.equal(hash(run), hash(oldRun), 'Completed run changed');
        const stages = new Map(run.stages.map(stage => [stage.id, stage]));
        for (const oldStage of oldRun.stages) {
          const stage = stages.get(oldStage.id);
          assert.ok(stage, 'Recovery removed a stage');
          if (oldStage.result) assert.equal(hash(stage), hash(oldStage), 'Completed stage changed');
          const failures = oldStage.failures ?? [];
          assert.equal(hash((stage.failures ?? []).slice(0, failures.length)), hash(failures), 'Recovery altered failure history');
        }
      }
      for (const report of prior.reports) assert.equal(hash(reports.get(report.id)), hash(report), 'Recovery altered an existing report');
    }
    records.push({ sha256: entry.sha256, status: current.status, calls, completedStages: [...runs.values()].reduce((sum, run) => sum + run.stages.filter(stage => stage.result).length, 0) });
    previous = entry;
  }
  return { verification: 'verified', checkpoints: records, modelCalls: 0, databaseWrites: false, designApproved: false };
}
