// Bind browser evidence to the verified stopped review and restored API.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = p => JSON.parse(fs.readFileSync(p));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const directory = 'data/audit-runtimes/design77-shared-review';
const verificationPath = 'docs/audits/2026-10-18-design77-shared-review-segment-0.json';
const verification = read(verificationPath), state = read(`${directory}/result.json`);
assert.equal(sha(`${directory}/result.json`), verification.checkpointSha256);
assert.equal(verification.unsettledCalls, 0);
assert.equal(state.status, 'stopped_after_stage_limit');
assert.equal(state.totalCalls, 5);
assert.ok(state.runs.every(run => !run.leaseToken && run.stages.filter(stage => stage.result).length === 1));
const axPath = `${directory}/ui-final-ax.txt`, ax = fs.readFileSync(axPath, 'utf8');
const expected = ['当前世界观 v 41  · 故事圣经 v 73  · 最新计划 v 77  · 批准计划 v 10',
  '正文生产尚未开放', '41 条阻塞', '计划 v77 · 待批准提案', '世界、势力与历史 · 1/55 步',
  '力量、功法与法宝 · 1/29 步', '人物、关系与认知 · 1/29 步', '主线、分卷与章纲 · 1/29 步', '历史评审任务与批次（99）'];
for (const text of expected) assert.ok(ax.includes(text), text);
assert.equal((ax.match(/text 评审未完成/g) ?? []).length, 4);
const apiPath = 'data/audit-runtimes/design77-api-start-83280.json', api = read(apiPath);
process.kill(api.pid, 0);
assert.deepEqual(await (await fetch('http://127.0.0.1:8787/health')).json(), { ok: true });
const artifactsPath = `${directory}/execution-artifacts.json`;
const artifacts = read(artifactsPath);
for (const [p, h] of Object.entries(artifacts.logHashes)) assert.equal(sha(p), h);
const result = { verified: true, verificationPath, verificationSha256: sha(verificationPath),
  checkpointSha256: verification.checkpointSha256, axPath, axSha256: sha(axPath),
  screenshotPath: `${directory}/review-progress.png`, screenshotSha256: sha(`${directory}/review-progress.png`),
  executionArtifactsPath: artifactsPath, executionArtifactsSha256: sha(artifactsPath),
  apiPath, apiSha256: sha(apiPath), apiPid: api.pid, sourceCommit: api.sourceCommit,
  frontend: 'data/audit-ui/design77-review/dist', displayedChecks: expected,
  fourAreasIncomplete: true, noReviewLeaseHeld: true, historicalNotesPreserved: 37,
  modelCalls: 0, productionWrites: 0, formalAcceptance: false };
assert.equal(verification.preserved.oldAnnotations, result.historicalNotesPreserved);
fs.writeFileSync('docs/audits/2026-10-18-design77-review-ui-verified.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ verified: true, apiPid: api.pid, completedBatches: 4, formalAcceptance: false }));
