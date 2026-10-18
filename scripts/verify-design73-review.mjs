// Read-only terminal verification for the resumable design73 review.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaWorkRepository } from '../packages/persistence/src/prisma-repository.ts';
import { replayDesignReviewRecord } from './audit-design-reviews.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileHash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const root = 'data/audit-runtimes/design73-review';
const checkpointPath = `${root}/result.json`;
const checkpointBytes = fs.readFileSync(checkpointPath);
const state = JSON.parse(checkpointBytes);
const baseline = read(`${root}/baseline.json`);
const binding = read('data/audit-runtimes/design72-runtime-bound.json');
assert.equal(state.status, 'completed');
try { process.kill(state.pid, 0); assert.fail('The review worker is still live'); } catch (error) { assert.equal(error.code, 'ESRCH'); }
assert.equal(fileHash('scripts/run-design73-review.mjs'), baseline.runnerSha256);
assert.equal(fileHash('data/audit-runtimes/design72-runtime-bound.json'), baseline.runtimeBindingSha256);
for (const [name, expected] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(`${binding.runtimePath}/${name}`), expected);
assert.equal(fileHash(`${root}/inputs.json`), baseline.inputsSha256);
const inputs = read(`${root}/inputs.json`);
assert.deepEqual(state.areas.map(area => area.area).sort(), ['characters', 'power', 'story', 'world']);
assert.equal(new Set(state.runs.map(run => run.id)).size, state.runs.length);
assert.equal(new Set(state.reports.map(report => report.id)).size, state.reports.length);
assert.equal(state.runs.length, 4);
assert.ok(state.runs.every(run => run.status === 'completed'));
assert.ok(state.runs.every(run => run.stages.every(stage => stage.result)));
assert.equal(state.reports.length, 4);
for (const run of state.runs) {
  assert.equal(run.scheduleVersion, 34);
  assert.equal(run.input.inputHash, baseline.inputHash);
  assert.deepEqual(run.input, inputs[run.input.area]);
}
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const replays = [];
for (const run of state.runs) {
  const replay = await replayDesignReviewRecord(run, inputs[run.input.area],
    state.reports.find(report => report.id === run.reportId), { ...runtime, JsonDesignPlanner });
  replays.push({ area: run.input.area, completedStages: run.stages.length,
    responsesReplayed: replay.responsesReplayed, reportVerification: replay.reportVerification,
    retainedNonPassChecks: run.stages.flatMap(stage => stage.result.checks
      .filter(check => check.verdict !== 'pass').map(check => ({ stageId: stage.id, ...check }))) });
}
// All production reads use SQLite's online backup API. The repository then
// reads a private snapshot, so verification cannot lock the live application.
const snapshotDirectory = fs.mkdtempSync(path.resolve(root, 'terminal-verification-'));
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
const workRepository = new PrismaWorkRepository(new PrismaClient({ datasources: { db: { url: `file:${databaseSnapshotPath}` } } }));
let work;
try { work = await workRepository.get(baseline.workId); } finally { await workRepository.disconnect(); }
assert.ok(work);
const protectedHash = hash({ world: work.worldPack, bible: work.storyBible, plans: [...work.plans], activePlanId: work.activePlanId,
  designHistory: [...work.designHistory], versions: [...work.versions], events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] });
assert.equal(protectedHash, baseline.protectedHash);
for (const [id, expected] of baseline.oldRuns) assert.equal(hash(work.designReviewRuns.get(id)), expected);
for (const [id, expected] of baseline.oldReports) assert.equal(hash(work.designContentReviews.get(id)), expected);
for (const run of state.runs) assert.deepEqual(work.designReviewRuns.get(run.id), run);
for (const report of state.reports) assert.deepEqual(work.designContentReviews.get(report.id), report);
assert.equal(work.designReviewRuns.size, baseline.oldRuns.length + state.runs.length);
assert.equal(work.designContentReviews.size, baseline.oldReports.length + state.reports.length);
assert.equal(work.worldPack.revision, 38);
assert.equal(work.storyBible.revision, 70);
assert.equal(work.plans.get(baseline.planId).revision, 73);
assert.equal(work.plans.get(baseline.planId).status, 'proposed');
assert.equal(work.plans.get(work.activePlanId).revision, 10);
const previous = read('docs/audits/2026-10-18-design72-review-result.json');
assert.equal(fileHash(previous.checkpointPath), previous.checkpointSha256);
const checkpointSha256 = createHash('sha256').update(checkpointBytes).digest('hex');
assert.equal(fileHash(checkpointPath), checkpointSha256, 'Checkpoint changed during verification');
const terminalPath = `${root}/terminal-segment-${state.segment}.json`;
if (fs.existsSync(terminalPath)) assert.equal(fileHash(terminalPath), checkpointSha256);
else fs.writeFileSync(terminalPath, checkpointBytes, { flag: 'wx' });
// Two stages committed before their usage checkpoint crashed. Keep the runner
// counter unchanged and disclose the extra retained successful responses.
const recoveredCalls = state.runs.find(run => run.input.area === 'characters').stages
  .filter(stage => ['cross-3-4', 'cross-3-5'].includes(stage.id))
  .map(stage => ({ stageId: stage.id, retainedResponses: stage.modelResponses.length }));
const segmentErrors = [];
for (let segment = 0; segment <= state.segment; segment++) {
  const saved = segment === state.segment ? state : read(`${root}/segment-${segment}.json`);
  segmentErrors.push(...saved.errors.map(error => ({ segment, ...error })));
}
const proof = {
  observedAt: new Date().toISOString(), status: state.status, workerPid: state.pid, workerAbsent: true,
  checkpointPath: terminalPath, checkpointSha256, runtimePath: binding.runtimePath, sourceCommit: binding.sourceCommit,
  inputsSha256: baseline.inputsSha256, checkpointTotalCalls: state.totalCalls,
  recoveredCalls, minimumModelCalls: state.totalCalls + recoveredCalls.reduce((sum, stage) => sum + stage.retainedResponses, 0),
  usageLimitation: 'The two crash windows lack durable usage ledger snapshots. Retained responses prove additional calls, but exact token usage and any unrecorded failed requests cannot be reconstructed.',
  errors: segmentErrors, databaseSnapshotPath, databaseSnapshotSha256: fileHash(databaseSnapshotPath),
  productionVerification: 'read_only_sqlite_backup',
  replays, preserved: { protectedHash, oldRunsUnchanged: baseline.oldRuns.length, oldReportsUnchanged: baseline.oldReports.length,
    reviewRuns: work.designReviewRuns.size, reports: work.designContentReviews.size },
  reports: state.reports.map(({ id, area, status, summary }) => ({ id, area, status, summary })),
  verificationModelCalls: 0, productionWrites: 0, formalAcceptance: false, proseGenerated: false,
};
const proofPath = 'docs/audits/2026-10-18-design73-review-result.json';
assert.ok(!fs.existsSync(proofPath));
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: proof.status, minimumModelCalls: proof.minimumModelCalls,
  reports: proof.reports, replays: replays.map(({ area, completedStages, responsesReplayed }) => ({ area, completedStages, responsesReplayed })),
  preserved: proof.preserved }));
