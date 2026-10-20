// Independently replay the complete original and new journal; read production
// through an SQLite backup. Verification never calls a model or changes state.
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
const hash = value => createHash('sha256').update(JSON.stringify(value, (_, v) => v instanceof Map ? [...v] : v)).digest('hex');
const directory = 'data/audit-runtimes/design77-navigation-execution', resultPath = `${directory}/result.json`, resultSha256 = sha(resultPath);
const state = read(resultPath), baseline = read(`${directory}/baseline.json`);
assert.ok(['completed', 'failed', 'stopped_by_signal'].includes(state.status));
try { process.kill(state.pid, 0); assert.fail('Worker is live'); } catch (error) { assert.equal(error.code, 'ESRCH'); }
const bindingPath = 'data/audit-runtimes/design77-navigation-runtime-bound.json', binding = read(bindingPath);
assert.equal(sha(bindingPath), baseline.bindingSha256); assert.equal(sha('scripts/run-design77-navigation-rechecks.mjs'), baseline.runnerSha256);
for (const [file, digest] of Object.entries(binding.sourceHashes)) assert.equal(sha(`${binding.runtimePath}/${file}`), digest);
for (const [file, digest] of Object.entries(binding.dependencyHashes)) assert.equal(sha(file), digest);
const oldControl = 'data/audit-runtimes/design77-formal-continuation', old = read(`${oldControl}/result.json`);
assert.equal(sha(`${oldControl}/result.json`), baseline.oldCheckpointSha256);
const oldProof = read('docs/audits/2026-10-18-design77-formal-continuation-segment-3.json');
assert.equal(oldProof.checkpointSha256, baseline.oldCheckpointSha256);
const oldCalls = oldProof.journal.map(item => {
  const prefix = `${oldControl}/model-calls/${String(item.callNumber).padStart(5, '0')}`;
  const outcome = item.responseSha256 ? `${prefix}.response.json` : `${prefix}.failure.json`;
  assert.equal(sha(`${prefix}.started.json`), item.startSha256); assert.equal(sha(outcome), item.outcomeSha256);
  const start = read(`${prefix}.started.json`);
  return { key: `original/${item.callNumber}`, callNumber: item.callNumber, stageId: start.step.stageId, runId: start.step.runId, request: start.request,
    response: item.responseSha256 ? read(outcome).response : undefined };
});
const starts = fs.readdirSync(directory).filter(name => /^\d{3}\.started\.json$/.test(name)).sort(); assert.equal(starts.length, state.calls);
const newCalls = starts.map((name, index) => {
  const start = read(`${directory}/${name}`); assert.equal(start.number, index + 1);
  const responsePath = `${directory}/${name.replace('.started.', '.response.')}`, failurePath = `${directory}/${name.replace('.started.', '.failure.')}`;
  assert.notEqual(fs.existsSync(responsePath), fs.existsSync(failurePath), 'Call needs exactly one durable outcome');
  return { key: `navigation/${start.number}`, stageId: start.step.stageId, runId: state.runId, request: start.request,
    response: fs.existsSync(responsePath) ? read(responsePath).response : undefined,
    startSha256: sha(`${directory}/${name}`), outcomeSha256: sha(fs.existsSync(responsePath) ? responsePath : failurePath) };
});
const allCalls = [...oldCalls, ...newCalls];
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const replays = [];
for (const run of state.runs) {
  const prior = old.runs.find(item => item.id === run.id); assert.ok(prior); assert.deepEqual(run.input, prior.input);
  for (const stage of prior.stages.filter(stage => stage.result)) assert.deepEqual(run.stages.find(item => item.id === stage.id), stage);
  for (const stage of run.stages) {
    const received = allCalls.filter(call => call.runId === run.id && call.stageId === stage.id && call.response).map(call => call.response.text);
    const saved = [...(stage.failures ?? []).flatMap(failure => failure.modelResponses ?? []), ...(stage.result ? stage.modelResponses ?? [] : [])];
    assert.deepEqual(received, saved, stage.id);
  }
  const accepted = run.stages.filter(stage => stage.result).flatMap(stage => allCalls.filter(call => call.runId === run.id && call.stageId === stage.id && call.response).slice(-(stage.modelResponses?.length ?? 0)));
  let calls = 0;
  class JournalPlanner extends JsonDesignPlanner {
    constructor(client) { super({ complete: async request => {
      const saved = accepted[calls++]; assert.ok(saved);
      assert.equal(request.user, saved.request.user); assert.equal(request.maxOutputTokens, saved.request.maxOutputTokens);
      if (saved.key.startsWith('navigation/') || saved.callNumber === 22) assert.equal(request.system, saved.request.system);
      else { assert.ok(saved.request.system.startsWith(request.system)); assert.ok(saved.request.system.endsWith(sourceNavigationGuidance)); }
      return client.complete(request);
    } }); }
  }
  const replay = await replayDesignReviewRecord(run, run.input, state.reports.find(report => report.id === run.reportId), { ...runtime, JsonDesignPlanner: JournalPlanner });
  assert.equal(calls, accepted.length); replays.push({ area: run.input.area, ...replay });
}
const snapshot = path.resolve(directory, 'verified-production.db'); assert.ok(!fs.existsSync(snapshot));
execFileSync('python3', ['-c', "import sqlite3,sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()", path.resolve('data/novel-studio.db'), snapshot]);
const { PrismaClient } = createRequire(`${binding.runtimePath}/package.json`)('@prisma/client');
const { PrismaWorkRepository } = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const client = new PrismaClient({ datasources: { db: { url: `file:${snapshot}` } } }), repo = new PrismaWorkRepository(client);
let work;
try { work = await repo.get(state.workId); } finally { await repo.disconnect(); await client.$disconnect(); }
assert.ok(work);
const fields = Object.fromEntries(Object.keys(work).sort().map(key => [key, hash(work[key])])); assert.deepEqual(fields, state.workFieldDigests);
for (const [key, digest] of Object.entries(baseline.fields)) if (!['designReviewRuns', 'designReviewAnnotations', 'constraintRevision'].includes(key)) assert.equal(fields[key], digest, key);
for (const [id, digest] of baseline.runs) if (id !== state.runId) assert.equal(hash(work.designReviewRuns.get(id)), digest);
for (const [id, digest] of baseline.annotations) assert.equal(hash(work.designReviewAnnotations.get(id)), digest);
for (const run of state.runs) assert.deepEqual(work.designReviewRuns.get(run.id), run);
for (const note of state.notes) assert.deepEqual(work.designReviewAnnotations.get(note.id), note);
assert.equal(work.designReviewAnnotations.size, 41 + state.notes.length); assert.equal(work.designReviewRuns.size, 103); assert.equal(work.designContentReviews.size, 92);
const updated = work.designReviewRuns.get(state.runId);
for (const completed of state.completed) assert.deepEqual(updated.stages.find(stage => stage.id === completed.stageId).result, completed.result);
const context = runtime.designReviewResolutionContext(updated);
assert.equal(sha(resultPath), resultSha256);
fs.copyFileSync(resultPath, `${directory}/terminal.json`, fs.constants.COPYFILE_EXCL);
const proof = { verified: true, status: state.status, sourceCommit: binding.sourceCommit, resultSha256, runtimeBindingSha256: sha(bindingPath),
  model: state.model, fallback: state.fallback, originalCalls: oldCalls.length, newCalls: newCalls.length,
  unsettledCalls: 0, newFailedCalls: newCalls.filter(call => !call.response).length, oldCompletedStagesPreserved: 25,
  oldRunsPreserved: 102, oldReportsPreserved: 92, oldAnnotationsPreserved: 41, newAnnotations: state.notes.length,
  replays, completed: state.completed, newJournal: newCalls.map(({ request, response, ...call }) => call), resolutionContext: context,
  databaseSnapshotPath: snapshot, liveReadback: true, modelCalls: 0, productionWrites: 0, formalAcceptance: false, proseGenerated: false };
fs.writeFileSync('docs/audits/2026-10-20-design77-navigation-rechecks-verified.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx', flush: true });
console.log(JSON.stringify({ verified: true, status: state.status, newCalls: newCalls.length, completed: state.completed.map(item => ({ criterion: item.criterion, verdict: item.result.checks[0].verdict })), newAnnotations: state.notes.length, formalAcceptance: false }));
