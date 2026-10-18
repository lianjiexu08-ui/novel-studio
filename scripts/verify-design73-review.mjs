// Read-only terminal verification for the resumable design73 review.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const workRepository = new PrismaWorkRepository();
const work = await workRepository.get(baseline.workId);
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
await workRepository.disconnect();
const checkpointSha256 = fileHash(checkpointPath);
const proof = {
  observedAt: new Date().toISOString(), status: state.status, workerPid: state.pid, workerAbsent: true,
  checkpointPath, checkpointSha256, runtimePath: binding.runtimePath, sourceCommit: binding.sourceCommit,
  inputsSha256: baseline.inputsSha256, totalCalls: state.totalCalls, errors: state.errors,
  replays, preserved: { protectedHash, oldRunsUnchanged: baseline.oldRuns.length, oldReportsUnchanged: baseline.oldReports.length,
    reviewRuns: work.designReviewRuns.size, reports: work.designContentReviews.size },
  reports: state.reports.map(({ id, area, status, summary }) => ({ id, area, status, summary })),
  verificationModelCalls: 0, productionWrites: 0, formalAcceptance: false, proseGenerated: false,
};
const proofPath = 'docs/audits/2026-10-18-design73-review-result.json';
assert.ok(!fs.existsSync(proofPath));
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: proof.status, totalCalls: proof.totalCalls,
  reports: proof.reports, replays: replays.map(({ area, completedStages, responsesReplayed }) => ({ area, completedStages, responsesReplayed })),
  preserved: proof.preserved }));
