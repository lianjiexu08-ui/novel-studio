// Rehearse, apply, or verify the locally reviewed budget repair as a proposed
// design revision. This never approves a plan or generates prose.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaWorkRepository } from '../packages/persistence/src/prisma-repository.ts';
import { ChapterWorkflow } from '../packages/application/src/index.ts';
import { designReviewHash } from '../novel-service-core/src/design-review.ts';
import { validateDesignCandidate } from '../packages/application/src/design-candidate.ts';

const mode = process.argv[2];
assert.ok(['--rehearse', '--apply', '--verify'].includes(mode));
const read = p => JSON.parse(fs.readFileSync(p));
const hash = value => createHash('sha256').update(JSON.stringify(value, (_, item) => item instanceof Map ? [...item] : item)).digest('hex');
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const workId = 'work_8b6c9133e13d404083ca33acc63f4f61';
const basePlanId = 'plan_14b9ff794fce4e67b7ff6dbf33344e29';
const candidatePath = 'data/design-candidates/design77-budget-repair-v2.json';
const candidateProofPath = 'docs/audits/2026-10-23-design77-budget-repair-v2-candidate.json';
const reviewPath = 'data/audit-runtimes/design77-budget-repair-v2-review/result.json';
const control = 'data/audit-runtimes/design77-budget-repair-v2-save';
const outputPath = mode === '--rehearse' ? 'docs/audits/2026-10-23-design77-budget-repair-v2-rehearsal.json' : 'docs/audits/2026-10-23-design77-budget-repair-v2-applied.json';
const candidate = read(candidatePath), candidateProof = read(candidateProofPath), review = read(reviewPath);
assert.equal(hash(candidate), candidateProof.candidateSha256);
assert.equal(review.status, 'completed');
assert.ok(review.result.checks.every(check => check.verdict === 'pass'));
assert.equal(review.productionWrites, 0);
assert.equal(review.formalAcceptance, false);
assert.equal(validateDesignCandidate(candidate).valid, true);
fs.mkdirSync(control, { recursive: true });

const signatures = work => Object.fromEntries(Object.entries(work).map(([key, value]) => [key, value instanceof Map ? Object.fromEntries([...value].map(([id, item]) => [id, hash(item)])) : hash(value)]));
const versions = work => ({ world: work.worldPack.revision, storyBible: work.storyBible.revision, plan: Math.max(...[...work.plans.values()].map(item => item.revision)), approvedPlan: work.plans.get(work.activePlanId).revision });
const save = (p, value) => fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', flush: true });
const copyDatabase = destination => execFileSync('python3', ['-c', "import sqlite3,sys; a=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); b=sqlite3.connect(sys.argv[2]); a.backup(b); b.close(); a.close()", path.resolve('data/novel-studio.db'), path.resolve(destination)]);

