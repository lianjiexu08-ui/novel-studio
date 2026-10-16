// Verify the completed power record while the same worker reviews other areas.
// This script does not call a model, alter production records, or grant acceptance.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { replayDesignReviewRecord } from '../../scripts/audit-design-reviews.mjs';

const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const control = 'data/audit-runtimes/design70-review';
const baseline = read(`${control}/baseline.json`);
const bindingPath = 'data/audit-runtimes/design70-runtime-bound.json';
const binding = read(bindingPath);
assert.equal(sha(fs.readFileSync(bindingPath)), baseline.runtimeBindingSha256);
assert.equal(sha(fs.readFileSync('scripts/run-design70-review.mjs')), baseline.runnerSha256);
for (const [name, expected] of Object.entries(binding.sourceHashes)) {
  assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${name}`)), expected, name);
}
const inputBytes = fs.readFileSync(`${control}/inputs.json`);
assert.equal(sha(inputBytes), baseline.inputsSha256);
const expectedInput = JSON.parse(inputBytes).power;
assert.equal(hash(expectedInput), baseline.areas.find(area => area.area === 'power').sourceEnvelopeSha256);
const checkpointBytes = fs.readFileSync(`${control}/result.json`);
const checkpoint = JSON.parse(checkpointBytes);
const runs = checkpoint.runs.filter(run => run.input.area === 'power');
assert.equal(runs.length, 1);
const run = runs[0];
assert.equal(run.status, 'completed', 'Wait for the actual power report; do not synthesize missing results');
assert.equal(run.scheduleVersion, 31);
assert.equal(run.input.inputHash, baseline.inputHash);
const reports = checkpoint.reports.filter(report => report.id === run.reportId);
assert.equal(reports.length, 1);
const report = reports[0];
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const replay = await replayDesignReviewRecord(run, expectedInput, report, { ...runtime, JsonDesignPlanner });

// SQLite backup uses a read-only source connection, avoiding Prisma's write
// transaction lock on the live database. Other areas may continue to advance.
const snapshotDirectory = fs.mkdtempSync(path.resolve(control, 'power-complete-verification-'));
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
const { PrismaWorkRepository } = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const prisma = new PrismaClient({ datasources: { db: { url: `file:${databaseSnapshotPath}` } } });
let preserved;
try {
  preserved = await prisma.$transaction(async tx => {
    const work = await new PrismaWorkRepository(tx).get(baseline.workId);
    assert.ok(work);
    assert.deepEqual(work.designReviewRuns.get(run.id), run);
    assert.deepEqual(work.designContentReviews.get(report.id), report);
    const protectedHash = hash({ world: work.worldPack, bible: work.storyBible, plans: [...work.plans], activePlanId: work.activePlanId,
      versions: [...work.versions], events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] });
    assert.equal(protectedHash, baseline.protectedHash);
    for (const [id, expected] of baseline.oldRuns) assert.equal(hash(work.designReviewRuns.get(id)), expected);
    for (const [id, expected] of baseline.oldReports) assert.equal(hash(work.designContentReviews.get(id)), expected);
    return { protectedHash, oldRunsUnchanged: baseline.oldRuns.length, oldReportsUnchanged: baseline.oldReports.length,
      plans: work.plans.size, versions: work.versions.size, events: work.events.size, manuscripts: work.manuscripts.size,
      candidates: work.candidates.size, approvedPlanRevision: work.plans.get(work.activePlanId).revision };
  }, { maxWait: 30_000, timeout: 120_000 });
} finally { await prisma.$disconnect(); }

const disputeEvidence = [
  'docs/audits/2026-10-17-design70-power-synthesis-accounts.json',
  'docs/audits/2026-10-17-design70-power-training-order-dispute.json',
  'docs/audits/2026-10-17-design70-power-dispute-followup.json',
].map(path => {
  const bytes = fs.readFileSync(path), evidence = JSON.parse(bytes);
  assert.equal(evidence.inputHash, run.input.inputHash);
  assert.equal(sha(fs.readFileSync(evidence.checkpointPath)), evidence.checkpointSha256);
  return { path, sha256: sha(bytes) };
});
const snapshotPath = `${control}/power-complete-checkpoint.json`;
const proofPath = 'docs/audits/2026-10-17-design70-power-complete.json';
assert.ok(!fs.existsSync(snapshotPath) && !fs.existsSync(proofPath), 'Preserve prior completion evidence');
const proof = { observedAt: new Date().toISOString(), kind: 'design70_completed_power_record_integrity',
  runId: run.id, reportId: report.id, inputHash: run.input.inputHash, snapshotPath, snapshotSha256: sha(checkpointBytes),
  inputsSha256: baseline.inputsSha256, runtimePath: binding.runtimePath, sourceCommit: binding.sourceCommit,
  databaseSnapshotPath, databaseSnapshotSha256: sha(fs.readFileSync(databaseSnapshotPath)),
  productionVerification: 'read_only_sqlite_backup',
  replay, preserved, report: { id: report.id, area: report.area, status: report.status, summary: report.summary,
    scope: report.scope, inputHash: report.inputHash, checks: report.checks, resolvedDeferrals: report.resolvedDeferrals,
    sourcesSha256: hash(report.sources), sourceCount: report.sources.length, reportSha256: hash(report) }, disputeEvidence,
  semanticReconciliationRecords: ['synthesis-3', 'synthesis-12', 'synthesis-16', 'synthesis-30', 'synthesis-32', 'synthesis-45', 'synthesis-47']
    .map(id => {
      const stage = run.stages.find(item => item.id === id);
      assert.ok(stage?.result);
      return { stageId: id, children: stage.children, summary: stage.result.summary,
        checks: stage.result.checks.map(({ criterion, verdict, explanation }) => ({ criterion, verdict, explanation })) };
    }),
  openingRealmSources: expectedInput.sources.filter(source => ['story/characters/char_01', 'plan/chapters/1'].includes(source.id)),
  retainedNonPassChecks: run.stages.flatMap(stage => stage.result.checks.filter(check => check.verdict !== 'pass')
    .map(check => ({ stageId: stage.id, criterion: check.criterion, verdict: check.verdict,
      explanation: check.explanation, awaitingSources: check.awaitingSources,
      resolvedByStageId: report.resolvedDeferrals?.find(item => item.checkId === `${stage.id}/${check.criterion}`)?.resolvedByStageId }))),
  otherAreasAtSnapshot: checkpoint.runs.filter(item => item.id !== run.id).map(item => ({ area: item.input.area,
    status: item.status, completedStages: item.stages.filter(stage => stage.result).length, totalStages: item.stages.length })),
  modelCalls: 0, productionWrites: 0, formalAcceptance: false,
  limitation: 'Verifies the completed power record and protected history, not semantic correctness, dispute resolution, other areas, plan approval or prose acceptance.' };
fs.writeFileSync(snapshotPath, checkpointBytes, { flag: 'wx' });
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ runId: run.id, reportId: report.id, reportStatus: report.status, replay, preserved,
  otherAreasAtSnapshot: proof.otherAreasAtSnapshot, formalAcceptance: false }));
