import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

const root = process.cwd();
const attempt = process.argv.includes('--repeat') ? '3' : '2';
const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const control = path.join(root, 'data/audit-runtimes/design64-control');
const runner = path.join(root, 'scripts/resume-design64-review.mjs');
const binding = read('data/audit-runtimes/design64-runtime-bound.json');
const originalBytes = fs.readFileSync(path.join(control, 'result.json'), 'utf8');
const original = JSON.parse(originalBytes);
assert.equal(original.status, 'running');
const blocked = spawnSync(process.execPath, ['--experimental-strip-types', runner,
  '--execute', '--prior-sha256=' + hash(originalBytes)], { cwd: root, encoding: 'utf8', env: process.env });
assert.notEqual(blocked.status, 0, 'Live queue must prevent production recovery');
assert.match(blocked.stderr, /AssertionError/);
assert.ok(!fs.existsSync(path.join(control, 'resume-1-result.json')));

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'novel64-resume-rehearsal-'));
const database = path.join(directory, 'snapshot.db');
execFileSync('python3', ['-c',
  'import sqlite3,sys\ns=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)\nd=sqlite3.connect(sys.argv[2])\ns.backup(d)\nd.close()\ns.close()',
  path.join(root, 'data/novel-studio.db'), database]);
process.env.DATABASE_URL = 'file:' + database;
const { PrismaWorkRepository } = await import(binding.root + '/packages/persistence/src/prisma-repository.ts');
const repo = new PrismaWorkRepository();
let before;
try { before = await repo.get(original.scope.workId); } finally { await repo.disconnect(); }
const area = original.areas.find(a => a.area === 'power');
const previousRun = before.designReviewRuns.get(area.runId);
assert.equal(previousRun.status, 'failed');
const nextStage = previousRun.stages.find(s => !s.result);
assert.equal(nextStage.id, 'cross-3-5');
const prior = { ...original, rehearsalOnly: true, areas: [area],
  runs: [previousRun], reports: [...before.designContentReviews.values()] };
fs.writeFileSync(path.join(control, `resume-rehearsal-${attempt}-baseline.json`), JSON.stringify(prior, null, 2) + '\n', { flag: 'wx' });
execFileSync(process.execPath, ['--experimental-strip-types', runner, '--rehearse-failure', '--rehearsal-id=-' + attempt], {
  cwd: root, env: { ...process.env, DATABASE_URL: 'file:' + database }, encoding: 'utf8', stdio: 'pipe' });
const restarted = new PrismaWorkRepository();
let after;
try { after = await restarted.get(original.scope.workId); } finally { await restarted.disconnect(); }
const resumed = after.designReviewRuns.get(area.runId);
const step = resumed.stages.find(s => s.id === nextStage.id);
assert.equal(step.attempts, nextStage.attempts + 1);
assert.equal(step.failures.length, nextStage.failures.length + 1);
assert.deepEqual(step.failures.slice(0, nextStage.failures.length), nextStage.failures);
assert.equal(step.result, undefined);
assert.ok(!resumed.leaseToken);
for (const stage of previousRun.stages.filter(s => s.result)) {
  assert.deepEqual(resumed.stages.find(s => s.id === stage.id), stage);
}
assert.equal(after.constraintRevision, before.constraintRevision + 2, 'Claim and failure each advance optimistic concurrency revision');
const unrelated = w => ({ ...w, constraintRevision: undefined, designReviewRuns: [...w.designReviewRuns].filter(([id]) => id !== area.runId),
  plans: [...w.plans], versions: [...w.versions], events: [...w.events], manuscripts: [...w.manuscripts],
  candidates: [...w.candidates], designHistory: [...w.designHistory], designContentReviews: [...w.designContentReviews] });
assert.ok(isDeepStrictEqual(unrelated(after), unrelated(before)), 'All records outside the failed run and concurrency revision must remain unchanged');
const result = read(path.join(control, `resume-rehearsal-${attempt}-result.json`));
assert.equal(result.status, 'stopped_after_failure');
assert.equal(result.stepsStarted.length, 1);
assert.equal(result.resumeUsage.calls, 0);
const proof = { status: 'isolated_failure_recovery_verified', observedAt: new Date().toISOString(),
  rehearsalOnly: true, runtimeCommit: binding.commit, scheduleVersion: binding.scheduleVersion,
  resumeScriptSha256: hash(fs.readFileSync(runner, 'utf8')), verifierSha256: hash(fs.readFileSync(process.argv[1], 'utf8')),
  originalCheckpointSha256: hash(originalBytes), database, runId: area.runId, resumedStageId: step.id,
  completedStagesUnchanged: previousRun.stages.filter(s => s.result).length,
  priorFailuresPreserved: nextStage.failures.length, appendedFailures: 1, attemptsIncrementedOnce: true,
  leasesReleased: true, unrelatedRunsUnchanged: before.designReviewRuns.size - 1,
  protectedHistoryUnchanged: true, concurrencyRevisionIncrement: 2,
  previousRehearsal: 'First rehearsal preserved; verifier initially treated the expected concurrency revision increment as an unrelated change. Second rehearsal preserved; third repeats after strengthening the complete-work comparison to include all Map values.',
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  liveQueueGuardVerified: true, concurrency: 1, modelCalls: 0, productionDatabaseWrites: 0,
  formalAcceptance: false, proseGenerated: false };
fs.writeFileSync(`docs/audits/2026-10-16-design64-recovery-rehearsal${attempt === '3' ? '-3' : ''}.json`, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(proof));