if (mode === '--rehearse') {
  assert.ok(!fs.existsSync(outputPath));
  const privateDb = path.join(control, 'private-v4.db');
  assert.ok(!fs.existsSync(privateDb));
  copyDatabase(privateDb);
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${path.resolve(privateDb)}` } } });
  const repo = new PrismaWorkRepository(prisma);
  try {
    const before = await repo.get(workId); assert.ok(before);
    assert.equal(before.worldPack.revision, 41); assert.equal(before.storyBible.revision, 73); assert.equal(before.plans.get(basePlanId).revision, 77);
    const expectedInputHash = designReviewHash(before, basePlanId);
    const beforeSignatures = signatures(before);
    const workflow = new ChapterWorkflow(repo, { generateChapter() { throw new Error('No prose during proposal save'); } });
    const result = await workflow.saveDesignCandidate(workId, { basePlanId, expectedInputHash, candidate,
      note: '保存第31章护货账户的局部修复为待审整体提案；保留所有历史评审、开放阻塞和未批准状态。' });
    const after = await repo.get(workId);
    assert.equal(after.worldPack.revision, 41); assert.equal(after.storyBible.revision, 74); assert.equal(result.plan.revision, 78);
    assert.equal(after.plans.get(after.activePlanId).revision, 10);
    assert.equal(result.plan.status, 'proposed'); assert.deepEqual(result.plan.plan, candidate.plan);
    assert.equal(result.contentReview.ready, false);
    for (const [key, value] of Object.entries(beforeSignatures)) {
      if (!['worldPack', 'storyBible', 'plans', 'designHistory', 'constraintRevision'].includes(key)) assert.deepEqual(signatures(after)[key], value, key);
    }
    save(outputPath, { verified: true, mode, workId, basePlanId, expectedInputHash, candidatePath, candidateSha256: candidateProof.candidateSha256,
      reviewPath, reviewSha256: sha(reviewPath), revisions: versions(after), approved: false, formalAcceptance: false, proseGenerated: false, productionWrites: 0,
      privateDb, oldRecordsPreserved: true, limitation: 'Private SQLite rehearsal only; production state was not changed.' });
    console.log(JSON.stringify({ verified: true, mode, revisions: versions(after), productionWrites: 0, approved: false }));
  } finally { await repo.disconnect(); await prisma.$disconnect(); }
  process.exit(0);
}

const prisma = new PrismaClient({ datasources: { db: { url: 'file:/Users/lianjie/Documents/ChatGPT/novel/data/novel-studio.db' } } });
const repo = new PrismaWorkRepository(prisma);
try {
  const before = await repo.get(workId); assert.ok(before);
  const expectedInputHash = designReviewHash(before, basePlanId);
  assert.equal(before.worldPack.revision, 41); assert.equal(before.storyBible.revision, 73); assert.equal(before.plans.get(basePlanId).revision, 77);
  if (mode === '--apply') {
    assert.ok(!fs.existsSync(outputPath));
    assert.ok(![...before.designReviewRuns.values()].some(run => run.leaseToken));
    const intentPath = path.join(control, 'apply-intent.json'); assert.ok(!fs.existsSync(intentPath));
    save(intentPath, { workId, basePlanId, expectedInputHash, candidateSha256: candidateProof.candidateSha256, beforeVersions: versions(before), beforeSignatures: signatures(before), createdAt: new Date().toISOString() });
    const workflow = new ChapterWorkflow(repo, { generateChapter() { throw new Error('No prose during proposal save'); } });
    const result = await workflow.saveDesignCandidate(workId, { basePlanId, expectedInputHash, candidate,
      note: '保存第31章护货账户的局部修复为待审整体提案；保留所有历史评审、开放阻塞和未批准状态。' });
    const after = await repo.get(workId);
    assert.equal(after.worldPack.revision, 41); assert.equal(after.storyBible.revision, 74); assert.equal(result.plan.revision, 78);
    assert.equal(after.plans.get(after.activePlanId).revision, 10); assert.equal(result.plan.status, 'proposed'); assert.equal(result.contentReview.ready, false);
    assert.deepEqual(result.plan.plan, candidate.plan);
    save(outputPath, { verified: true, mode, workId, basePlanId, expectedInputHash, candidatePath, candidateSha256: candidateProof.candidateSha256,
      reviewPath, reviewSha256: sha(reviewPath), revisions: versions(after), appliedPlanId: result.plan.id, approved: false, formalAcceptance: false,
      proseGenerated: false, productionWrites: 1, oldRecordsPreserved: true, limitation: 'Proposed design save only; formal acceptance and prose generation remain disabled.' });
    console.log(JSON.stringify({ verified: true, mode, revisions: versions(after), appliedPlanId: result.plan.id, productionWrites: 1, approved: false }));
  } else {
    assert.equal(mode, '--verify');
    const result = read('docs/audits/2026-10-23-design77-budget-repair-v2-applied.json');
    assert.equal(result.candidateSha256, candidateProof.candidateSha256); assert.equal(result.reviewSha256, sha(reviewPath));
    assert.equal(before.worldPack.revision, 41); assert.equal(before.storyBible.revision, 74); assert.equal(before.plans.get(result.appliedPlanId).revision, 78);
    assert.equal(before.plans.get(before.activePlanId).revision, 10); assert.equal(before.plans.get(result.appliedPlanId).status, 'proposed');
    assert.deepEqual(before.plans.get(result.appliedPlanId).plan, candidate.plan);
    assert.equal(before.designReviewAnnotations.size, 45); assert.equal(before.designReviewRuns.size, 103); assert.equal(before.designContentReviews.size, 92);
    console.log(JSON.stringify({ verified: true, mode, revisions: versions(before), appliedPlanId: result.appliedPlanId, productionWrites: 0, approved: false, oldRecordsPreserved: true }));
  }
} finally { await repo.disconnect(); await prisma.$disconnect(); }
