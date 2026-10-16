// Snapshot a running reassessment without interrupting it or changing its records.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const control = 'data/audit-runtimes/design70-review';
const checkpoint = fs.readFileSync(`${control}/result.json`), state = JSON.parse(checkpoint);
const baseline = read(`${control}/baseline.json`), binding = read('data/audit-runtimes/design70-runtime-bound.json');
assert.equal(state.status, 'running'); process.kill(state.pid, 0);
assert.equal(state.runs.length, 1);
const run = state.runs[0];
assert.equal(run.scheduleVersion, 31);
assert.equal(run.input.area, 'power');
assert.ok(run.stages.some(stage => stage.result));
for (const [name, expected] of Object.entries(binding.sourceHashes)) assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${name}`)), expected);
const { designReviewStageInput } = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
let responsesReplayed = 0;
for (const stage of run.stages.filter(stage => stage.result)) {
  let index = 0;
  const planner = new JsonDesignPlanner({ complete: async () => {
    assert.ok(index < stage.modelResponses.length);
    return stage.modelResponses[index++];
  } });
  const { modelResponses, ...result } = await planner.reviewDesignContent(designReviewStageInput(run, stage));
  assert.deepEqual(result, stage.result); assert.deepEqual(modelResponses, stage.modelResponses);
  responsesReplayed += index;
}
const { PrismaWorkRepository } = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const snapshotDirectory = fs.mkdtempSync(path.resolve(control) + '/started-verification-');
const databaseSnapshotPath = path.join(snapshotDirectory, 'production.db');
execFileSync('python3', ['-c', 'import sqlite3,sys,pathlib\ns=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True)\nt=sqlite3.connect(sys.argv[2])\ns.backup(t)\nt.close()\ns.close()', path.resolve('data/novel-studio.db'), databaseSnapshotPath], { timeout: 60_000 });
const databaseSnapshotSha256 = sha(fs.readFileSync(databaseSnapshotPath));
const prisma = new PrismaClient({ datasources: { db: { url: `file:${databaseSnapshotPath}` } } });
let production;
try {
  production = await prisma.$transaction(async tx => {
    const work = await new PrismaWorkRepository(tx).get(baseline.workId);
    assert.ok(work);
    const protectedHash = hash({ world: work.worldPack, bible: work.storyBible, plans: [...work.plans], activePlanId: work.activePlanId,
      versions: [...work.versions], events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] });
    assert.equal(protectedHash, baseline.protectedHash);
    for (const [id, expected] of baseline.oldRuns) assert.equal(hash(work.designReviewRuns.get(id)), expected);
    for (const [id, expected] of baseline.oldReports) assert.equal(hash(work.designContentReviews.get(id)), expected);
    const actual = work.designReviewRuns.get(run.id);
    assert.ok(actual); assert.equal(actual.restartedFromRunId, run.restartedFromRunId);
    assert.deepEqual(actual.input, run.input);
    for (const stage of run.stages.filter(stage => stage.result)) assert.deepEqual(actual.stages.find(item => item.id === stage.id), stage);
    assert.equal(work.designReviewRuns.size, baseline.oldRuns.length + 1);
    return { protectedHash, oldRunsUnchanged: baseline.oldRuns.length, oldReportsUnchanged: baseline.oldReports.length,
      currentRunId: actual.id, currentStatus: actual.status, currentCompleted: actual.stages.filter(stage => stage.result).length,
      approvedPlanRevision: work.plans.get(work.activePlanId).revision };
  }, { maxWait: 30_000, timeout: 120_000 });
} finally { await prisma.$disconnect(); }
const old = read('docs/audits/2026-10-17-design69-review30-result.json');
assert.equal(sha(fs.readFileSync(old.checkpointPath)), old.checkpointSha256);
const snapshotPath = `${control}/started-checkpoint.json`;
fs.writeFileSync(snapshotPath, checkpoint, { flag: 'wx' });
const proof = { observedAt: new Date().toISOString(), workerPid: state.pid, workerObservedAlive: true,
  snapshotPath, snapshotSha256: sha(checkpoint), databaseSnapshotPath, databaseSnapshotSha256, runId: run.id, restartedFromRunId: run.restartedFromRunId,
  inputHash: run.input.inputHash, sourceCommit: binding.sourceCommit, scheduleVersion: run.scheduleVersion,
  completedStages: run.stages.filter(stage => stage.result).length, totalStages: run.stages.length,
  callsAtCheckpoint: state.totalCalls, responsesReplayed, production,
  checks: run.stages.filter(stage => stage.result).map(stage => ({ stageId: stage.id, checks: stage.result.checks.map(({ criterion, verdict, explanation, awaitingSources }) => ({ criterion, verdict, explanation, awaitingSources })) })),
  verificationModelCalls: 0, productionWrites: 0, formalAcceptance: false, proseGenerated: false,
  limitation: 'A snapshot of an ongoing task, not a final report. Later progress may exceed this checkpoint. Pending source reads are not approvals or proven design defects.' };
fs.writeFileSync('docs/audits/2026-10-17-design70-review-started.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ completedStages: proof.completedStages, callsAtCheckpoint: proof.callsAtCheckpoint, responsesReplayed, production }));
