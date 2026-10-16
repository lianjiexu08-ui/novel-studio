// Persist the reviewed terminology repair as a new proposal, never an approval.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const fileHash = file => sha(fs.readFileSync(file));
const clean = value => JSON.parse(JSON.stringify(value));
const mode = process.argv[2]; assert.ok(['--prepare', '--apply', '--verify'].includes(mode));
const repair = read('docs/audits/2026-10-17-design69-terminology-candidate.json');
const rehearsal = read('docs/audits/2026-10-17-design69-terminology-save-rehearsal.json');
const terminalPath = 'docs/audits/2026-10-17-design69-review30-result.json';
const terminal = read(terminalPath), checkpoint = read(terminal.checkpointPath);
assert.equal(terminal.status, 'completed'); assert.equal(fileHash(terminal.checkpointPath), terminal.checkpointSha256);
try { process.kill(checkpoint.pid, 0); assert.fail('Formal worker still live'); } catch (error) { assert.equal(error.code, 'ESRCH'); }
assert.equal(checkpoint.reports.length, 1);
const report = checkpoint.reports[0];
assert.equal(report.area, 'world'); assert.equal(report.inputHash, repair.expectedInputHash);
assert.equal(report.status, 'needs_revision');
assert.deepEqual(report.checks.map(check => [check.criterion, check.verdict]), [['geography', 'pass'], ['history', 'pass'], ['capacity', 'revise']]);
assert.ok(report.checks.find(check => check.criterion === 'capacity').explanation.includes('诸天通宝'));
assert.equal(rehearsal.candidateSha256, repair.candidateSha256);
assert.equal(fileHash(repair.candidatePath), repair.candidateSha256);
for (const [file, expected] of Object.entries(rehearsal.sourceHashes)) assert.equal(fileHash(file), expected);
const { PrismaWorkRepository } = await import('../packages/persistence/src/prisma-repository.ts');
const { validateDesignCandidate } = await import('../packages/application/src/design-candidate.ts');
const { designReviewHash, designReviewInput, designReviewOverview } = await import('../novel-service-core/src/design-review.ts');
const { qualityAuditFor } = await import('../novel-service-core/src/core.ts');
const candidate = read(repair.candidatePath), validation = validateDesignCandidate(candidate);
assert.equal(validation.valid, true); assert.equal(validation.blockers.length, 41);
const control = path.resolve('data/audit-runtimes/design70-preparation');
const snapshotPath = path.join(control, 'before.db'), manifestPath = path.join(control, 'manifest.json');
const productionPath = path.resolve('data/novel-studio.db');
const maps = ['plans', 'designHistory', 'versions', 'events', 'manuscripts', 'candidates', 'designReviewRuns', 'designContentReviews'];
const serialize = work => Object.fromEntries(Object.entries(work).map(([key, value]) => [key, value instanceof Map ? [...value] : value]));
const allowed = new Set(['worldPack', 'storyBible', 'plans', 'designHistory', 'constraintRevision']);
const protectedFields = work => Object.fromEntries(Object.entries(serialize(work)).filter(([key]) => !allowed.has(key)));
async function load(databasePath) {
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } });
  try { return await prisma.$transaction(tx => new PrismaWorkRepository(tx).get(repair.workId), { maxWait: 30_000, timeout: 120_000 }); }
  finally { await prisma.$disconnect(); }
}
function checkBase(work) {
  assert.ok(work); assert.equal(designReviewHash(work, repair.basePlanId), repair.expectedInputHash);
  assert.equal(work.plans.size, 69); assert.equal(work.plans.get(work.activePlanId).revision, 10);
  assert.ok(![...work.designReviewRuns.values()].some(run => run.leaseToken && Date.parse(run.leaseExpiresAt ?? '') > Date.now()));
  for (const run of checkpoint.runs) assert.deepEqual(work.designReviewRuns.get(run.id), run);
  assert.deepEqual(work.designContentReviews.get(report.id), report);
  assert.equal(hash({ world: work.worldPack, bible: work.storyBible, plans: [...work.plans], activePlanId: work.activePlanId,
    versions: [...work.versions], events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] }), terminal.preserved.protectedHash);
}
if (mode === '--prepare') {
  assert.ok(!fs.existsSync(control), 'Keep prior preparation');
  const work = await load(productionPath); checkBase(work);
  fs.mkdirSync(control);
  execFileSync('python3', ['-c', 'import sqlite3,sys,pathlib\ns=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True)\nt=sqlite3.connect(sys.argv[2])\ns.backup(t)\nt.close()\ns.close()', productionPath, snapshotPath], { timeout: 60_000 });
  const snapshot = await load(snapshotPath); checkBase(snapshot);
  assert.deepEqual(clean(serialize(snapshot)), clean(serialize(work)));
  const manifest = { preparedAt: new Date().toISOString(), snapshotPath, snapshotSha256: fileHash(snapshotPath),
    candidateSha256: repair.candidateSha256, terminalProofSha256: fileHash(terminalPath), scriptSha256: fileHash(process.argv[1]),
    baselineHash: hash(serialize(snapshot)), protectedFieldsHash: hash(protectedFields(snapshot)),
    maps: Object.fromEntries(maps.map(key => [key, [...snapshot[key]].map(([id, value]) => [id, hash(value)])])) };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ prepared: true, productionWrites: 0, snapshotPath }));
} else {
  const manifest = read(manifestPath);
  assert.equal(fileHash(process.argv[1]), manifest.scriptSha256);
  assert.equal(fileHash(snapshotPath), manifest.snapshotSha256);
  assert.equal(fileHash(terminalPath), manifest.terminalProofSha256);
  assert.equal(repair.candidateSha256, manifest.candidateSha256);
  if (mode === '--apply') {
    const work = await load(productionPath); checkBase(work);
    assert.equal(hash(serialize(work)), manifest.baselineHash);
    const attemptPath = path.join(control, 'attempt.json');
    assert.ok(!fs.existsSync(attemptPath), 'Existing save attempt: inspect and verify, never blindly resubmit');
    fs.writeFileSync(attemptPath, JSON.stringify({ startedAt: new Date().toISOString(), candidateSha256: repair.candidateSha256 }), { flag: 'wx' });
    const response = await fetch(`http://127.0.0.1:8787/works/${repair.workId}/design/candidate`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ basePlanId: repair.basePlanId,
        expectedInputHash: repair.expectedInputHash, candidate,
        note: '依据提案69正式世界评审统一诸天通宝正式名，保留万象商币等别名及全部货币规则；仅保存新提案，需四领域评审，不批准写作，不清除旧问题。' }),
    });
    const body = await response.text();
    fs.writeFileSync(path.join(control, 'save-response.json'), JSON.stringify({ status: response.status, body }), { flag: 'wx' });
    assert.equal(response.status, 201, body.slice(0, 300));
  }
  const after = await load(productionPath); assert.ok(after);
  assert.equal(hash(protectedFields(after)), manifest.protectedFieldsHash);
  for (const key of maps) {
    for (const [id, expected] of manifest.maps[key]) assert.equal(hash(after[key].get(id)), expected, `${key}/${id}`);
    assert.equal(after[key].size, manifest.maps[key].length + (key === 'plans' ? 1 : key === 'designHistory' ? 2 : 0));
  }
  const before = await load(snapshotPath);
  assert.equal(after.constraintRevision, before.constraintRevision + 1);
  const added = [...after.plans.values()].filter(plan => !before.plans.has(plan.id)); assert.equal(added.length, 1);
  const plan = added[0]; assert.equal(plan.revision, 70); assert.equal(plan.status, 'proposed');
  assert.deepEqual(plan.plan, candidate.plan);
  assert.deepEqual(after.worldPack, clean({ ...candidate.worldPack, revision: 36, status: 'proposed', lockedAt: undefined }));
  assert.deepEqual(after.storyBible, clean({ ...candidate.storyBible, revision: 67, status: 'proposed', lockedAt: undefined, worldPackRevision: 36 }));
  assert.equal(plan.worldPackRevision, 36); assert.equal(plan.storyBibleRevision, 67);
  const blockers = qualityAuditFor(after).questions.filter(question => question.blocking && question.status !== 'resolved').length;
  const executionChecks = plan.plan.chapters.flatMap(chapter => chapter.executionChecks ?? []).length;
  assert.equal(blockers, 41); assert.equal(executionChecks, 40); assert.equal(designReviewOverview(after, plan.id).ready, false);
  const inputHash = designReviewHash(after, plan.id); assert.notEqual(inputHash, repair.expectedInputHash);
  const inputs = Object.fromEntries(['world', 'power', 'characters', 'story'].map(area => [area, designReviewInput(after, area, plan.id)]));
  const proof = { observedAt: new Date().toISOString(), workId: repair.workId, manifestPath, snapshotPath, snapshotSha256: manifest.snapshotSha256,
    candidatePath: repair.candidatePath, candidateSha256: repair.candidateSha256, sourcePlanId: repair.basePlanId, sourceInputHash: repair.expectedInputHash,
    sourceReportId: report.id, appliedPlanId: plan.id, inputHash, revisions: { world: 36, bible: 67, plan: 70, approvedPlan: after.plans.get(after.activePlanId).revision },
    oldCounts: Object.fromEntries(maps.map(key => [key, manifest.maps[key].length])), savedContentMatchesCandidate: true, oldRecordsPreserved: true,
    unrelatedFieldsUnchanged: true, blockers, executionChecks, modelCalls: 0, productionDesignSaves: 1, formalAcceptance: false, proseGenerated: false };
  const proofPath = 'docs/audits/2026-10-17-design70-applied.json';
  if (fs.existsSync(proofPath)) { const prior = read(proofPath); assert.deepEqual({ ...proof, observedAt: prior.observedAt }, prior); }
  else {
    fs.writeFileSync(path.join(control, 'inputs.json'), JSON.stringify(inputs), { flag: 'wx' });
    fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify({ verified: true, planId: plan.id, inputHash, revisions: proof.revisions, blockers, executionChecks, oldRecordsPreserved: true }));
}
