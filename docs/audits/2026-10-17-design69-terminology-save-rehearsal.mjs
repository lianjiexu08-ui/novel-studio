// Save/reload the terminology candidate in a separate copy of an already verified
// SQLite snapshot. No production writes, model calls, approval or prose.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const read = file => JSON.parse(fs.readFileSync(file));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileHash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const clean = value => JSON.parse(JSON.stringify(value));
const root = process.cwd();
const repair = read('docs/audits/2026-10-17-design69-terminology-candidate.json');
const verified = read('docs/audits/2026-10-17-review-chapter-cast-probe.json');
const sourceSnapshot = fs.realpathSync(verified.productionRead.snapshotPath);
assert.equal(fileHash(sourceSnapshot), verified.productionRead.snapshotSha256);
assert.equal(fileHash(repair.candidatePath), repair.candidateSha256);
const directory = path.resolve('data/audit-runtimes/design69-terminology-save-rehearsal');
assert.ok(!fs.existsSync(directory), 'Retain earlier rehearsals');
fs.mkdirSync(directory);
const databasePath = path.join(directory, 'isolated.db');
fs.copyFileSync(sourceSnapshot, databasePath, fs.constants.COPYFILE_EXCL);
const productionPath = fs.realpathSync('data/novel-studio.db');
for (const other of [productionPath, sourceSnapshot]) {
  assert.notEqual(fs.realpathSync(databasePath), other);
  assert.notDeepEqual([fs.statSync(databasePath).dev, fs.statSync(databasePath).ino],
    [fs.statSync(other).dev, fs.statSync(other).ino]);
}
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const tracked = execFileSync('git', ['ls-files', 'packages', 'novel-service-core'], { encoding: 'utf8' }).trim().split('\n');
const sourceHashes = Object.fromEntries(tracked.filter(file => file.endsWith('.ts')).map(file => [file, fileHash(file)]));
process.env.DATABASE_URL = `file:${databasePath}`;
const { PrismaWorkRepository } = await import('../../packages/persistence/src/prisma-repository.ts');
const { ChapterWorkflow } = await import('../../packages/application/src/index.ts');
const { qualityAuditFor } = await import('../../novel-service-core/src/core.ts');
const { designReviewHash } = await import('../../novel-service-core/src/design-review.ts');
const candidate = read(repair.candidatePath);
const maps = ['plans', 'designHistory', 'versions', 'events', 'manuscripts', 'candidates', 'designReviewRuns', 'designContentReviews'];
const mapHashes = work => Object.fromEntries(maps.map(key => [key, [...work[key]].map(([id, value]) => [id, hash(value)])]));
const repo = new PrismaWorkRepository();
let before, saved;
try {
  const work = await repo.get(repair.workId);
  assert.ok(work);
  assert.equal(designReviewHash(work, repair.basePlanId), repair.expectedInputHash);
  assert.equal(work.plans.size, 69);
  before = { maps: mapHashes(work), activePlanId: work.activePlanId, constraintRevision: work.constraintRevision };
  const workflow = new ChapterWorkflow(repo, { generateChapter() { throw new Error('No prose in rehearsal'); } });
  saved = await workflow.saveDesignCandidate(work.id, { basePlanId: repair.basePlanId, expectedInputHash: repair.expectedInputHash,
    candidate, note: '隔离保存演练：统一诸天通宝正式名及原有别名；不应用生产、不批准设计、不生成正文。' });
  assert.equal(saved.contentReview.ready, false);
} finally { await repo.disconnect(); }
const restarted = new PrismaWorkRepository();
let after;
try { after = await restarted.get(repair.workId); } finally { await restarted.disconnect(); }
assert.ok(after);
for (const key of maps) {
  for (const [id, expected] of before.maps[key]) assert.equal(hash(after[key].get(id)), expected, `${key}/${id}`);
  assert.equal(after[key].size, before.maps[key].length + (key === 'plans' ? 1 : key === 'designHistory' ? 2 : 0));
}
assert.equal(after.activePlanId, before.activePlanId);
assert.equal(after.constraintRevision, before.constraintRevision + 1);
assert.equal(after.plans.get(after.activePlanId).revision, 10);
const restored = after.plans.get(saved.plan.id);
assert.equal(restored.revision, 70); assert.equal(restored.status, 'proposed');
assert.equal(restored.worldPackRevision, 36); assert.equal(restored.storyBibleRevision, 67);
assert.deepEqual(restored.plan, candidate.plan);
assert.deepEqual(after.worldPack, clean({ ...candidate.worldPack, revision: 36, status: 'proposed', lockedAt: undefined }));
assert.deepEqual(after.storyBible, clean({ ...candidate.storyBible, revision: 67, status: 'proposed', lockedAt: undefined,
  worldPackId: after.worldPack.id, worldPackRevision: 36 }));
const isolatedInputHash = designReviewHash(after, restored.id);
assert.notEqual(isolatedInputHash, repair.expectedInputHash);
const audit = qualityAuditFor(after);
const blockers = audit.questions.filter(question => question.blocking && question.status !== 'resolved');
assert.equal(blockers.length, 41);
const executionChecks = restored.plan.chapters.flatMap(chapter => chapter.executionChecks ?? []).length;
assert.equal(executionChecks, 40);
const linked = audit.questions.flatMap(question => question.executionChecks).filter(check => check.planId === restored.id);
assert.equal(linked.length, 33);
assert.ok(linked.every(check => check.executionEvidence.status !== 'verified'));
for (const [file, expected] of Object.entries(sourceHashes)) assert.equal(fileHash(file), expected);
assert.equal(fileHash(sourceSnapshot), verified.productionRead.snapshotSha256, 'Original verified snapshot remains untouched');
const proof = { observedAt: new Date().toISOString(), sourceCommit, sourceHashes,
  candidatePath: repair.candidatePath, candidateSha256: repair.candidateSha256,
  sourceSnapshot, sourceSnapshotSha256: verified.productionRead.snapshotSha256, databasePath,
  basePlanId: repair.basePlanId, baseInputHash: repair.expectedInputHash,
  isolatedPlanId: restored.id, isolatedInputHash, revisions: { world: 36, bible: 67, plan: 70, approved: 10 },
  retainedMapCounts: Object.fromEntries(maps.map(key => [key, before.maps[key].length])),
  protectedMapHashesBefore: hash(before.maps), allExistingRecordsPreservedExactly: true,
  reloadedCandidateMatchesExactly: true, staleReviewsCannotApproveCandidate: true,
  unresolvedBlockers: blockers.length, executionChecks, linkedRequirements: linked.length,
  oldProseCannotCertifyNewRequirements: true, modelCalls: 0, productionWrites: 0,
  isolatedDesignSaves: 1, applied: false, formalAcceptance: false,
  limitation: 'Isolated snapshot save/reload only. Current formal world review continues on original proposal 69; this rehearsal neither changes its input nor establishes content quality.' };
fs.writeFileSync('docs/audits/2026-10-17-design69-terminology-save-rehearsal.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ revisions: proof.revisions, retained: proof.retainedMapCounts, unresolvedBlockers: blockers.length,
  executionChecks, linkedRequirements: linked.length, productionWrites: 0, modelCalls: 0 }));
