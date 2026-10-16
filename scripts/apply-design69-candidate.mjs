// Save one reviewed repair candidate as a proposal, never as an approved plan.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const fileHash = file => sha(fs.readFileSync(file));
const clean = value => JSON.parse(JSON.stringify(value));
const mode = process.argv[2];
assert.ok(['--prepare', '--apply', '--verify'].includes(mode));
const root = process.cwd(), control = path.join(root, 'data/audit-runtimes/design69-preparation');
const snapshotPath = path.join(control, 'before.db'), preparationPath = path.join(control, 'preparation.json');
const dbPath = path.join(root, 'data/novel-studio.db');
const previous = read('data/audit-runtimes/design68-review/baseline.json');
const focused = read('docs/audits/2026-10-17-design68-focused-review.json');
const candidatePath = focused.candidatePath, candidate = read(candidatePath);
assert.equal(fileHash(candidatePath), focused.candidateSha256);
for (const [name, expected] of Object.entries(focused.sourceHashes)) assert.equal(fileHash(path.join(focused.runtimePath, name)), expected, name);
const { PrismaWorkRepository } = await import(`${focused.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const { validateDesignCandidate } = await import(`${focused.runtimePath}/packages/application/src/design-candidate.ts`);
const { designReviewHash, designReviewInput } = await import(`${focused.runtimePath}/novel-service-core/src/design-review.ts`);
const { qualityAuditFor } = await import(`${focused.runtimePath}/novel-service-core/src/core.ts`);
const serialize = work => Object.fromEntries(Object.entries(work).map(([key, value]) => [key, value instanceof Map ? [...value] : value]));
const preservedKeys = ['plans', 'designHistory', 'versions', 'events', 'manuscripts', 'candidates', 'designReviewRuns', 'designContentReviews'];
const allowedFields = new Set(['worldPack', 'storyBible', 'plans', 'designHistory', 'constraintRevision']);
const protectedFields = work => Object.fromEntries(Object.entries(serialize(work)).filter(([key]) => !allowedFields.has(key)));
async function load(databasePath) {
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } });
  try { return await new PrismaWorkRepository(prisma).get(previous.workId); }
  finally { await prisma.$disconnect(); }
}
function checkBase(work) {
  assert.ok(work);
  assert.equal(designReviewHash(work, previous.planId), previous.inputHash);
  assert.equal(work.plans.size, 68);
  assert.equal(work.plans.get(work.activePlanId).revision, 10);
  assert.ok(![...work.designReviewRuns.values()].some(run => run.leaseToken && Date.parse(run.leaseExpiresAt ?? '') > Date.now()));
  assert.equal(hash({ world: work.worldPack, bible: work.storyBible, plans: [...work.plans], activePlanId: work.activePlanId,
    versions: [...work.versions], events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] }), previous.protectedHash);
  const oldFinal = read('data/audit-runtimes/design68-review/result.json');
  assert.equal(oldFinal.status, 'completed');
  for (const run of oldFinal.runs) assert.equal(hash(work.designReviewRuns.get(run.id)), hash(run));
  for (const report of oldFinal.reports) assert.equal(hash(work.designContentReviews.get(report.id)), hash(report));
  for (const [id, expected] of previous.oldRuns) assert.equal(hash(work.designReviewRuns.get(id)), expected);
  for (const [id, expected] of previous.oldReports) assert.equal(hash(work.designContentReviews.get(id)), expected);
}
const validation = validateDesignCandidate(candidate);
assert.equal(validation.valid, true, JSON.stringify(validation.issues));
if (mode === '--prepare') {
  assert.ok(!fs.existsSync(control), 'Preserve existing preparation');
  const live = await load(dbPath); checkBase(live);
  fs.mkdirSync(control);
  execFileSync('python3', ['-c', 'import sqlite3,sys,pathlib\nsrc=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+"?mode=ro",uri=True)\ndst=sqlite3.connect(sys.argv[2])\nsrc.backup(dst)\ndst.close()\nsrc.close()', dbPath, snapshotPath]);
  const snapshot = await load(snapshotPath); checkBase(snapshot);
  assert.deepEqual(clean(serialize(snapshot)), clean(serialize(live)));
  const preparation = { preparedAt: new Date().toISOString(), workId: previous.workId, sourcePlanId: previous.planId,
    sourceInputHash: previous.inputHash, candidatePath, candidateSha256: fileHash(candidatePath),
    snapshotPath, snapshotSha256: fileHash(snapshotPath), baselineWorkSha256: hash(serialize(snapshot)),
    protectedFieldsSha256: hash(protectedFields(snapshot)),
    preserved: Object.fromEntries(preservedKeys.map(key => [key, [...snapshot[key]].map(([id, value]) => [id, hash(value)])])),
    runtimePath: focused.runtimePath, sourceHashes: focused.sourceHashes,
    focusedReviewSha256: fileHash('docs/audits/2026-10-17-design68-focused-review.json'),
    scriptSha256: fileHash(process.argv[1]), blockers: 41, executionChecks: 40, formalAcceptance: false };
  fs.writeFileSync(preparationPath, JSON.stringify(preparation, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ prepared: true, snapshotPath, candidateSha256: preparation.candidateSha256, productionWrites: 0 }));
} else {
  const preparation = read(preparationPath);
  assert.equal(fileHash(process.argv[1]), preparation.scriptSha256);
  assert.equal(fileHash(snapshotPath), preparation.snapshotSha256);
  assert.equal(fileHash(candidatePath), preparation.candidateSha256);
  assert.equal(fileHash('docs/audits/2026-10-17-design68-focused-review.json'), preparation.focusedReviewSha256);
  if (mode === '--apply') {
    const before = await load(dbPath); checkBase(before);
    assert.equal(hash(serialize(before)), preparation.baselineWorkSha256);
    const attemptPath = path.join(control, 'attempt.json');
    assert.ok(!fs.existsSync(attemptPath), 'A prior save may have committed; inspect and verify, never blindly resubmit');
    const current = await fetch(`http://127.0.0.1:8787/works/${previous.workId}/design/candidate`);
    assert.equal(current.status, 200);
    const baseline = await current.json();
    assert.equal(baseline.basePlanId, previous.planId);
    assert.equal(baseline.expectedInputHash, previous.inputHash);
    fs.writeFileSync(attemptPath, JSON.stringify({ startedAt: new Date().toISOString(), candidateSha256: preparation.candidateSha256 }), { flag: 'wx' });
    const response = await fetch(`http://127.0.0.1:8787/works/${previous.workId}/design/candidate`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ basePlanId: previous.planId,
        expectedInputHash: previous.inputHash, candidate,
        note: '补获救前暖舱供给与漏查、剑器复用检查费用和墨幽屠个人实测负荷。结构、隔离保存和局部内容复核通过；局部报告另有已记录的单位/身份转述错误，不能作为整体验收。保留全部旧设计与评审，待四领域重新评审，不批准写作。' }),
    });
    const text = await response.text();
    fs.writeFileSync(path.join(control, 'save-response.json'), JSON.stringify({ status: response.status, body: text }), { flag: 'wx' });
    assert.equal(response.status, 201, text.slice(0, 500));
  }
  const after = await load(dbPath);
  assert.ok(after);
  assert.equal(hash(protectedFields(after)), preparation.protectedFieldsSha256, 'An unrelated work field changed');
  for (const key of preservedKeys) {
    for (const [id, expected] of preparation.preserved[key]) assert.equal(hash(after[key].get(id)), expected, `${key}/${id}`);
    assert.equal(after[key].size, preparation.preserved[key].length + (key === 'plans' ? 1 : key === 'designHistory' ? 2 : 0));
  }
  const before = await load(snapshotPath);
  assert.equal(after.constraintRevision, before.constraintRevision + 1);
  const newPlans = [...after.plans.values()].filter(plan => !before.plans.has(plan.id));
  assert.equal(newPlans.length, 1);
  const plan = newPlans[0];
  assert.equal(plan.revision, 69); assert.equal(plan.status, 'proposed');
  assert.deepEqual(plan.plan, candidate.plan);
  assert.deepEqual(after.worldPack, clean({ ...candidate.worldPack, revision: 35, status: 'proposed', lockedAt: undefined }));
  assert.deepEqual(after.storyBible, clean({ ...candidate.storyBible, revision: 66, status: 'proposed', lockedAt: undefined,
    worldPackId: after.worldPack.id, worldPackRevision: 35 }));
  assert.deepEqual(plan.plan.chapters.map(chapter => chapter.executionChecks), before.plans.get(previous.planId).plan.chapters.map(chapter => chapter.executionChecks));
  const executionChecks = plan.plan.chapters.flatMap(chapter => chapter.executionChecks ?? []).length;
  const blockers = qualityAuditFor(after).questions.filter(question => question.blocking && question.status !== 'resolved').length;
  assert.equal(executionChecks, 40); assert.equal(blockers, 41);
  const inputs = Object.fromEntries(['world', 'power', 'characters', 'story'].map(area => [area, designReviewInput(after, area, plan.id)]));
  const inputHash = designReviewHash(after, plan.id);
  assert.ok(Object.values(inputs).every(input => input.inputHash === inputHash));
  const proof = { kind: 'design69_candidate_applied_as_proposal', observedAt: new Date().toISOString(), preparationPath,
    candidatePath, candidateSha256: preparation.candidateSha256, snapshotPath, snapshotSha256: preparation.snapshotSha256,
    sourcePlanId: previous.planId, sourceInputHash: previous.inputHash, appliedPlanId: plan.id, inputHash,
    revisions: { world: 35, bible: 66, plan: 69, approvedPlan: after.plans.get(after.activePlanId).revision },
    savedContentMatchesCandidate: true, oldRecordsPreserved: true, unrelatedFieldsUnchanged: true,
    oldCounts: Object.fromEntries(preservedKeys.map(key => [key, preparation.preserved[key].length])),
    executionChecks, blockers, detailedOutlines: plan.plan.chapters.length, macroChapterTarget: plan.plan.targetChapterCount,
    modelCalls: 0, productionDesignSaves: 1, formalAcceptance: false, proseGenerated: false };
  const proofPath = 'docs/audits/2026-10-17-design69-applied.json';
  if (fs.existsSync(proofPath)) {
    const existing = read(proofPath);
    assert.deepEqual({ ...proof, observedAt: existing.observedAt }, existing);
  } else {
    fs.writeFileSync(path.join(control, 'inputs.json'), JSON.stringify(inputs), { flag: 'wx' });
    fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify({ verified: true, planId: plan.id, inputHash, revisions: proof.revisions, blockers, executionChecks, oldRecordsPreserved: true }));
}
