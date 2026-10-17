// Read-only replay of a terminal checkpoint; never repairs or rewrites judgments.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { replayDesignReviewRecord } from './audit-design-reviews.mjs';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const fileHash = file => sha(fs.readFileSync(file));
const control = 'data/audit-runtimes/design70-review';
const liveCheckpointPath = `${control}/result.json`, checkpointBytes = fs.readFileSync(liveCheckpointPath);
const state = JSON.parse(checkpointBytes), baseline = read(`${control}/baseline.json`);
const binding = read('data/audit-runtimes/design70-runtime-bound.json');
assert.ok(['completed', 'stopped_after_failure', 'stopped_after_budget', 'stopped_by_signal'].includes(state.status));
let alive = false; try { process.kill(state.pid, 0); alive = true; } catch (error) { assert.equal(error.code, 'ESRCH'); }
assert.equal(alive, false, 'Wait for the worker to exit; do not restart it');
assert.equal(fileHash('scripts/run-design70-review.mjs'), baseline.runnerSha256);
assert.equal(fileHash('data/audit-runtimes/design70-runtime-bound.json'), baseline.runtimeBindingSha256);
for (const [name, expected] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(`${binding.runtimePath}/${name}`), expected);
assert.equal(fileHash(`${control}/inputs.json`), baseline.inputsSha256);
const expectedInputs = read(`${control}/inputs.json`);
assert.deepEqual(Object.keys(expectedInputs).sort(), baseline.areas.map(area => area.area).sort());
assert.equal(state.inputHash, baseline.inputHash);
assert.equal(new Set(state.runs.map(run => run.id)).size, state.runs.length);
assert.equal(new Set(state.runs.map(run => run.input.area)).size, state.runs.length);
assert.equal(new Set(state.reports.map(report => report.id)).size, state.reports.length);
assert.equal(state.reports.length, state.runs.filter(run => run.status === 'completed').length);
assert.deepEqual(state.areas, state.runs.map(run => ({ area: run.input.area, runId: run.id })));
if (state.status === 'completed') assert.ok(state.runs.every(run => run.status === 'completed'));
for (const area of baseline.areas) assert.equal(hash(expectedInputs[area.area]), area.sourceEnvelopeSha256);
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const replays = [];
for (const run of state.runs) {
  assert.equal(run.scheduleVersion, 31);
  assert.equal(run.input.inputHash, baseline.inputHash);
  const expectedInput = expectedInputs[run.input.area];
  assert.ok(expectedInput, 'Unexpected review area');
  const replay = await replayDesignReviewRecord(run, expectedInput,
    state.reports.find(report => report.id === run.reportId), { ...runtime, JsonDesignPlanner });
  replays.push({ area: run.input.area, runId: run.id, completedStages: run.stages.filter(stage => stage.result).length,
    totalStages: run.stages.length, responsesReplayed: replay.responsesReplayed,
    independentInputVerified: true, canonicalScheduleVerified: true, reportVerification: replay.reportVerification,
    retainedNonPassChecks: run.stages.filter(stage => stage.result).flatMap(stage => stage.result.checks
      .filter(check => check.verdict !== 'pass').map(check => ({ stageId: stage.id, ...check }))),
    note: 'Retained non-pass records include earlier deferrals that later stages may resolve; not a count of current independent defects.' });
}
const { PrismaWorkRepository } = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
// Audit a consistent read-only backup. Prisma's transaction must not lock the
// production database, even after the model worker has exited.
const snapshotDirectory = fs.mkdtempSync(path.resolve(control, 'terminal-verification-'));
const databaseSnapshotPath = path.join(snapshotDirectory, 'production.db');
execFileSync('python3', ['-c', `
import sqlite3, sys
from pathlib import Path
source = sqlite3.connect(Path(sys.argv[1]).as_uri() + '?mode=ro', uri=True, timeout=30)
target = sqlite3.connect(sys.argv[2])
try:
    source.backup(target, pages=1000, sleep=0.05)
finally:
    target.close()
    source.close()
`, path.resolve('data/novel-studio.db'), databaseSnapshotPath], { timeout: 120_000 });
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
    for (const run of state.runs) assert.deepEqual(work.designReviewRuns.get(run.id), run);
    for (const report of state.reports) assert.deepEqual(work.designContentReviews.get(report.id), report);
    assert.equal(work.designReviewRuns.size, baseline.oldRuns.length + state.runs.length);
    assert.equal(work.designContentReviews.size, baseline.oldReports.length + state.reports.length);
    return { protectedHash, oldRunsUnchanged: baseline.oldRuns.length, oldReportsUnchanged: baseline.oldReports.length,
      runs: work.designReviewRuns.size, reports: work.designContentReviews.size, plans: work.plans.size,
      versions: work.versions.size, events: work.events.size, approvedPlanRevision: work.plans.get(work.activePlanId).revision };
  }, { maxWait: 30_000, timeout: 120_000 });
} finally { await prisma.$disconnect(); }
const previous = read('docs/audits/2026-10-17-design69-review30-result.json');
assert.equal(fileHash(previous.checkpointPath), previous.checkpointSha256);
if (state.status === 'completed') assert.deepEqual(state.runs.map(run => run.input.area).sort(), baseline.areas.map(area => area.area).sort());
assert.equal(fileHash(liveCheckpointPath), sha(checkpointBytes), 'Checkpoint changed during verification');
const checkpointPath = `${control}/terminal-segment-${state.segment}.json`;
if (fs.existsSync(checkpointPath)) assert.equal(fileHash(checkpointPath), sha(checkpointBytes));
else fs.writeFileSync(checkpointPath, checkpointBytes, { flag: 'wx' });
const proof = { observedAt: new Date().toISOString(), status: state.status, workerPid: state.pid, workerAbsent: true,
  checkpointPath, checkpointSha256: fileHash(checkpointPath), runtimePath: binding.runtimePath,
  sourceCommit: binding.sourceCommit, inputsSha256: baseline.inputsSha256,
  databaseSnapshotPath, databaseSnapshotSha256: fileHash(databaseSnapshotPath),
  productionVerification: 'read_only_sqlite_backup',
  totalCalls: state.totalCalls, errors: state.errors, replays, preserved,
  reports: state.reports.map(({ id, area, status, summary }) => ({ id, area, status, summary })),
  verificationModelCalls: 0, productionWrites: 0, formalAcceptance: false, proseGenerated: false };
const proofPath = state.status === 'completed' ? 'docs/audits/2026-10-17-design70-review-result.json'
  : `docs/audits/2026-10-17-design70-review-stopped-segment-${state.segment}.json`;
assert.ok(!fs.existsSync(proofPath), 'Keep earlier verification evidence');
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: proof.status, totalCalls: proof.totalCalls,
  replays: replays.map(({ area, completedStages, totalStages, responsesReplayed }) => ({ area, completedStages, totalStages, responsesReplayed })),
  reports: proof.reports, preserved }));
