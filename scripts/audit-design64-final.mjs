import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const root = '/Users/lianjie/Documents/ChatGPT/novel';
const control = root + '/data/audit-runtimes/design64-control';
const read = p => JSON.parse(fs.readFileSync(p));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const alive = pid => {
  assert.ok(Number.isSafeInteger(pid) && pid > 0, 'Missing or invalid worker PID');
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};
const checkpointPath = process.argv[2];
assert.ok(checkpointPath && !checkpointPath.startsWith('--'), 'Pass the final checkpoint explicitly');
const checkpoint = read(checkpointPath);
const binding = read(root + '/data/audit-runtimes/design64-runtime-bound.json');
const baseline = read(control + '/baseline.json');
assert.equal(checkpoint.runtimeCommit, binding.commit);
assert.equal(checkpoint.scheduleVersion, 25);
assert.equal(checkpoint.scope.planId, baseline.planId);
const waiter = fs.existsSync(control + '/resume-waiter.json') ? read(control + '/resume-waiter.json') : undefined;
const workerAlive = alive(checkpoint.pid), waiterAlive = waiter ? alive(waiter.pid) : false;
const complete = checkpoint.runs?.length === 4 && checkpoint.reports?.length === 4
  && checkpoint.runs.every(r => r.status === 'completed' && r.stages.every(s => s.result));
if (process.argv.includes('--preflight')) {
  console.log(JSON.stringify({ ready: !workerAlive && !waiterAlive && checkpoint.status === 'completed' && complete,
    workerAlive, waiterAlive, status: checkpoint.status, areas: (checkpoint.runs ?? []).map(r => ({
      area: r.input.area, status: r.status, completed: r.stages.filter(s => s.result).length, total: r.stages.length,
    })), modelCalls: 0, databaseReads: false, databaseWrites: false }));
  process.exit(0);
}
assert.equal(workerAlive, false, 'Final review worker is still live');
assert.equal(waiterAlive, false, 'Recovery queue is still live');
assert.equal(checkpoint.status, 'completed');
assert.deepEqual(checkpoint.errors, []);
assert.equal(complete, true, 'All four areas must finish');
assert.deepEqual(checkpoint.runs.map(r => r.input.area).sort(), ['characters', 'power', 'story', 'world']);
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(path.join(binding.root, p)), h, p);
const applied = read(root + '/docs/audits/2026-10-16-design64-applied.json');
assert.equal(checkpoint.candidateFileSha256, applied.candidateFileSha256);
assert.equal(checkpoint.scope.planId, applied.planId);

// Traverse exact saved bytes; no recovery or its newly retained failure can be skipped.
const { auditReviewRecoveryChain } = await import('./audit-review-recovery-chain.mjs');
const paths = fs.readdirSync(control).filter(name => /^(?:result|resume-[0-9]+-result)\.json$/.test(name)).map(name => path.join(control, name));
const byHash = new Map(paths.map(p => [fileHash(p), p]));
const chainPaths = [path.resolve(checkpointPath)], seen = new Set();
let cursor = checkpoint;
while (cursor.priorCheckpointSha256) {
  assert.ok(!seen.has(cursor.priorCheckpointSha256), 'Cyclic recovery chain');
  seen.add(cursor.priorCheckpointSha256);
  const previous = byHash.get(cursor.priorCheckpointSha256);
  assert.ok(previous, 'Missing recovery checkpoint');
  chainPaths.unshift(previous); cursor = read(previous);
}
assert.equal(chainPaths[0], control + '/result.json');
assert.ok(chainPaths.length >= 2, 'Design64 has failed areas; the original queue alone cannot certify completion');
for (const p of chainPaths) assert.equal(alive(read(p).pid), false, 'A prior worker is still live');
const recoveryChain = auditReviewRecoveryChain(chainPaths.map(p => fs.readFileSync(p)));

const { PrismaWorkRepository } = await import(binding.root + '/packages/persistence/src/prisma-repository.ts');
const { PrismaClient } = createRequire(binding.root + '/package.json')('@prisma/client');
assert.equal(process.env.DATABASE_URL, 'file:' + root + '/data/novel-studio.db');
const prisma = new PrismaClient();
let work;
try { work = await prisma.$transaction(tx => new PrismaWorkRepository(tx).get(baseline.workId), { timeout: 60000 }); }
finally { await prisma.$disconnect(); }
assert.ok(work);
assert.equal(hash({ world: work.worldPack, bible: work.storyBible, plans: [...work.plans], versions: [...work.versions],
  events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] }), baseline.protectedHash);
for (const [id, h] of baseline.oldRuns) assert.equal(hash(work.designReviewRuns.get(id)), h);
for (const [id, h] of baseline.oldReports) assert.equal(hash(work.designContentReviews.get(id)), h);
for (const run of checkpoint.runs) {
  assert.equal(run.scheduleVersion, 25);
  assert.equal(hash(work.designReviewRuns.get(run.id)), hash(run));
}
for (const report of checkpoint.reports) assert.equal(hash(work.designContentReviews.get(report.id)), hash(report));
assert.ok(![...work.designReviewRuns.values()].some(r => r.leaseToken && Date.parse(r.leaseExpiresAt ?? '') > Date.now()), 'A review lease is still live');

