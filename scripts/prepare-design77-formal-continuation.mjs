// Read-only binding of the exact live state after the one formal recheck.
// Existing runtime, annotations, input envelopes and journals remain immutable.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const hash = value => createHash('sha256').update(JSON.stringify(value, (_, v) => v instanceof Map ? [...v] : v)).digest('hex');
const oldControl = 'data/audit-runtimes/design77-notes-continuation', formal = 'data/audit-runtimes/design77-formal-reconsideration';
const control = 'data/audit-runtimes/design77-formal-continuation';
assert.ok(!fs.existsSync(control), 'Never overwrite a prior continuation'); fs.mkdirSync(control, { recursive: true });
const save = (name, value) => fs.writeFileSync(`${control}/${name}`, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', flush: true });
const copy = (from, to) => fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
copy(process.argv[1], `${control}/prepare.mjs`);
try {
  const previous = read(`${oldControl}/result.json`), applied = read(`${formal}/apply-live.json`), updated = read(`${formal}/apply-live-run.json`);
  assert.equal(previous.status, 'stopped_after_stage_limit'); assert.equal(previous.totalCalls, 21);
  try { process.kill(previous.pid, 0); assert.fail('Previous worker is live'); } catch (error) { assert.equal(error.code, 'ESRCH'); }
  assert.equal(applied.verified, true); assert.equal(applied.modelCalls, 0);
  const liveProof = 'docs/audits/2026-10-18-design77-formal-reconsideration-live-verified.json';
  const proof = read(liveProof); assert.equal(proof.liveReadback, true); assert.equal(proof.resultSha256, sha(`${formal}/apply-live.json`));
  const bindingPath = 'data/audit-runtimes/design77-formal-runtime-bound.json', binding = read(bindingPath);
  for (const [file, digest] of Object.entries(binding.sourceHashes)) assert.equal(sha(`${binding.runtimePath}/${file}`), digest);
  for (const [file, digest] of Object.entries(binding.dependencyHashes)) assert.equal(sha(file), digest);
  const runs = previous.runs.map(run => run.id === updated.id ? updated : run);
  assert.equal(runs.reduce((sum, run) => sum + run.stages.filter(stage => stage.result).length, 0), 17);
  fs.mkdirSync(`${control}/model-calls`); fs.mkdirSync(`${control}/predecessors`);
  copy(`${oldControl}/result.json`, `${control}/predecessors/old-segment2.json`);
  for (const name of ['apply-live.json', 'apply-live-run.json', '001.started.json', '001.response.json']) copy(`${formal}/${name}`, `${control}/predecessors/${name}`);
  copy(`${oldControl}/inputs.json`, `${control}/inputs.json`);
  copy('scripts/run-design77-formal-continuation.mjs', `${control}/runner.mjs`);
  const prefixJournal = {};
  for (const name of fs.readdirSync(`${oldControl}/model-calls`).sort()) {
    assert.match(name, /^\d{5}\.(started|response)\.json$/);
    copy(`${oldControl}/model-calls/${name}`, `${control}/model-calls/${name}`);
    prefixJournal[name] = sha(`${control}/model-calls/${name}`);
  }
  assert.equal(Object.keys(prefixJournal).length, 42);
  // New numbering is an index wrapper only. Original call bytes remain in
  // predecessors; the actual request and response are copied without editing.
  const started = read(`${formal}/001.started.json`), response = read(`${formal}/001.response.json`);
  const step = { area: 'power', runId: updated.id, stageId: applied.queued.stageId, startedAt: started.at };
  for (const [suffix, value] of [
    ['started', { callNumber: 22, step, startedAt: started.at, request: started.request, provenance: { file: `${formal}/001.started.json`, sha256: sha(`${formal}/001.started.json`) } }],
    ['response', { callNumber: 22, finishedAt: response.at, response: response.response, usage: response.usage, provenance: { file: `${formal}/001.response.json`, sha256: sha(`${formal}/001.response.json`) } }],
  ]) { save(`model-calls/00022.${suffix}.json`, value); prefixJournal[`00022.${suffix}.json`] = sha(`${control}/model-calls/00022.${suffix}.json`); }
  const database = path.resolve(control, 'baseline.db');
  execFileSync('python3', ['-c', "import sqlite3,sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()", path.resolve('data/novel-studio.db'), database]);
  const { PrismaClient } = createRequire(`${binding.runtimePath}/package.json`)('@prisma/client');
  const { PrismaWorkRepository } = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
  const client = new PrismaClient({ datasources: { db: { url: `file:${database}` } } }), repository = new PrismaWorkRepository(client);
  let baseline;
  try {
    const work = await repository.get(previous.scope.workId); assert.ok(work);
    assert.deepEqual(Object.fromEntries(Object.keys(work).sort().map(key => [key, hash(work[key])])), applied.workFieldDigestsAfter);
    for (const run of runs) assert.deepEqual(work.designReviewRuns.get(run.id), run);
    assert.equal(work.designReviewAnnotations.size, 41); assert.equal(work.designReviewRuns.size, 103); assert.equal(work.designContentReviews.size, 92);
    assert.ok(![...work.designReviewRuns.values()].some(run => run.leaseToken));
    const oldBaseline = read(`${oldControl}/baseline.json`);
    const runner = fs.readFileSync('scripts/run-design77-formal-continuation.mjs', 'utf8');
    const oldRunner = fs.readFileSync(`${oldControl}/runner.mjs`, 'utf8');
    const suffixLine = text => text.split('\n').find(line => line.startsWith('const suffix = '));
    assert.equal(suffixLine(runner), suffixLine(oldRunner));
    const { sourceNavigationGuidance } = await import('./design-review-source-navigation.mjs');
    assert.equal(hash(sourceNavigationGuidance), oldBaseline.guidanceHash);
    baseline = { workId: work.id, planId: previous.scope.planId, inputHash: previous.inputHash, createdAt: new Date().toISOString(),
      protectedHash: hash(Object.fromEntries(Object.entries(work).filter(([key]) => !['designReviewRuns', 'designContentReviews', 'constraintRevision'].includes(key)).map(([key, value]) => [key, value instanceof Map ? [...value] : value]))),
      oldRuns: [...work.designReviewRuns].filter(([id]) => !runs.some(run => run.id === id)).map(([id, run]) => [id, hash(run)]),
      oldReports: [...work.designContentReviews].map(([id, report]) => [id, hash(report)]), oldAnnotations: [...work.designReviewAnnotations].map(([id, note]) => [id, hash(note)]),
      runtimePath: binding.runtimePath, runtimeBindingSha256: sha(bindingPath), runnerSha256: sha('scripts/run-design77-formal-continuation.mjs'),
      hostHelperSha256: sha('scripts/shared-review-host.mjs'), suffixSha256: oldBaseline.suffixSha256, guidanceHash: oldBaseline.guidanceHash,
      inputsSha256: sha(`${control}/inputs.json`), maxCalls: oldBaseline.maxCalls, prefixJournal,
      predecessorCheckpointSha256: sha(`${oldControl}/result.json`), formalReconsiderationResultSha256: sha(`${formal}/apply-live.json`), liveVerificationSha256: sha(liveProof), databaseSnapshotPath: database };
  } finally { await repository.disconnect(); await client.$disconnect(); }
  save('baseline.json', baseline);
  const checkpoint = { status: 'prepared_continuation', pid: null, segment: 0, startedAt: baseline.createdAt,
    scope: previous.scope, inputHash: previous.inputHash, model: previous.model, fallback: false, totalCalls: 22,
    areas: previous.areas, runs, reports: [], sourceCommit: binding.sourceCommit, formalAcceptance: false };
  save('result.json', checkpoint);
  const prepared = { verified: true, sourceCommit: binding.sourceCommit, baselineSha256: sha(`${control}/baseline.json`), checkpointSha256: sha(`${control}/result.json`),
    protectedHash: baseline.protectedHash, preservedRuns: 103, preservedReports: 92, preservedAnnotations: 41, completedStages: 17, historicalCalls: 22,
    original21CallFilesUnchanged: true, formalCallWrappedWithoutChangingRequestOrResponse: true, originalInputsUnchanged: true,
    modelCalls: 0, productionWrites: 0, formalAcceptance: false, nextStages: runs.map(run => ({ area: run.input.area, stageId: run.stages.find(stage => !stage.result).id })) };
  fs.writeFileSync('docs/audits/2026-10-18-design77-formal-continuation-preflight.json', JSON.stringify(prepared, null, 2) + '\n', { flag: 'wx', flush: true });
  console.log(JSON.stringify(prepared));
} catch (error) { save('prepare-failure.json', { error: String(error), at: new Date().toISOString(), modelCalls: 0, productionWrites: 0 }); throw error; }
