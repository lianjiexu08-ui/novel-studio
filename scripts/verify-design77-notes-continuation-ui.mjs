// Bind a stopped continuation's browser capture to its verified saved state.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = p => JSON.parse(fs.readFileSync(p));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const segment = Number(argument('segment')), apiPid = Number(argument('api-pid'));
assert.ok(Number.isSafeInteger(segment) && segment > 1 && Number.isSafeInteger(apiPid) && apiPid > 0);
const control = 'data/audit-runtimes/design77-notes-continuation';
const proofPath = `docs/audits/2026-10-18-design77-notes-continuation-segment-${segment}.json`;
const proof = read(proofPath), state = read(`${control}/result.json`);
assert.equal(state.segment, segment); assert.equal(sha(`${control}/result.json`), proof.checkpointSha256);
assert.equal(proof.workerAbsent, true); assert.equal(proof.unsettledCalls, 0);
try { process.kill(state.pid, 0); assert.fail('Worker still live'); } catch (e) { assert.equal(e.code, 'ESRCH'); }
assert.ok(state.runs.every(run => !run.leaseToken));
const apiPath = `data/audit-runtimes/design77-api-start-${apiPid}.json`, api = read(apiPath);
assert.equal(api.pid, apiPid); process.kill(apiPid, 0);
assert.deepEqual(await (await fetch('http://127.0.0.1:8787/health')).json(), { ok: true });
const notesPath = argument('notes-proof');
let annotations;
if (notesPath) {
  const saved = read(notesPath);
  assert.equal(saved.verified, true); assert.equal(saved.baseCheckpointSha256, proof.checkpointSha256);
  assert.equal(saved.verdictChanges, 0);
  for (const note of saved.notes) {
    const response = await fetch(`http://127.0.0.1:8787/works/${state.scope.workId}/design/review-annotations?runId=${note.runId}&stageId=${note.stageId}`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).annotations.find(item => item.id === note.id), note);
  }
  annotations = { notesPath, notesSha256: sha(notesPath), oldPreserved: saved.oldAnnotationsPreserved,
    added: saved.notes.length, originalVerdictsUnchanged: true, actualHttpRecordsVerified: true };
}
const axPath = `${control}/segment-${segment}-ui-ax.txt`, ax = fs.readFileSync(axPath, 'utf8');
const labels = { world: '世界、势力与历史', power: '力量、功法与法宝', characters: '人物、关系与认知', story: '主线、分卷与章纲' };
const displayedChecks = ['当前世界观 v 41  · 故事圣经 v 73  · 最新计划 v 77  · 批准计划 v 10',
  '正文生产尚未开放', '41 条阻塞', '历史评审任务与批次（99）',
  ...state.runs.map(run => `${labels[run.input.area]} · ${run.stages.filter(s => s.result).length}/${run.stages.length} 步`)];
for (const text of displayedChecks) assert.ok(ax.includes(text), text);
const screenshotPath = `${control}/segment-${segment}-review.jpg`;
assert.equal(fs.readFileSync(screenshotPath).subarray(0, 3).toString('hex'), 'ffd8ff');
fs.mkdirSync(`${control}/logs`, { recursive: true });
const logHashes = {};
for (const name of [`novel-design77-notes-continuation-segment${segment}.log`, `novel-design77-notes-continuation-verify-segment${segment}.log`, `novel-design77-api-after-notes-segment${segment}.log`]) {
  const target = `${control}/logs/${name}`;
  fs.copyFileSync(`/tmp/${name}`, target, fs.constants.COPYFILE_EXCL); logHashes[target] = sha(target);
}
const result = { verified: true, segment, status: state.status, proofPath, proofSha256: sha(proofPath),
  checkpointSha256: proof.checkpointSha256, apiPath, apiSha256: sha(apiPath), apiPid, sourceCommit: api.sourceCommit,
  axPath, axSha256: sha(axPath), screenshotPath, screenshotSha256: sha(screenshotPath), displayedChecks, logHashes,
  totalCalls: state.totalCalls, newCalls: state.totalCalls - state.previousCalls, completedThisSegment: state.completedThisSegment,
  preserved: proof.preserved, annotations, originalInputsUnchanged: true, formalAcceptance: false, modelCalls: 0, productionWrites: 0 };
fs.writeFileSync(`docs/audits/2026-10-18-design77-notes-continuation-segment-${segment}-ui.json`, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ verified: true, segment, displayedChecks: displayedChecks.length, apiPid }));
