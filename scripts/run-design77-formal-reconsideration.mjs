// One formal same-run recheck, rehearsed privately, replayed before live apply.
// All calls, failures, snapshots and frozen runtimes are retained append-only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const root = process.cwd(), directory = path.resolve('data/audit-runtimes/design77-formal-reconsideration');
const mode = process.argv[2]; assert.ok(['--snapshot', '--execute-private', '--verify-private', '--apply-live'].includes(mode));
const read = file => JSON.parse(fs.readFileSync(file));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const hash = value => createHash('sha256').update(JSON.stringify(value, (_, v) => v instanceof Map ? [...v] : v)).digest('hex');
const save = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', flush: true });
const bindingPath = path.resolve('data/audit-runtimes/design77-formal-runtime-bound.json'), binding = read(bindingPath);
for (const [file, digest] of Object.entries(binding.sourceHashes)) assert.equal(sha(`${binding.runtimePath}/${file}`), digest);
for (const [file, digest] of Object.entries(binding.dependencyHashes)) assert.equal(sha(file), digest);
const { PrismaClient } = createRequire(`${binding.runtimePath}/package.json`)('@prisma/client');
const { PrismaWorkRepository } = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const { ChapterWorkflow } = await import(`${binding.runtimePath}/packages/application/src/index.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const { designReviewStageInput } = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { designReviewHash } = await import(`${binding.runtimePath}/novel-service-core/src/design-review.ts`);
const input = read(path.join(directory, 'input.json')), prior = read(path.join(directory, 'prior-run.json'));
const note = read(path.join(directory, 'note.json')), request = read(path.join(directory, 'request.json'));
const workId = 'work_8b6c9133e13d404083ca33acc63f4f61';
const fields = work => Object.fromEntries(Object.keys(work).sort().map(key => [key, hash(work[key])]));
const backup = destination => {
  assert.ok(!fs.existsSync(destination));
  execFileSync('python3', ['-c', "import sqlite3,sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()", path.resolve('data/novel-studio.db'), destination]);
};
if (mode === '--snapshot') {
  assert.ok(!fs.existsSync(path.join(directory, 'baseline.json')));
  const db = path.join(directory, 'baseline.db'); backup(db);
  const client = new PrismaClient({ datasources: { db: { url: `file:${db}` } } }), repository = new PrismaWorkRepository(client);
  try {
    const work = await repository.get(workId); assert.ok(work);
    assert.deepEqual(work.designReviewRuns.get(prior.id), prior);
    assert.deepEqual(work.designReviewAnnotations.get(note.id), note);
    assert.equal(work.designReviewAnnotations.size, 41); assert.equal(work.designReviewRuns.size, 103); assert.equal(work.designContentReviews.size, 92);
    assert.equal(designReviewHash(work, prior.input.scope.planRevisionId), prior.input.inputHash);
    const baseline = { fields: fields(work), runs: [...work.designReviewRuns].map(([id, run]) => [id, hash(run)]), sourceCommit: binding.sourceCommit,
      runtimeBindingSha256: sha(bindingPath), runnerSha256: sha(process.argv[1]), inputSha256: hash(input), priorSha256: hash(prior), noteSha256: hash(note), requestSha256: hash(request), snapshot: db,
      settingsSha256: sha('data/model-settings.json'), createdAt: new Date().toISOString() };
    fs.copyFileSync(process.argv[1], path.join(directory, 'runner.mjs'), fs.constants.COPYFILE_EXCL);
    save('baseline.json', baseline);
    console.log(JSON.stringify({ snapshotReady: true, originalRuns: 103, originalReports: 92, annotations: 41, modelCalls: 0, productionWrites: 0 }));
  } finally { await repository.disconnect(); await client.$disconnect(); }
  process.exit(0);
}
const baseline = read(path.join(directory, 'baseline.json'));
assert.equal(sha(bindingPath), baseline.runtimeBindingSha256); assert.equal(sha(process.argv[1]), baseline.runnerSha256);
assert.equal(hash(input), baseline.inputSha256); assert.equal(hash(prior), baseline.priorSha256); assert.equal(hash(note), baseline.noteSha256); assert.equal(hash(request), baseline.requestSha256);
const label = mode.slice(2), resultName = `${label}.json`, resultPath = path.join(directory, resultName);
assert.ok(!fs.existsSync(resultPath), 'Inspect existing outcome; do not repeat dispatched calls');
const live = mode === '--apply-live', verify = mode === '--verify-private';
if (verify || live) assert.equal(read(path.join(directory, 'execute-private.json')).status, 'completed');
if (live) assert.equal(read(path.join(directory, 'verify-private.json')).verified, true);
const database = live ? path.resolve('data/novel-studio.db') : path.join(directory, `${label}.db`);
if (!live) fs.copyFileSync(baseline.snapshot, database, fs.constants.COPYFILE_EXCL);
else {
  // No independent API/writer may operate while the replay is being published.
  const ports = spawnSync('lsof', ['-nP', '-iTCP:8787', '-sTCP:LISTEN'], { encoding: 'utf8' });
  assert.equal(ports.status, 1, 'Stop the standalone API before applying');
  assert.equal(ports.stdout.trim(), '');
}
const client = new PrismaClient({ datasources: { db: { url: `file:${database}` } } }), repository = new PrismaWorkRepository(client);
let calls = 0, result;
try {
  const before = await repository.get(workId); assert.deepEqual(fields(before), baseline.fields);
  const { loadModelStore, activeChannel, connectionOf } = await import(`${binding.runtimePath}/apps/api/src/model-settings.ts`);
  const { ModelGateway, OpenAICompatibleAdapter, UsageLedger, redactSecrets } = await import(`${binding.runtimePath}/packages/model-gateway/src/index.ts`);
  assert.equal(sha('data/model-settings.json'), baseline.settingsSha256);
  const store = loadModelStore('data/model-settings.json'), connection = connectionOf(activeChannel(store), store.source);
  assert.equal(connection.planningModel, 'gpt-5.6-luna'); assert.ok(store.channels.every(channel => !channel.fallback));
  const ledger = new UsageLedger(Infinity, undefined, { maxCalls: 3 });
  const gateway = new ModelGateway(new Map([['openai-compatible', new OpenAICompatibleAdapter(fetch, connection.timeoutMs, true)]]), ledger);
  const planner = new JsonDesignPlanner({ complete: async raw => {
    const number = ++calls, prefix = String(number).padStart(3, '0');
    const sent = { ...raw, role: raw.role ?? 'reviewing', model: connection.planningModel, responseFormat: 'json', temperature: 0.2 };
    if (verify || live) {
      assert.deepEqual(read(path.join(directory, `${prefix}.started.json`)).request, sent);
      return read(path.join(directory, `${prefix}.response.json`)).response.text;
    }
    save(`${prefix}.started.json`, { number, request: sent, at: new Date().toISOString() });
    try {
      const response = await gateway.complete(sent, 'openai-compatible', { endpoint: connection.endpoint.replace(/\/$/, '').replace(/(?:\/v1)?$/, '/v1'), apiKey: connection.apiKey });
      save(`${prefix}.response.json`, { number, response, usage: ledger.summary(), at: new Date().toISOString() }); return response.text;
    } catch (error) { save(`${prefix}.failure.json`, { number, error: redactSecrets(String(error)), at: new Date().toISOString() }); throw error; }
  } });
  const workflow = new ChapterWorkflow(repository, { generateChapter: () => { throw Error('Prose is outside this operation'); } }, {
    generateWorldPack: async () => { throw Error('No design generation'); }, generateStoryBible: async () => { throw Error('No design generation'); },
    reviewDesignContent: staged => { assert.deepEqual(staged, input); return planner.reviewDesignContent(staged); },
  });
  const queued = await workflow.reconsiderDesignReview(workId, prior.id, request.annotationId, request.expectedInputHash, request.additionalSourceIds);
  const stagedWork = await repository.get(workId), stagedRun = stagedWork.designReviewRuns.get(prior.id);
  const afterQueueFields = fields(stagedWork);
  for (const [key, digest] of Object.entries(baseline.fields)) if (!['designReviewRuns', 'constraintRevision'].includes(key)) assert.equal(afterQueueFields[key], digest, key);
  assert.deepEqual(designReviewStageInput(stagedRun, stagedRun.stages.find(stage => stage.id === queued.stageId)), input);
  assert.deepEqual(await workflow.reconsiderDesignReview(workId, prior.id, request.annotationId, request.expectedInputHash, request.additionalSourceIds), queued);
  const completed = await workflow.stepDesignReview(workId, prior.id);
  const stage = completed.stages.find(stage => stage.id === queued.stageId); assert.ok(stage.result);
  if (verify || live) {
    const privateResult = read(path.join(directory, 'execute-private.json'));
    assert.equal(calls, privateResult.calls); assert.deepEqual(stage.result, privateResult.stage.result); assert.deepEqual(stage.modelResponses, privateResult.stage.modelResponses);
  }
  const after = await repository.get(workId), afterFields = fields(after);
  for (const [key, digest] of Object.entries(baseline.fields)) if (!['designReviewRuns', 'constraintRevision'].includes(key)) assert.equal(afterFields[key], digest, key);
  for (const [id, digest] of baseline.runs) if (id !== prior.id) assert.equal(hash(after.designReviewRuns.get(id)), digest, id);
  for (const old of prior.stages.filter(stage => stage.result)) {
    assert.deepEqual(completed.stages.find(stage => stage.id === old.id), old);
    assert.deepEqual(designReviewStageInput(completed, old), designReviewStageInput(prior, old));
  }
  assert.deepEqual(completed.input, prior.input); assert.equal(completed.reportId, undefined); assert.equal(after.designContentReviews.size, 92);
  assert.equal(after.plans.get(after.activePlanId).revision, 10); assert.equal(after.plans.get(prior.input.scope.planRevisionId).status, 'proposed');
  result = { status: 'completed', verified: true, sourceCommit: binding.sourceCommit, calls, modelCalls: verify || live ? 0 : calls,
    model: connection.planningModel, fallback: false, stage, queued, workFieldDigestsAfter: afterFields,
    historicalRunsPreserved: 102, historicalReportsPreserved: 92, originalStagesPreserved: 16, annotationsPreserved: 41,
    formalAcceptance: false, designChanged: false, proseGenerated: false, productionWrites: live ? 'one_reconsideration_and_one_leased_step' : 0,
    database, finishedAt: new Date().toISOString() };
  save(`${label}-run.json`, completed);
} catch (error) {
  const { redactSecrets } = await import(`${binding.runtimePath}/packages/model-gateway/src/index.ts`);
  result = { status: 'failed', error: redactSecrets(String(error)), calls, finishedAt: new Date().toISOString(), database }; process.exitCode = 1;
} finally {
  await repository.disconnect(); await client.$disconnect();
  save(resultName, result);
  console.log(JSON.stringify({ status: result.status, verified: result.verified, calls, modelCalls: result.modelCalls, verdict: result.stage?.result?.checks.map(check => ({ criterion: check.criterion, verdict: check.verdict, resolves: check.resolves })), error: result.error }));
}
