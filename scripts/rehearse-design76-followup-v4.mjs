// Exercise candidate persistence only in a copy of the terminal-verified
// segment-7 snapshot. Never open the production database or call a model.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v) ?? 'undefined').digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const clean = v => JSON.parse(JSON.stringify(v));
const proofPath = 'docs/audits/2026-10-18-design76-followup-v4-save-rehearsal.json';
assert.ok(!fs.existsSync(proofPath), 'Preserve prior rehearsal results');
const candidateProofPath = 'docs/audits/2026-10-18-design76-followup-knowledge-v4.json';
const prepared = read(candidateProofPath), candidate = read(prepared.candidatePath);
assert.equal(hash(candidate), prepared.candidateSha256);
const reviewPath = 'docs/audits/2026-10-18-design76-followup-v4-review.json', review = read(reviewPath);
assert.equal(review.candidateSha256, hash(candidate));
assert.equal(fileHash(review.statePath), review.stateSha256);
const clarificationPath = 'docs/audits/2026-10-18-design76-followup-v4-attribution-note.json';
assert.equal(read(clarificationPath).candidateSha256, hash(candidate));
const verificationPath = 'docs/audits/2026-10-18-design76-citation-edits-review-segment-7.json';
const verification = read(verificationPath);
assert.equal(fileHash(verification.checkpointPath), verification.checkpointSha256);
assert.equal(verification.workerAbsent, true); assert.equal(verification.unsettledCalls, 0);
const sourceSnapshot = fs.realpathSync(verification.databaseSnapshotPath);
assert.ok(sourceSnapshot.startsWith(path.resolve('data/audit-runtimes/design76-citation-edits-review/verify-segment-7-')));
assert.notEqual(sourceSnapshot, fs.realpathSync('data/novel-studio.db'));
const snapshotSha256 = fileHash(sourceSnapshot);
const directory = fs.mkdtempSync(path.resolve('data/audit-runtimes/design76-v4-save-rehearsal-'));
const database = path.join(directory, 'private.db');
execFileSync('python3', ['-c', "import sqlite3,sys; a=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); b=sqlite3.connect(sys.argv[2]); a.backup(b); b.close(); a.close()", sourceSnapshot, database]);
assert.notEqual(fs.realpathSync(database), fs.realpathSync('data/novel-studio.db'));
const bindingPath = 'data/audit-runtimes/design76-citation-operations-runtime-bound.json', binding = read(bindingPath);
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(`${binding.runtimePath}/${p}`), h);
for (const [p, h] of Object.entries(binding.dependencyHashes)) assert.equal(fileHash(p), h);
const {PrismaClient} = createRequire(`${binding.runtimePath}/package.json`)('@prisma/client');
const {PrismaWorkRepository} = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const {ChapterWorkflow} = await import(`${binding.runtimePath}/packages/application/src/index.ts`);
const {validateDesignCandidate} = await import(`${binding.runtimePath}/packages/application/src/design-candidate.ts`);
const {designReviewHash, designReviewOverview, designReviewInput} = await import(`${binding.runtimePath}/novel-service-core/src/design-review.ts`);
const {qualityAuditFor} = await import(`${binding.runtimePath}/novel-service-core/src/core.ts`);
const baseline = read('data/audit-runtimes/design76-citation-edits-review/baseline.json');
const validation = validateDesignCandidate(candidate);
assert.equal(validation.valid, true); assert.equal(validation.blockers.length, 41);
const mutable = new Set(['worldPack', 'storyBible', 'plans', 'designHistory', 'constraintRevision']);
const mapHashes = map => Object.fromEntries([...map].map(([id, v]) => [id, hash(v)]));
const digests = w => Object.fromEntries(Object.entries(w).map(([key, v]) => [key, v instanceof Map ? mapHashes(v) : hash(v)]));
const open = () => {
  const prisma = new PrismaClient({datasources: {db: {url: 'file:' + database}}});
  return {prisma, repository: new PrismaWorkRepository(prisma)};
};
let {prisma, repository} = open(), beforeDigests, counts, constraintRevision, saved, activePlanId;
try {
  let before = await repository.get(baseline.workId); assert.ok(before);
  assert.equal(before.worldPack.revision, 40); assert.equal(before.storyBible.revision, 72);
  assert.equal(before.plans.get(baseline.planId).revision, 76);
  assert.equal(designReviewHash(before, baseline.planId), prepared.expectedInputHash);
  assert.equal(prepared.expectedInputHash, baseline.inputHash);
  assert.deepEqual(validateDesignCandidate({worldPack: before.worldPack, storyBible: before.storyBible, plan: before.plans.get(baseline.planId).plan}).blockers, validation.blockers);
  for (const replay of verification.replays) {
    const run = before.designReviewRuns.get(replay.runId); assert.ok(run);
    for (const record of replay.records) assert.equal(hash(run.stages.find(s => s.id === record.stageId)), record.stageSha256);
  }
  beforeDigests = digests(before); activePlanId = before.activePlanId; constraintRevision = before.constraintRevision;
  counts = Object.fromEntries(Object.entries(before).filter(([, v]) => v instanceof Map).map(([k, v]) => [k, v.size]));
  before = undefined;
  const workflow = new ChapterWorkflow(repository, {generateChapter() { throw Error('No prose in rehearsal'); }});
  saved = await workflow.saveDesignCandidate(baseline.workId, {basePlanId: baseline.planId,
    expectedInputHash: prepared.expectedInputHash, candidate,
    note: '仅在第7段已核验数据库副本演练v4候选保存；全量内容评审未完成，不能批准正文。'});
  await assert.rejects(workflow.saveDesignCandidate(baseline.workId, {
    basePlanId: baseline.planId, expectedInputHash: prepared.expectedInputHash, candidate,
  }), /整体修订基线/, 'A stale retry must not add another proposal');
} finally { await repository.disconnect(); await prisma.$disconnect(); }
({prisma, repository} = open());
let result;
try {
  const after = await repository.get(baseline.workId); assert.ok(after);
  const afterDigests = digests(after);
  assert.deepEqual(Object.keys(afterDigests).sort(), Object.keys(beforeDigests).sort());
  for (const [key, value] of Object.entries(beforeDigests)) if (!mutable.has(key)) assert.deepEqual(afterDigests[key], value, key);
  for (const [key, count] of Object.entries(counts)) {
    for (const [id, h] of Object.entries(beforeDigests[key])) assert.equal(afterDigests[key][id], h, `${key}/${id}`);
    assert.equal(after[key].size, count + (key === 'plans' ? 1 : key === 'designHistory' ? 2 : 0));
  }
  assert.equal(after.constraintRevision, constraintRevision + 1);
  assert.equal(after.activePlanId, activePlanId); assert.equal(after.plans.get(activePlanId).revision, 10);
  const plan = after.plans.get(saved.plan.id); assert.ok(plan);
  assert.equal(plan.revision, 77); assert.equal(plan.status, 'proposed');
  assert.deepEqual(plan.plan, candidate.plan);
  assert.deepEqual(after.worldPack, clean({...candidate.worldPack, revision: 41, status: 'proposed', lockedAt: undefined}));
  assert.deepEqual(after.storyBible, clean({...candidate.storyBible, revision: 73, status: 'proposed', lockedAt: undefined,
    worldPackId: after.worldPack.id, worldPackRevision: 41}));
  assert.equal(plan.worldPackRevision, 41); assert.equal(plan.storyBibleRevision, 73);
  const overview = designReviewOverview(after, plan.id);
  assert.equal(overview.ready, false); assert.ok(overview.areas.every(a => a.status !== 'passed'));
  assert.equal(saved.contentReview.ready, false);
  assert.equal(qualityAuditFor(after).questions.filter(q => q.blocking && q.status !== 'resolved').length, 41);
  assert.equal(plan.plan.chapters.length, 50); assert.equal(plan.plan.targetChapterCount, 100);
  const newHash = designReviewHash(after, plan.id); assert.notEqual(newHash, prepared.expectedInputHash);
  const input = designReviewInput(after, 'characters', plan.id);
  assert.equal(input.inputHash, newHash);
  for (const [id, document] of [
    ['story/characters/char_19', candidate.storyBible.characters.find(c => c.id === 'char_19')],
    ['story/relationships/rel_17', candidate.storyBible.relationships.find(c => c.id === 'rel_17')],
    ['plan/chapters/33', candidate.plan.chapters.find(c => c.chapterNumber === 33)],
  ]) assert.deepEqual(JSON.parse(input.sources.find(s => s.id === id).text), document);
  result = {kind: 'design76_v4_private_save_restart_rehearsal', verified: true, verifiedAt: new Date().toISOString(),
    runnerSha256: fileHash(process.argv[1]), runtimeBindingPath: bindingPath, runtimeBindingSha256: fileHash(bindingPath),
    candidatePath: prepared.candidatePath, candidateSha256: hash(candidate), candidateProofPath, candidateProofSha256: fileHash(candidateProofPath),
    reviewPath, reviewSha256: fileHash(reviewPath), clarificationPath, clarificationSha256: fileHash(clarificationPath),
    sourceVerificationPath: verificationPath, sourceVerificationSha256: fileHash(verificationPath), sourceSnapshot, snapshotSha256,
    privateDatabase: database, sourceInputHash: prepared.expectedInputHash, privateInputHash: newHash, privatePlanId: plan.id,
    privateRevisions: {world: 41, storyBible: 73, plan: 77, approvedPlan: 10},
    beforeMapCounts: counts, beforeRecordHashes: Object.fromEntries(Object.keys(counts).map(k => [k, beforeDigests[k]])),
    allExistingRecordsPreserved: true, staleRetryRejected: true, restartReadback: true, oldReviewsCannotApproveCandidate: true,
    blockersRetained: 41, blockersClosed: 0, detailedChapters: 50, targetChapters: 100,
    privateDesignSaves: 1, productionWrites: 0, modelCalls: 0, formalAcceptance: false,
    limitation: 'Persistence rehearsal in a private copy only, not a new production revision or content acceptance. Full formal review, final candidate reconciliation and current-baseline validation remain required before any production save.',
  };
} finally { await repository.disconnect(); await prisma.$disconnect(); }
assert.equal(fileHash(sourceSnapshot), snapshotSha256);
fs.writeFileSync(proofPath, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({verified: true, proofPath, privateRevisions: result.privateRevisions,
  oldRunsRetained: counts.designReviewRuns, oldReportsRetained: counts.designContentReviews,
  staleRetryRejected: true, productionWrites: 0, formalAcceptance: false}));
