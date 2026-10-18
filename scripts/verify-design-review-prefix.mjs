// Prove that a resumed assessment retains an earlier verified prefix exactly.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const previousPath = arg('previous'), currentPath = arg('current'), outputPath = arg('output');
assert.ok(previousPath && currentPath && outputPath, 'Provide --previous, --current and --output');
const read = p => JSON.parse(fs.readFileSync(p));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const previous = read(previousPath), current = read(currentPath);
for (const verification of [previous, current]) {
  assert.equal(sha(verification.checkpointPath), verification.checkpointSha256);
  assert.equal(verification.workerAbsent, true);
  assert.equal(verification.unsettledCalls, 0);
}
const before = read(previous.checkpointPath), after = read(current.checkpointPath);
assert.ok(after.segment > before.segment);
assert.equal(after.inputHash, before.inputHash);
assert.equal(after.priorCheckpointSha256, previous.checkpointSha256);
try { process.kill(after.pid, 0); assert.fail('Current worker is live'); } catch (error) { assert.equal(error.code, 'ESRCH'); }
const retainedStages = [];
for (const oldRun of before.runs) {
  const run = after.runs.find(value => value.id === oldRun.id); assert.ok(run, oldRun.id);
  assert.deepEqual(run.input, oldRun.input);
  assert.deepEqual(run.units, oldRun.units);
  for (const stage of oldRun.stages.filter(value => value.result)) {
    assert.deepEqual(run.stages.find(value => value.id === stage.id), stage, `${run.input.area}/${stage.id}`);
    retainedStages.push({ runId: run.id, area: run.input.area, stageId: stage.id, sha256: hash(stage) });
  }
}
for (const report of before.reports) assert.deepEqual(after.reports.find(value => value.id === report.id), report);
const journalDirectory = path.join(path.dirname(current.checkpointPath), 'model-calls');
for (const entry of previous.journal) {
  const currentEntry = current.journal.find(value => value.callNumber === entry.callNumber);
  assert.deepEqual(currentEntry, entry, `call ${entry.callNumber}`);
  const base = path.join(journalDirectory, String(entry.callNumber).padStart(5, '0'));
  assert.equal(sha(base + '.started.json'), entry.startSha256);
  const response = base + '.response.json', failure = base + '.failure.json';
  assert.notEqual(fs.existsSync(response), fs.existsSync(failure));
  assert.equal(sha(fs.existsSync(response) ? response : failure), entry.outcomeSha256);
}
const result = { verified: true, previousPath, previousSha256: sha(previousPath), currentPath, currentSha256: sha(currentPath),
  previousSegment: before.segment, currentSegment: after.segment, priorCheckpointSha256: previous.checkpointSha256,
  retainedStages, retainedReports: before.reports.length, retainedCalls: previous.journal.length,
  identicalRunInputsAndUnits: true, productionWrites: 0, modelCalls: 0, formalAcceptance: false };
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ verified: true, retainedStages: retainedStages.length, retainedCalls: previous.journal.length }));