// Reconstruct conclusions using the frozen rules, then replay saved responses only.
const { auditDesignReviews } = await import(binding.root + '/scripts/audit-design-reviews.mjs');
const { designReviewInput } = await import(binding.root + '/novel-service-core/src/design-review.ts');
const stages = await import(binding.root + '/novel-service-core/src/design-review-run.ts');
const { JsonDesignPlanner } = await import(binding.root + '/packages/planner/src/index.ts');
const { replayDesignReviewPrefix } = await import('./audit-design-reviews.mjs');
const audit = auditDesignReviews(work, baseline.planId);
assert.equal(audit.inputHash, baseline.inputHash);
assert.equal(audit.areas.length, 4);
assert.ok(audit.areas.every(a => a.verification === 'verified'), 'Final reports did not reconstruct');
const replay = [];
for (const run of checkpoint.runs) replay.push({ area: run.input.area, runId: run.id,
  ...await replayDesignReviewPrefix(run, designReviewInput(work, run.input.area, baseline.planId), { ...stages, JsonDesignPlanner }) });
const prefixPath = root + '/docs/audits/2026-10-16-design64-prefix-response-audit.json';
const prefix = read(prefixPath);
assert.equal(prefix.inputHash, audit.inputHash);
for (const area of prefix.records) for (const record of area.records) {
  assert.equal(hash(work.designReviewRuns.get(area.runId).stages.find(s => s.id === record.stageId)), record.stageSha256);
}
const negativeFindings = [];
for (const run of checkpoint.runs) for (const stage of run.stages) for (const check of stage.result.checks) {
  if (check.verdict !== 'revise') continue;
  assert.equal(work.designContentReviews.get(run.reportId).checks.find(c => c.criterion === check.criterion)?.verdict, 'revise', 'Adverse finding lost');
  negativeFindings.push({ area: run.input.area, stageId: stage.id, criterion: check.criterion,
    explanation: check.explanation, revisionAdvice: check.revisionAdvice });
}
const manifestPath = root + '/docs/audits/2026-10-16-design64-manual-reconciliation-manifest.json';
const manualReconciliation = read(manifestPath);
assert.equal(manualReconciliation.inputHash, audit.inputHash);
assert.equal(manualReconciliation.planId, baseline.planId);
assert.equal(manualReconciliation.designApproved, false);
for (const finding of manualReconciliation.findings) {
  assert.equal(fileHash(root + '/' + finding.path), finding.sha256, 'Manual finding changed');
  assert.equal(finding.inputHash, audit.inputHash);
}
for (const candidate of [...manualReconciliation.previousCandidates, manualReconciliation.candidate]) {
  assert.equal(fileHash(root + '/' + candidate.path), candidate.sha256, 'Candidate changed');
  assert.equal(candidate.applied, false);
}
const currentBlockingQuestions = [
  ...work.worldPack.unresolvedQuestions.map(q => ({ ...q, document: 'world' })),
  ...work.storyBible.unresolvedQuestions.map(q => ({ ...q, document: 'story' })),
  ...work.plans.get(baseline.planId).plan.openQuestions.map(q => ({ ...q, document: 'plan' })),
].filter(q => q.blocking && q.status !== 'resolved');
assert.equal(currentBlockingQuestions.length, 41);
const proof = { ...audit, runtimeCommit: binding.commit, scheduleVersion: 25,
  sourceFilesVerified: Object.keys(binding.sourceHashes).length, checkpointSha256: fileHash(checkpointPath),
  verifierSha256: fileHash(process.argv[1]), recoveryChain, replay,
  recoveryChainAuditorSha256: fileHash(root + '/scripts/audit-review-recovery-chain.mjs'),
  replayHelperSha256: fileHash(root + '/scripts/audit-design-reviews.mjs'),
  previouslyVerifiedStagesPreserved: prefix.records.reduce((n, a) => n + a.records.length, 0),
  negativeFindings, manualReconciliation, manualReconciliationManifestSha256: fileHash(manifestPath),
  currentBlockingQuestions, releaseStatus: 'blocked_pending_reconciliation', manualFindingsDoNotOverrideFormalVerdicts: true,
  protectedHistoryUnchanged: true, preservedOldRuns: baseline.oldRuns.length, preservedOldReports: baseline.oldReports.length,
  verificationModelCalls: 0, databaseWrites: false, designApproved: false, proseGenerated: false };
const output = root + '/docs/audits/2026-10-16-design64-four-areas-audit.json';
fs.writeFileSync(output, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: proof.status, areas: proof.areas.map(a => ({ area: a.area, status: a.status, verification: a.verification })),
  negativeFindings: negativeFindings.length, responsesReplayed: replay.reduce((n, a) => n + a.responsesReplayed, 0), output }));
