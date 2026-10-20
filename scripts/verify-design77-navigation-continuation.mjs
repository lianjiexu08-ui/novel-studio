// Independently replay original, navigation and continuation journals; production
// is read only through a fresh SQLite snapshot. Preserve failed verifier snapshots.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { replayDesignReviewRecord } from './audit-design-reviews.mjs';
import { sourceNavigationGuidance } from './design-review-source-navigation.mjs';
const read = p => JSON.parse(fs.readFileSync(p));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash = v => createHash('sha256').update(JSON.stringify(v, (_, x) => x instanceof Map ? [...x] : x)).digest('hex');
const control = 'data/audit-runtimes/design77-navigation-continuation';
const checkpoint = `${control}/result.json`, checkpointHash = sha(checkpoint), state = read(checkpoint), baseline = read(`${control}/baseline.json`);
assert.ok(['stopped_after_stage_limit','stopped_after_failure','stopped_after_budget','stopped_by_signal','completed'].includes(state.status));
try { process.kill(state.pid, 0); assert.fail('Worker is live'); } catch (e) { assert.equal(e.code, 'ESRCH'); }
const bindingPath = 'data/audit-runtimes/design77-navigation-runtime-bound.json', binding = read(bindingPath);
assert.equal(sha(bindingPath), baseline.runtimeBindingSha256);
for (const [file, digest] of Object.entries(binding.sourceHashes)) assert.equal(sha(`${binding.runtimePath}/${file}`), digest);
for (const [file, digest] of Object.entries(binding.dependencyHashes)) assert.equal(sha(file), digest);
const prior = read(`${control}/predecessors/navigation-rechecks-result.json`);
assert.equal(sha(`${control}/predecessors/navigation-rechecks-result.json`), baseline.predecessorResultSha256);
assert.equal(sha(`${control}/predecessors/navigation-rechecks-verified.json`), baseline.sourceProofSha256);
assert.equal(sha(`${control}/inputs.json`), baseline.inputsSha256);
const previousSegmentPath = `${control}/segment-${state.segment-1}.json`;
assert.equal(sha(previousSegmentPath), state.priorCheckpointSha256);
const previousSegment = read(previousSegmentPath);
let recoveryBinding;
if (state.segment >= 3) {
  const recoveryPath = `${control}/recovery-binding.json`; recoveryBinding = read(recoveryPath);
  assert.equal(sha(recoveryPath), state.recoveryBindingSha256);
  assert.equal(sha('scripts/run-design77-navigation-continuation.mjs'), recoveryBinding.runnerSha256);
  assert.equal(sha(`${control}/baseline.json`), recoveryBinding.baselineSha256);
  assert.equal(sha(previousSegmentPath), recoveryBinding.checkpointSha256);
  assert.equal(sha('scripts/shared-review-host.mjs'), recoveryBinding.hostHelperSha256);
  assert.equal(sha('docs/audits/2026-10-20-design77-navigation-continuation-segment-2.json'), recoveryBinding.verificationSha256);
  assert.ok(state.stepsStarted.every(s => s.area === recoveryBinding.area && s.stageId === recoveryBinding.stageId));
}
assert.equal(state.previousCalls, previousSegment.totalCalls);
const calls = [];
const add = (key, start, response, failure, startSha256, outcomeSha256, formal = false) => calls.push({key, start, response, failure, startSha256, outcomeSha256, formal});
const originalControl = 'data/audit-runtimes/design77-formal-continuation';
for (const item of read('docs/audits/2026-10-18-design77-formal-continuation-segment-3.json').journal) {
  const prefix = `${originalControl}/model-calls/${String(item.callNumber).padStart(5,'0')}`;
  const start = `${prefix}.started.json`, outcome = `${prefix}.${item.responseSha256 ? 'response' : 'failure'}.json`;
  assert.equal(sha(start), item.startSha256); assert.equal(sha(outcome), item.outcomeSha256);
  add(`original/${item.callNumber}`, read(start), item.responseSha256 ? read(outcome).response : undefined, item.responseSha256 ? undefined : read(outcome), sha(start), sha(outcome), item.callNumber === 22);
}
const navigationControl = 'data/audit-runtimes/design77-navigation-execution';
const navigationProof = read(`${control}/predecessors/navigation-rechecks-verified.json`);
for (const item of navigationProof.newJournal) {
  const number = Number(item.key.split('/')[1]), prefix = `${navigationControl}/${String(number).padStart(3,'0')}`;
  assert.equal(sha(`${prefix}.started.json`), item.startSha256);
  const response = fs.existsSync(`${prefix}.response.json`), outcome = `${prefix}.${response ? 'response' : 'failure'}.json`;
  assert.equal(sha(outcome), item.outcomeSha256);
  const start = read(`${prefix}.started.json`); start.step.runId = prior.runId;
  add(item.key, start, response ? read(outcome).response : undefined, response ? undefined : read(outcome), item.startSha256, item.outcomeSha256, true);
}
const starts = fs.readdirSync(`${control}/model-calls`).filter(n => /^\d{5}\.started\.json$/.test(n)).sort();
assert.equal(starts.length, state.totalCalls);
const newCalls = [];
for (const [index, name] of starts.entries()) {
  const file = `${control}/model-calls/${name}`, start = read(file);
  assert.equal(start.callNumber, index + 1);
  const response = file.replace('.started.', '.response.'), failure = file.replace('.started.', '.failure.');
  assert.notEqual(fs.existsSync(response), fs.existsSync(failure), 'Exactly one durable outcome required');
  add(`continuation/${index+1}`, start, fs.existsSync(response) ? read(response).response : undefined, fs.existsSync(failure) ? read(failure) : undefined, sha(file), sha(fs.existsSync(response) ? response : failure));
  newCalls.push(calls.at(-1));
}
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const replays = [];
for (const run of state.runs) {
  assert.deepEqual(run.input, read(`${control}/inputs.json`)[run.input.area]);
  for (const ancestor of [prior, previousSegment]) {
    const old = ancestor.runs.find(r => r.id === run.id); assert.ok(old); assert.deepEqual(run.input, old.input);
    for (const stage of old.stages.filter(s => s.result)) assert.deepEqual(run.stages.find(s => s.id === stage.id), stage);
  }
  const accepted = [];
  for (const stage of run.stages) {
    const received = calls.filter(c => c.start.step.runId === run.id && c.start.step.stageId === stage.id && c.response);
    const saved = [...(stage.failures ?? []).flatMap(f => f.modelResponses ?? []), ...(stage.result ? stage.modelResponses ?? [] : [])];
    assert.deepEqual(received.map(c => c.response.text), saved, `Raw response mismatch ${run.input.area}/${stage.id}`);
    if (stage.result) { assert.ok(stage.modelResponses?.length); accepted.push(...received.slice(-stage.modelResponses.length)); }
  }
  let count = 0;
  class JournalPlanner extends JsonDesignPlanner {
    constructor(client) { super({ complete: async request => {
      const saved = accepted[count++]; assert.ok(saved);
      assert.equal(saved.start.request.user, request.user); assert.equal(saved.start.request.maxOutputTokens, request.maxOutputTokens);
      if (saved.formal) assert.equal(saved.start.request.system, request.system);
      else if (saved.key.startsWith('continuation/')) assert.equal(saved.start.request.system, request.system + sourceNavigationGuidance);
      else { assert.ok(saved.start.request.system.startsWith(request.system)); assert.ok(saved.start.request.system.endsWith(sourceNavigationGuidance)); }
      return client.complete(request);
    } }); }
  }
  const replay = await replayDesignReviewRecord(run, run.input, state.reports.find(r => r.id === run.reportId), {...runtime, JsonDesignPlanner: JournalPlanner});
  assert.equal(count, accepted.length); replays.push({area:run.input.area, ...replay});
}
assert.ok(newCalls.every(c => state.runs.some(r => r.id === c.start.step.runId && r.stages.some(s => s.id === c.start.step.stageId))));
const snapshot = path.join(fs.mkdtempSync(path.resolve(control,'verify-')), 'production.db');
execFileSync('python3', ['-c', "import sqlite3,sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()", path.resolve('data/novel-studio.db'), snapshot]);
const { PrismaClient } = createRequire(`${binding.runtimePath}/package.json`)('@prisma/client');
const { PrismaWorkRepository } = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const client = new PrismaClient({datasources:{db:{url:`file:${snapshot}`}}}), repo = new PrismaWorkRepository(client);
let work;
try { work = await repo.get(baseline.workId); } finally { await repo.disconnect(); await client.$disconnect(); }
assert.ok(work);
const protectedHash = hash(Object.fromEntries(Object.entries(work).filter(([key]) => !['designReviewRuns','designContentReviews','constraintRevision'].includes(key)).map(([key,v]) => [key, v instanceof Map ? [...v] : v])));
assert.equal(protectedHash, baseline.protectedHash);
for (const [id,digest] of baseline.oldRuns) assert.equal(hash(work.designReviewRuns.get(id)),digest);
for (const [id,digest] of baseline.oldReports) assert.equal(hash(work.designContentReviews.get(id)),digest);
for (const [id,digest] of baseline.oldAnnotations) assert.equal(hash(work.designReviewAnnotations.get(id)),digest);
for (const run of state.runs) assert.deepEqual(work.designReviewRuns.get(run.id),run);
assert.equal(work.designReviewRuns.size,103); assert.equal(work.designContentReviews.size,92); assert.equal(work.designReviewAnnotations.size,44);
assert.equal(work.plans.get(baseline.planId).status,'proposed'); assert.equal(work.plans.get(work.activePlanId).revision,10);
assert.ok([...work.designReviewRuns.values()].every(r => !r.leaseToken));
assert.equal(sha(checkpoint),checkpointHash);
const terminal = `${control}/terminal-segment-${state.segment}.json`;
if (fs.existsSync(terminal)) assert.equal(sha(terminal),checkpointHash); else fs.copyFileSync(checkpoint,terminal,fs.constants.COPYFILE_EXCL);
const proof = {verified:true, status:state.status, segment:state.segment, checkpointSha256:checkpointHash, checkpointPath:terminal,
  baselineSha256:sha(`${control}/baseline.json`), sourceCommit:binding.sourceCommit, runtimeBindingSha256:sha(bindingPath),
  runnerSha256:sha('scripts/run-design77-navigation-continuation.mjs'), runnerBoundBeforeExecution:!!recoveryBinding, earlierSegmentsBoundBeforeExecution:false,
  promptChange:'Continuation calls retain sourceNavigationGuidance but omit the older additional suffix; exact saved requests replayed.',
  originalCalls:35, newCallAttempts:newCalls.length, newResponses:newCalls.filter(c=>c.response).length,
  newFailures:newCalls.filter(c=>c.failure).length, unsettledCalls:0, replays,
  journal:newCalls.map(c=>({key:c.key,step:c.start.step,startSha256:c.startSha256,outcomeSha256:c.outcomeSha256,hasResponse:!!c.response})),
  oldRunsPreserved:99, oldReportsPreserved:92, oldAnnotationsPreserved:44, protectedHash,
  databaseSnapshotPath:snapshot, modelCalls:0, productionWrites:0, formalAcceptance:false, proseGenerated:false,
  limitation:'Earlier failed story response is retained as a failed attempt. Only a separately validated successful attempt can be accepted. This validates saved evidence and immutable history, not full design quality.'};
fs.writeFileSync(`docs/audits/2026-10-20-design77-navigation-continuation-segment-${state.segment}.json`,JSON.stringify(proof,null,2)+'\n',{flag:'wx',flush:true});
console.log(JSON.stringify({verified:true, segment:state.segment, calls:newCalls.length, replays:replays.map(r=>({area:r.area,completed:r.completedStages,total:r.totalStages})),formalAcceptance:false}));
