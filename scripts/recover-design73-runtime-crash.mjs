// Convert a dead worker's non-terminal checkpoint into an explicit resumable
// failure record. This only updates the audit checkpoint; it never touches the
// production database or review records.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const checkpointPath = 'data/audit-runtimes/design73-review/result.json';
const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
assert.equal(checkpoint.status, 'running');
let alive = false;
try { process.kill(checkpoint.pid, 0); alive = true; } catch (error) { assert.equal(error.code, 'ESRCH'); }
assert.equal(alive, false, 'The crashed worker must be exited before recovery');
checkpoint.status = 'stopped_after_failure';
checkpoint.errors.push({
  step: checkpoint.activeStep,
  error: 'Worker terminated by runtime error: Failed to convert rust `String` into napi `string`',
});
checkpoint.finishedAt = new Date().toISOString();
const temporaryPath = `${checkpointPath}.pending`;
fs.writeFileSync(temporaryPath, JSON.stringify(checkpoint, null, 2) + '\n');
fs.renameSync(temporaryPath, checkpointPath);
console.log(JSON.stringify({ status: checkpoint.status, segment: checkpoint.segment,
  completedStages: checkpoint.runs.map(run => ({ id: run.id,
    completed: run.stages.filter(stage => stage.result).length, total: run.stages.length })),
  totalCalls: checkpoint.totalCalls }));
