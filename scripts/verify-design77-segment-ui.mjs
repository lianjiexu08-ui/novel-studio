// Reusable read-only evidence binder for subsequent stopped design77 segments.
// Browser captures must be produced separately through the UI tool.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = p => JSON.parse(fs.readFileSync(p));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const argument = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const segment = Number(argument('segment')), apiPid = Number(argument('api-pid'));
assert.ok(Number.isSafeInteger(segment) && segment > 0);
assert.ok(Number.isSafeInteger(apiPid) && apiPid > 0);
const directory = 'data/audit-runtimes/design77-shared-review';
const verificationPath = `docs/audits/2026-10-18-design77-shared-review-segment-${segment}.json`;
const verification = read(verificationPath), state = read(`${directory}/result.json`);
assert.equal(state.segment, segment);
assert.equal(sha(`${directory}/result.json`), verification.checkpointSha256);
assert.equal(verification.unsettledCalls, 0);
assert.equal(verification.workerAbsent, true);
assert.ok(state.status.startsWith('stopped_') || state.status === 'completed');
assert.ok(state.runs.every(run => !run.leaseToken));
try { process.kill(state.pid, 0); assert.fail('Review worker still live'); } catch (error) { assert.equal(error.code, 'ESRCH'); }
const axPath = `${directory}/segment-${segment}-ui-ax.txt`, ax = fs.readFileSync(axPath, 'utf8');
const labels = { world: '世界、势力与历史', power: '力量、功法与法宝', characters: '人物、关系与认知', story: '主线、分卷与章纲' };
const expected = ['当前世界观 v 41  · 故事圣经 v 73  · 最新计划 v 77  · 批准计划 v 10',
  '正文生产尚未开放', '41 条阻塞', '计划 v77 · 待批准提案', '历史评审任务与批次（99）',
  ...state.runs.map(run => `${labels[run.input.area]} · ${run.stages.filter(stage => stage.result).length}/${run.stages.length} 步`)];
for (const text of expected) assert.ok(ax.includes(text), text);
const apiPath = `data/audit-runtimes/design77-api-start-${apiPid}.json`, api = read(apiPath);
assert.equal(api.pid, apiPid); process.kill(apiPid, 0);
assert.deepEqual(await (await fetch('http://127.0.0.1:8787/health')).json(), { ok: true });
const binding = read('data/audit-runtimes/design77-runtime-bound.json');
assert.equal(api.sourceCommit, binding.sourceCommit);
let annotations;
const notesProofPath = argument('notes-proof');
if (notesProofPath) {
  const saved = read(notesProofPath);
  assert.equal(saved.verified, true);
  assert.equal(saved.baseCheckpointSha256, verification.checkpointSha256);
  assert.equal(saved.verdictChanges, 0);
  for (const note of saved.notes) {
    const response = await fetch(`http://127.0.0.1:8787/works/${state.scope.workId}/design/review-annotations?runId=${note.runId}&stageId=${note.stageId}`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).annotations.find(value => value.id === note.id), note);
  }
  annotations = { proofPath: notesProofPath, proofSha256: sha(notesProofPath), added: saved.notes.length,
    oldPreserved: saved.oldAnnotationsPreserved, actualHttpRecordsVerified: true, originalVerdictsUnchanged: true };
}
const http = fs.readFileSync(`${directory}/http.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const segmentRequests = http.filter(event => event.at >= state.startedAt && event.at <= state.finishedAt);
const logs = [`/tmp/novel-design77-shared-review-segment${segment}.log`, `/tmp/novel-design77-shared-review-verify-segment${segment}.log`, `/tmp/novel-design77-api-after-segment${segment}.log`];
const logHashes = {};
for (const log of logs) {
  const target = `${directory}/logs/${log.split('/').at(-1)}`;
  fs.mkdirSync(`${directory}/logs`, { recursive: true });
  fs.copyFileSync(log, target, fs.constants.COPYFILE_EXCL); logHashes[target] = sha(target);
}
const screenshotPath = `${directory}/segment-${segment}-review.png`;
const result = { verified: true, segment, status: state.status, totalModelCalls: state.totalCalls,
  newModelCalls: state.totalCalls - state.previousCalls, completedThisSegment: state.completedThisSegment,
  verificationPath, verificationSha256: sha(verificationPath), checkpointSha256: verification.checkpointSha256,
  axPath, axSha256: sha(axPath), screenshotPath, screenshotSha256: sha(screenshotPath),
  apiPath, apiSha256: sha(apiPath), apiPid, sourceCommit: api.sourceCommit,
  frontend: 'data/audit-ui/design77-review/dist', displayedChecks: expected, logHashes,
  segmentHttpRequests: segmentRequests.length, segmentHttpErrors: segmentRequests.filter(event => event.statusCode >= 500),
  noReviewLeaseHeld: true, preserved: verification.preserved, annotations,
  modelCalls: 0, productionWrites: 0, formalAcceptance: false };
fs.writeFileSync(`docs/audits/2026-10-18-design77-segment-${segment}-ui-verified.json`, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ verified: true, segment, apiPid, newModelCalls: result.newModelCalls, completedThisSegment: state.completedThisSegment, formalAcceptance: false }));
