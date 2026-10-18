// Reconstruct all 17 accepted steps / 22 journaled model responses offline.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { replayDesignReviewRecord } from './audit-design-reviews.mjs';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const hash = value => createHash('sha256').update(JSON.stringify(value, (_, v) => v instanceof Map ? [...v] : v)).digest('hex');
const directory = 'data/audit-runtimes/design77-formal-reconsideration';
const live = process.argv.includes('--live'); assert.ok(live || process.argv.includes('--private'));
const stage = live ? 'apply-live' : 'execute-private', result = read(`${directory}/${stage}.json`), updated = read(`${directory}/${stage}-run.json`);
assert.equal(result.status, 'completed'); assert.equal(result.verified, true);
const original = read('data/audit-runtimes/design77-notes-continuation/result.json');
const inputs = read('data/audit-runtimes/design77-notes-continuation/inputs.json');
const bindingPath = 'data/audit-runtimes/design77-formal-runtime-bound.json', binding = read(bindingPath);
for (const [file, digest] of Object.entries(binding.sourceHashes)) assert.equal(sha(`${binding.runtimePath}/${file}`), digest);
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const oldCalls = fs.readdirSync('data/audit-runtimes/design77-notes-continuation/model-calls').filter(name => name.endsWith('.started.json')).sort().map(name => read(`data/audit-runtimes/design77-notes-continuation/model-calls/${name}`));
const replays = [];
const runs = original.runs.map(run => run.id === updated.id ? updated : run);
for (const run of runs) {
  const requests = run.stages.filter(stage => stage.result).flatMap(stage => stage.reconsiderationFor
    ? [read(`${directory}/001.started.json`).request]
    : oldCalls.filter(call => call.step.runId === run.id && call.step.stageId === stage.id).map(call => call.request));
  let index = 0;
  class JournalPlanner extends JsonDesignPlanner {
    constructor(client) { super({ complete: async request => {
      const saved = requests[index++]; assert.ok(saved);
      assert.equal(request.user, saved.user); assert.ok(saved.system.startsWith(request.system));
      assert.equal(request.maxOutputTokens, saved.maxOutputTokens);
      return client.complete(request);
    } }); }
  }
  const replay = await replayDesignReviewRecord(run, inputs[run.input.area], undefined, { ...runtime, JsonDesignPlanner: JournalPlanner });
  assert.equal(replay.responsesReplayed, index); replays.push({ area: run.input.area, runId: run.id, ...replay });
}
assert.equal(replays.reduce((sum, item) => sum + item.completedStages, 0), 17);
assert.equal(replays.reduce((sum, item) => sum + item.responsesReplayed, 0), 22);
const context = runtime.designReviewResolutionContext(updated);
assert.ok(context?.text.includes('batch-3/costs')); assert.ok(context.text.includes('reconsideration'));
const proof = { verified: true, sourceCommit: binding.sourceCommit, runtimeBindingSha256: sha(bindingPath), resultSha256: sha(`${directory}/${stage}.json`),
  replays, resolutionContext: context, modelCalls: 0, productionWrites: 0, formalAcceptance: false,
  limitation: 'One raw costs finding formally resolved; all four assessments remain incomplete. No plan approval or prose generation.', observedAt: new Date().toISOString() };
if (live) {
  const database = path.resolve(directory, 'live-verification.db'); assert.ok(!fs.existsSync(database));
  execFileSync('python3', ['-c', "import sqlite3,sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()", path.resolve('data/novel-studio.db'), database]);
  const { PrismaClient } = createRequire(`${binding.runtimePath}/package.json`)('@prisma/client');
  const { PrismaWorkRepository } = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
  const client = new PrismaClient({ datasources: { db: { url: `file:${database}` } } }), repository = new PrismaWorkRepository(client);
  try {
    const work = await repository.get('work_8b6c9133e13d404083ca33acc63f4f61');
    assert.deepEqual(Object.fromEntries(Object.keys(work).sort().map(key => [key, hash(work[key])])), result.workFieldDigestsAfter);
    for (const run of runs) assert.deepEqual(work.designReviewRuns.get(run.id), run);
    assert.equal(work.plans.get(work.activePlanId).revision, 10); assert.equal(work.designReviewAnnotations.size, 41);
    assert.equal(work.designReviewRuns.size, 103); assert.equal(work.designContentReviews.size, 92);
    proof.databaseSnapshotPath = database; proof.liveReadback = true;
  } finally { await repository.disconnect(); await client.$disconnect(); }
}
const filename = `docs/audits/2026-10-18-design77-formal-reconsideration-${live ? 'live' : 'private'}-verified.json`;
fs.writeFileSync(filename, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx', flush: true });
console.log(JSON.stringify({ verified: true, stages: 17, responses: 22, liveReadback: proof.liveReadback ?? false, modelCalls: 0, formalAcceptance: false }));
