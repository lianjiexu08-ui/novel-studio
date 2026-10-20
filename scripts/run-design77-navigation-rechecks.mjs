// Three same-run source-navigation rechecks through the real workflow.
// Original inputs, judgments and historical artifacts remain immutable.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { startSharedReviewHost } from './shared-review-host.mjs';
const read = p => JSON.parse(fs.readFileSync(p));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash = value => createHash('sha256').update(JSON.stringify(value, (_, v) => v instanceof Map ? [...v] : v)).digest('hex');
const directory = path.resolve('data/audit-runtimes/design77-navigation-execution');
const bindingPath = 'data/audit-runtimes/design77-navigation-runtime-bound.json', binding = read(bindingPath);
for (const [file, digest] of Object.entries(binding.sourceHashes)) assert.equal(sha(`${binding.runtimePath}/${file}`), digest);
for (const [file, digest] of Object.entries(binding.dependencyHashes)) assert.equal(sha(file), digest);
const { PrismaClient } = createRequire(`${binding.runtimePath}/package.json`)('@prisma/client');
const { PrismaWorkRepository } = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const { ChapterWorkflow } = await import(`${binding.runtimePath}/packages/application/src/index.ts`);
const { designReviewStageInput } = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const oldPath = 'data/audit-runtimes/design77-formal-continuation/result.json', old = read(oldPath);
const preflightPath = 'docs/audits/2026-10-20-design77-source-navigation-preflight.json', preflight = read(preflightPath);
assert.equal(sha(oldPath), preflight.checkpointSha256); assert.equal(old.segment, 3); assert.equal(old.status, 'stopped_after_stage_limit');
try { process.kill(old.pid, 0); assert.fail('Old reviewer still running'); } catch (error) { assert.equal(error.code, 'ESRCH'); }
const workId = old.scope.workId, runId = preflight.proposals[0].note.runId;
const fields = work => Object.fromEntries(Object.keys(work).sort().map(key => [key, hash(work[key])]));
const save = (name, value) => fs.writeFileSync(`${directory}/${name}`, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', flush: true });
const mode = process.argv[2]; assert.ok(['--prepare', '--execute'].includes(mode));
if (mode === '--prepare') {
  assert.ok(!fs.existsSync(directory), 'Preserve earlier preparation'); fs.mkdirSync(directory, { recursive: true });
  const snapshot = `${directory}/baseline.db`;
  execFileSync('python3', ['-c', "import sqlite3,sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()", path.resolve('data/novel-studio.db'), snapshot]);
  const client = new PrismaClient({ datasources: { db: { url: `file:${snapshot}` } } }), repo = new PrismaWorkRepository(client);
  try {
    const work = await repo.get(workId); assert.ok(work);
    for (const run of old.runs) assert.deepEqual(work.designReviewRuns.get(run.id), run);
    assert.equal(work.designReviewAnnotations.size, 41); assert.equal(work.designReviewRuns.size, 103); assert.equal(work.designContentReviews.size, 92);
    assert.ok([...work.designReviewRuns.values()].every(run => !run.leaseToken));
    save('baseline.json', { fields: fields(work), runs: [...work.designReviewRuns].map(([id, run]) => [id, hash(run)]),
      annotations: [...work.designReviewAnnotations].map(([id, note]) => [id, hash(note)]), snapshot,
      oldCheckpointSha256: sha(oldPath), preflightSha256: sha(preflightPath), bindingSha256: sha(bindingPath),
      runnerSha256: sha(process.argv[1]), hostHelperSha256: sha('scripts/shared-review-host.mjs'), settingsSha256: sha('data/model-settings.json') });
    fs.copyFileSync(process.argv[1], `${directory}/runner.mjs`, fs.constants.COPYFILE_EXCL);
    console.log(JSON.stringify({ prepared: true, originalCompletedStages: old.runs.reduce((n, run) => n + run.stages.filter(s => s.result).length, 0), originalCalls: old.totalCalls, modelCalls: 0, productionWrites: 0 }));
  } finally { await repo.disconnect(); await client.$disconnect(); }
  process.exit(0);
}
const baseline = read(`${directory}/baseline.json`);
assert.equal(sha(process.argv[1]), baseline.runnerSha256); assert.equal(sha(bindingPath), baseline.bindingSha256);
assert.equal(sha(preflightPath), baseline.preflightSha256); assert.equal(sha(oldPath), baseline.oldCheckpointSha256);
assert.equal(sha('scripts/shared-review-host.mjs'), baseline.hostHelperSha256); assert.equal(sha('data/model-settings.json'), baseline.settingsSha256);
assert.equal(process.env.DATABASE_URL, 'file:' + path.resolve('data/novel-studio.db'));
assert.equal(process.env.API_CORS_ORIGIN, 'http://127.0.0.1:5180'); assert.equal(process.env.NOVEL_ENABLE_BATCH_RUNS, 'false');
assert.ok(!fs.existsSync(`${directory}/result.json`), 'Inspect existing worker/result; never resubmit automatically');
const { loadModelStore, activeChannel, connectionOf } = await import(`${binding.runtimePath}/apps/api/src/model-settings.ts`);
const { ModelGateway, OpenAICompatibleAdapter, UsageLedger, redactSecrets } = await import(`${binding.runtimePath}/packages/model-gateway/src/index.ts`);
const store = loadModelStore('data/model-settings.json'), connection = connectionOf(activeChannel(store), store.source);
assert.equal(connection.planningModel, 'gpt-5.6-luna'); assert.ok(store.channels.every(channel => !channel.fallback));
const ledger = new UsageLedger(Infinity, undefined, { maxCalls: 6 });
const gateway = new ModelGateway(new Map([['openai-compatible', new OpenAICompatibleAdapter(fetch, connection.timeoutMs, true)]]), ledger);
const repo = new PrismaWorkRepository(); let host, calls = 0, stop = false;
const state = { status: 'running', pid: process.pid, startedAt: new Date().toISOString(), workId, runId,
  sourceCommit: binding.sourceCommit, originalCheckpointSha256: baseline.oldCheckpointSha256, model: connection.planningModel,
  fallback: false, calls: 0, completed: [], notes: [], errors: [], runs: old.runs, reports: old.reports, formalAcceptance: false, proseGenerated: false };
save('result.json', state);
const stopBetweenChecks = () => { stop = true; }; process.once('SIGTERM', stopBetweenChecks); process.once('SIGINT', stopBetweenChecks);
const checkPreserved = work => {
  const after = fields(work);
  for (const [key, digest] of Object.entries(baseline.fields)) if (!['designReviewRuns', 'designReviewAnnotations', 'constraintRevision'].includes(key)) assert.equal(after[key], digest, key);
  for (const [id, digest] of baseline.runs) if (id !== runId) assert.equal(hash(work.designReviewRuns.get(id)), digest);
  for (const [id, digest] of baseline.annotations) assert.equal(hash(work.designReviewAnnotations.get(id)), digest);
  const updated = work.designReviewRuns.get(runId), prior = old.runs.find(run => run.id === runId);
  assert.deepEqual(updated.input, prior.input);
  for (const stage of prior.stages.filter(stage => stage.result)) assert.deepEqual(updated.stages.find(item => item.id === stage.id), stage);
  assert.equal(work.designReviewRuns.size, 103); assert.equal(work.designContentReviews.size, 92);
  assert.equal(work.designReviewAnnotations.size, 41 + state.notes.length);
};
async function checkpoint() {
  const work = await repo.get(workId); checkPreserved(work);
  state.runs = old.runs.map(run => work.designReviewRuns.get(run.id)); state.calls = calls; state.usage = ledger.summary();
  state.updatedAt = new Date().toISOString(); state.workFieldDigests = fields(work);
  fs.writeFileSync(`${directory}/result.pending.json`, JSON.stringify(state, null, 2) + '\n'); fs.renameSync(`${directory}/result.pending.json`, `${directory}/result.json`);
}
try {
  const before = await repo.get(workId); assert.deepEqual(fields(before), baseline.fields);
  const { createApiServer } = await import(`${binding.runtimePath}/apps/api/src/server.ts`);
  host = await startSharedReviewHost({ createApiServer, repository: repo, modelSettingsPath: path.resolve('data/model-settings.json'), port: 8787,
    status: () => ({ status: state.status, workId, active: state.active, calls }), onResponse: event => fs.appendFileSync(`${directory}/http.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n') });
  console.log(JSON.stringify({ apiReady: true, pid: process.pid, port: 8787, readOnly: true }));
  const planner = new JsonDesignPlanner({ complete: async raw => {
    const number = ++calls, prefix = String(number).padStart(3, '0');
    const sent = { ...raw, role: raw.role ?? 'reviewing', model: connection.planningModel, responseFormat: 'json', temperature: 0.2 };
    save(`${prefix}.started.json`, { number, step: state.active, request: sent, at: new Date().toISOString() });
    try {
      const response = await gateway.complete(sent, 'openai-compatible', { endpoint: connection.endpoint.replace(/\/$/, '').replace(/(?:\/v1)?$/, '/v1'), apiKey: connection.apiKey });
      save(`${prefix}.response.json`, { number, response, usage: ledger.summary(), at: new Date().toISOString() }); return response.text;
    } catch (error) { save(`${prefix}.failure.json`, { number, error: redactSecrets(String(error)), at: new Date().toISOString() }); throw error; }
  } });
  const workflow = new ChapterWorkflow(repo, { generateChapter() { throw Error('No prose generation'); } }, planner);
  for (const proposal of preflight.proposals) {
    if (stop) break;
    const { id, createdAt, scope, ...payload } = proposal.note;
    const note = await workflow.addDesignReviewAnnotation(workId, payload); state.notes.push(note);
    const queued = await workflow.reconsiderDesignReview(workId, runId, note.id, note.expectedInputHash);
    const run = (await repo.get(workId)).designReviewRuns.get(runId), stage = run.stages.find(stage => stage.id === queued.stageId);
    const input = designReviewStageInput(run, stage); assert.equal(input.stage.reconsiderationKind, 'source_navigation');
    save(`${note.criterion}.input.json`, input);
    state.active = { criterion: note.criterion, stageId: stage.id, noteId: note.id, startedAt: new Date().toISOString() };
    await checkpoint(); console.log(JSON.stringify({ starting: state.active, sourceCharacters: JSON.stringify(input.sources).length }));
    const completed = await workflow.stepDesignReview(workId, runId), result = completed.stages.find(s => s.id === stage.id).result; assert.ok(result);
    state.completed.push({ ...state.active, result }); await checkpoint();
    console.log(JSON.stringify({ completed: note.criterion, calls, checks: result.checks.map(c => ({ criterion: c.criterion, verdict: c.verdict, resolves: c.resolves })) }));
  }
  state.status = state.completed.length === 3 ? 'completed' : 'stopped_by_signal';
} catch (error) { state.status = 'failed'; state.errors.push(redactSecrets(String(error))); process.exitCode = 1; }
finally {
  state.finishedAt = new Date().toISOString(); await checkpoint();
  await host?.close(); await repo.disconnect(); process.removeListener('SIGTERM', stopBetweenChecks); process.removeListener('SIGINT', stopBetweenChecks);
  console.log(JSON.stringify({ status: state.status, calls, completed: state.completed.length, errors: state.errors, formalAcceptance: false }));
}
