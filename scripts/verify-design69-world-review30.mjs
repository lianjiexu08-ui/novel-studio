// Read-only replay of a terminal checkpoint; never repairs or rewrites judgments.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const fileHash = file => sha(fs.readFileSync(file));
const control = 'data/audit-runtimes/design69-review30';
const checkpointPath = `${control}/result.json`, state = read(checkpointPath), baseline = read(`${control}/baseline.json`);
const binding = read('data/audit-runtimes/design69-review30-runtime-bound.json');
assert.ok(['completed', 'stopped_after_failure', 'stopped_after_budget', 'stopped_by_signal'].includes(state.status));
let alive = false; try { process.kill(state.pid, 0); alive = true; } catch (error) { assert.equal(error.code, 'ESRCH'); }
assert.equal(alive, false, 'Wait for the worker to exit; do not restart it');
assert.equal(fileHash('scripts/run-design69-world-review30.mjs'), baseline.runnerSha256);
assert.equal(fileHash('data/audit-runtimes/design69-review30-runtime-bound.json'), baseline.runtimeBindingSha256);
for (const [name, expected] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(`${binding.runtimePath}/${name}`), expected);
const { designReviewStageInput, completeDesignReviewRun } = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const replays = [];
for (const run of state.runs) {
  assert.equal(run.scheduleVersion, 30);
  assert.equal(run.restartedFromRunId, 'design_run_eccc73d9-8373-422d-b5cc-57770f66242e');
  let responses = 0;
  for (const stage of run.stages.filter(stage => stage.result)) {
    let index = 0;
    const planner = new JsonDesignPlanner({ complete: async () => {
      assert.ok(index < stage.modelResponses.length, `No saved response for ${stage.id}`);
      return stage.modelResponses[index++];
    } });
    const { modelResponses, ...result } = await planner.reviewDesignContent(designReviewStageInput(run, stage));
    assert.deepEqual(result, stage.result);
    assert.deepEqual(modelResponses, stage.modelResponses);
    responses += index;
  }
  if (run.status === 'completed') {
    const completed = completeDesignReviewRun(run);
    const report = state.reports.find(report => report.id === run.reportId);
    assert.ok(report);
    assert.deepEqual(report.checks, completed.result.checks);
    assert.deepEqual(report.sources, completed.input.sources);
    assert.equal(report.summary, completed.result.summary);
  }
  replays.push({ area: run.input.area, runId: run.id, completedStages: run.stages.filter(stage => stage.result).length,
    totalStages: run.stages.length, responsesReplayed: responses,
    retainedNonPassChecks: run.stages.filter(stage => stage.result).flatMap(stage => stage.result.checks
      .filter(check => check.verdict !== 'pass').map(check => ({ stageId: stage.id, ...check }))),
    note: 'Retained non-pass records include earlier deferrals that later stages may resolve; not a count of current independent defects.' });
}
const { PrismaWorkRepository } = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const prisma = new PrismaClient({ datasources: { db: { url: `file:${process.cwd()}/data/novel-studio.db` } } });
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
  });
} finally { await prisma.$disconnect(); }
const stopped = read('docs/audits/2026-10-17-design69-review-stopped.json');
assert.equal(fileHash('data/audit-runtimes/design69-review/result.json'), stopped.checkpointSha256);
const proof = { observedAt: new Date().toISOString(), status: state.status, workerPid: state.pid, workerAbsent: true,
  checkpointPath, checkpointSha256: fileHash(checkpointPath), runtimePath: binding.runtimePath,
  sourceCommit: binding.sourceCommit, totalCalls: state.totalCalls, errors: state.errors, replays, preserved,
  reports: state.reports.map(({ id, area, status, summary }) => ({ id, area, status, summary })),
  verificationModelCalls: 0, productionWrites: 0, formalAcceptance: false, proseGenerated: false };
const proofPath = 'docs/audits/2026-10-17-design69-review30-result.json';
assert.ok(!fs.existsSync(proofPath), 'Keep earlier verification evidence');
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: proof.status, totalCalls: proof.totalCalls,
  replays: replays.map(({ area, completedStages, totalStages, responsesReplayed }) => ({ area, completedStages, totalStages, responsesReplayed })),
  reports: proof.reports, preserved }));
