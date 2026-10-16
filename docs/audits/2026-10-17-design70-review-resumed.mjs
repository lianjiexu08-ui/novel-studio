// Verify recovery against the stopped segment using saved responses only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { replayDesignReviewPrefix } from '../../scripts/audit-design-reviews.mjs';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const control = 'data/audit-runtimes/design70-review';
const stoppedProof = read('docs/audits/2026-10-17-design70-review-stopped-segment-0.json');
const stoppedBytes = fs.readFileSync(stoppedProof.checkpointPath), stopped = JSON.parse(stoppedBytes);
assert.equal(sha(stoppedBytes), stoppedProof.checkpointSha256);
assert.equal(sha(fs.readFileSync(`${control}/segment-0.json`)), stoppedProof.checkpointSha256);
const bytes = fs.readFileSync(`${control}/result.json`), state = JSON.parse(bytes);
const baseline = read(`${control}/baseline.json`), binding = read('data/audit-runtimes/design70-runtime-bound.json');
assert.equal(state.status, 'running'); process.kill(state.pid, 0);
assert.equal(state.segment, 1);
assert.equal(state.priorCheckpointSha256, stoppedProof.checkpointSha256);
assert.equal(state.previousCalls, stopped.totalCalls);
assert.equal(state.totalCalls, state.previousCalls + state.usage.calls);
assert.equal(state.runnerSha256, baseline.runnerSha256);
assert.equal(sha(fs.readFileSync('scripts/run-design70-review.mjs')), baseline.runnerSha256);
assert.equal(sha(fs.readFileSync('data/audit-runtimes/design70-runtime-bound.json')), baseline.runtimeBindingSha256);
for (const [name, expected] of Object.entries(binding.sourceHashes)) assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${name}`)), expected);
const old = stopped.runs[0], run = state.runs.find(run => run.id === old.id);
assert.ok(run);
assert.deepEqual(run.input, old.input);
const preservedStages = old.stages.filter(stage => stage.result);
for (const stage of preservedStages) assert.deepEqual(run.stages.find(item => item.id === stage.id), stage);
const failedId = stopped.errors[0].step.stageId;
assert.equal(state.stepsStarted[0].stageId, failedId);
const oldFailed = old.stages.find(stage => stage.id === failedId), retried = run.stages.find(stage => stage.id === failedId);
assert.ok(retried.result, 'Wait for the first retry to succeed');
assert.deepEqual(retried.failures, oldFailed.failures);
assert.ok(retried.modelResponses.length);
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const replay = await replayDesignReviewPrefix(run, read(`${control}/inputs.json`).power, { ...runtime, JsonDesignPlanner });
const { PrismaWorkRepository } = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const directory = fs.mkdtempSync(path.resolve(control) + '/resumed-verification-');
const databaseSnapshotPath = path.join(directory, 'production.db');
execFileSync('python3', ['-c', 'import sqlite3,sys,pathlib\ns=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True)\nt=sqlite3.connect(sys.argv[2])\ns.backup(t)\nt.close()\ns.close()', path.resolve('data/novel-studio.db'), databaseSnapshotPath], { timeout: 60_000 });
const prisma = new PrismaClient({ datasources: { db: { url: `file:${databaseSnapshotPath}` } } });
let preserved;
try {
  preserved = await prisma.$transaction(async tx => {
    const work = await new PrismaWorkRepository(tx).get(baseline.workId);
    assert.ok(work);
    const protectedHash = hash({ world: work.worldPack, bible: work.storyBible, plans: [...work.plans], activePlanId: work.activePlanId,
      versions: [...work.versions], events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] });
    assert.equal(protectedHash, baseline.protectedHash);
    for (const [id, expected] of baseline.oldRuns) assert.equal(hash(work.designReviewRuns.get(id)), expected);
    for (const [id, expected] of baseline.oldReports) assert.equal(hash(work.designContentReviews.get(id)), expected);
    for (const saved of state.runs) {
      const actual = work.designReviewRuns.get(saved.id);
      assert.ok(actual); assert.deepEqual(actual.input, saved.input);
      for (const stage of saved.stages.filter(stage => stage.result)) assert.deepEqual(actual.stages.find(item => item.id === stage.id), stage);
    }
    return { protectedHash, oldRunsUnchanged: baseline.oldRuns.length, oldReportsUnchanged: baseline.oldReports.length,
      approvedPlanRevision: work.plans.get(work.activePlanId).revision };
  }, { maxWait: 30_000, timeout: 120_000 });
} finally { await prisma.$disconnect(); }
const snapshotPath = `${control}/resumed-checkpoint.json`;
fs.writeFileSync(snapshotPath, bytes, { flag: 'wx' });
const proof = { observedAt: new Date().toISOString(), workerPid: state.pid, workerObservedAliveAtStart: true,
  segment: state.segment, runId: run.id, inputHash: run.input.inputHash, snapshotPath, snapshotSha256: sha(bytes),
  stoppedCheckpointSha256: stoppedProof.checkpointSha256, preservedCompletedStages: preservedStages.length,
  retriedStageId: failedId, retainedFailures: retried.failures.length, retryResponses: retried.modelResponses.length,
  callsAtCheckpoint: state.totalCalls, previousCalls: state.previousCalls, prefixReplay: replay, preserved,
  databaseSnapshotPath, databaseSnapshotSha256: sha(fs.readFileSync(databaseSnapshotPath)),
  modelCalls: 0, productionWrites: 0, formalAcceptance: false,
  limitation: 'Recovery and evidence integrity only; the ongoing review has not established four-area design acceptance.' };
fs.writeFileSync('docs/audits/2026-10-17-design70-review-resumed.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ runId: run.id, preservedCompletedStages: proof.preservedCompletedStages,
  retriedStageId: failedId, retainedFailures: proof.retainedFailures, prefixResponsesReplayed: replay.responsesReplayed,
  completedStages: replay.completedStages, callsAtCheckpoint: state.totalCalls, preserved }));
