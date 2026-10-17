// Exercise the actual save/restart path on a consistent SQLite copy only.
// The live review, original candidates and production database remain unchanged.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { 'runtime-root': { type: 'string' } }, strict: true });
assert.ok(values['runtime-root'], 'Use an independent source/dependency mirror with its own generated Prisma client');
const root = fs.realpathSync('.'), runtimeRoot = fs.realpathSync(values['runtime-root']);
assert.notEqual(runtimeRoot, root);
assert.notEqual(fs.realpathSync(path.join(runtimeRoot, 'node_modules')), fs.realpathSync('node_modules'));
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const fileHash = file => sha(fs.readFileSync(file));
const clean = value => JSON.parse(JSON.stringify(value));
const outputPath = 'docs/audits/2026-10-17-design71-combined-save-rehearsal.json';
assert.ok(!fs.existsSync(outputPath), 'Preserve the existing rehearsal evidence');
const sourceFiles = execFileSync('git', ['ls-files', 'packages', 'novel-service-core'], { encoding: 'utf8' })
  .trim().split('\n').filter(file => /\.(ts|json|prisma)$/.test(file));
const sourceHashes = Object.fromEntries(sourceFiles.map(file => {
  const expected = fileHash(file);
  assert.equal(fileHash(path.join(runtimeRoot, file)), expected, `Mirror differs: ${file}`);
  return [file, expected];
}));
const load = file => import(pathToFileURL(path.join(runtimeRoot, file)).href);
const { PrismaClient } = createRequire(path.join(runtimeRoot, 'package.json'))('@prisma/client');
const { PrismaWorkRepository } = await load('packages/persistence/src/prisma-repository.ts');
const { ChapterWorkflow } = await load('packages/application/src/index.ts');
const { validateDesignCandidate } = await load('packages/application/src/design-candidate.ts');
const { designReviewHash, designReviewOverview, designReviewInput } = await load('novel-service-core/src/design-review.ts');
const { qualityAuditFor } = await load('novel-service-core/src/core.ts');
const worldProofPath = 'docs/audits/2026-10-17-design71-world-candidate.json';
const fireProofPath = 'docs/audits/2026-10-17-design71-fire-control-candidate.json';
const worldProof = read(worldProofPath), fireProof = read(fireProofPath);
const baseline = read('data/audit-runtimes/design71-review/baseline.json');
const inputsPath = 'data/audit-runtimes/design71-review/inputs.json';
assert.equal(fileHash(inputsPath), baseline.inputsSha256);
for (const prepared of [worldProof, fireProof]) {
  assert.equal(prepared.expectedInputHash, baseline.inputHash);
  assert.equal(fileHash(prepared.candidatePath), prepared.candidateSha256);
}
const candidate = read(worldProof.candidatePath), fire = read(fireProof.candidatePath);
assert.equal(fire.basedOnInputHash, baseline.inputHash);
assert.equal(fire.applied, false);
assert.equal(fire.modelReviewed, false);
assert.equal(fire.changes.length, 2);
assert.deepEqual(fire.changes.map(c => c.sourceId).sort(), ['world/resources/res_12', 'world/techniques/tech_07']);
for (const change of fire.changes) {
  const [, collection, id] = change.sourceId.split('/');
  const index = candidate.worldPack[collection].findIndex(item => item.id === id);
  assert.ok(index >= 0);
  assert.deepEqual(candidate.worldPack[collection][index], change.before, `Overlapping candidate edits: ${change.sourceId}`);
  candidate.worldPack[collection][index] = structuredClone(change.after);
}
const validation = validateDesignCandidate(candidate);
assert.equal(validation.valid, true, JSON.stringify(validation.issues));
assert.equal(validation.blockers.length, 41);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-design71-combined-rehearsal-'));
const candidatePath = path.join(directory, 'combined-candidate.json');
fs.writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });
const originalDatabase = fs.realpathSync('data/novel-studio.db');
const snapshotPath = path.join(directory, 'before.db'), isolatedPath = path.join(directory, 'isolated.db');
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
`, originalDatabase, snapshotPath], { timeout: 120000 });
const snapshotSha256 = fileHash(snapshotPath);
fs.copyFileSync(snapshotPath, isolatedPath, fs.constants.COPYFILE_EXCL);
assert.notEqual(fs.realpathSync(isolatedPath), originalDatabase);
// Only the copy receives the annotation column required by the current adapter.
const migrationOutput = execFileSync('python3', ['scripts/migrate-review-annotations.py', isolatedPath], { encoding: 'utf8', timeout: 120000 });
const open = () => new PrismaWorkRepository(new PrismaClient({ datasources: { db: { url: `file:${isolatedPath}` } } }));
const mapHashes = map => Object.fromEntries([...map].map(([key, value]) => [key, hash(value)]));
const workHashes = work => Object.fromEntries(Object.entries(work).map(([key, value]) => [key,
  value instanceof Map ? mapHashes(value) : hash(value)]));
const baseContent = work => ({ world: work.worldPack, bible: work.storyBible, plans: [...work.plans], activePlanId: work.activePlanId,
  designHistory: [...work.designHistory], versions: [...work.versions], events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] });
const mutable = new Set(['worldPack', 'storyBible', 'plans', 'designHistory', 'constraintRevision']);
let before, saved, currentBaseHash;
const repository = open();
try {
  before = await repository.get(baseline.workId); assert.ok(before);
  // The review scheduler changed after the frozen worker began. Verify the
  // complete design/history baseline separately; use the current hash for save.
  assert.equal(hash(baseContent(before)), baseline.protectedHash);
  currentBaseHash = designReviewHash(before, baseline.planId);
  const workflow = new ChapterWorkflow(repository, { generateChapter() { throw new Error('No prose in rehearsal'); } });
  saved = await workflow.saveDesignCandidate(baseline.workId, { basePlanId: baseline.planId,
    expectedInputHash: currentBaseHash, candidate,
    note: '隔离副本演练：合并世界澄清与控火规则候选；未通过内容复审，不批准写作。' });
  await assert.rejects(workflow.saveDesignCandidate(baseline.workId, {
    basePlanId: baseline.planId, expectedInputHash: currentBaseHash, candidate,
  }), /整体修订基线/, 'A stale retry must not create a second revision');
} finally { await repository.disconnect(); }
const restarted = open();
let after;
try { after = await restarted.get(baseline.workId); } finally { await restarted.disconnect(); }
assert.ok(after);
const beforeHashes = workHashes(before), afterHashes = workHashes(after);
for (const key of Object.keys(beforeHashes)) if (!mutable.has(key)) assert.deepEqual(afterHashes[key], beforeHashes[key], `Protected field: ${key}`);
assert.deepEqual(Object.keys(afterHashes).sort(), Object.keys(beforeHashes).sort());
const maps = ['plans', 'designHistory', 'versions', 'events', 'manuscripts', 'candidates', 'designReviewRuns', 'designContentReviews', 'designReviewAnnotations'];
for (const key of maps) {
  for (const [id, expected] of Object.entries(beforeHashes[key])) assert.equal(afterHashes[key][id], expected, `${key}/${id}`);
  assert.equal(after[key].size, before[key].size + (key === 'plans' ? 1 : key === 'designHistory' ? 2 : 0));
}
assert.equal(after.constraintRevision, before.constraintRevision + 1);
const plan = after.plans.get(saved.plan.id); assert.ok(plan);
assert.equal(plan.revision, 72); assert.equal(plan.status, 'proposed');
assert.deepEqual(plan.plan, candidate.plan);
assert.equal(plan.worldPackRevision, 37); assert.equal(plan.storyBibleRevision, 69);
assert.deepEqual(after.worldPack, clean({ ...candidate.worldPack, revision: 37, status: 'proposed', lockedAt: undefined }));
assert.deepEqual(after.storyBible, clean({ ...candidate.storyBible, revision: 69, status: 'proposed', lockedAt: undefined,
  worldPackId: after.worldPack.id, worldPackRevision: 37 }));
assert.equal(after.plans.get(after.activePlanId).revision, 10);
const overview = designReviewOverview(after, plan.id);
assert.equal(overview.ready, false);
assert.ok(overview.areas.every(area => area.status !== 'passed'));
assert.equal(qualityAuditFor(after).questions.filter(q => q.blocking && q.status !== 'resolved').length, 41);
assert.equal(plan.plan.chapters.flatMap(chapter => chapter.executionChecks ?? []).length, 41);
assert.equal(plan.plan.chapters.length, 50); assert.equal(plan.plan.targetChapterCount, 100);
const inputHash = designReviewHash(after, plan.id);
assert.notEqual(inputHash, currentBaseHash); assert.notEqual(inputHash, baseline.inputHash);
const canonicalInput = designReviewInput(after, 'power', plan.id);
assert.equal(canonicalInput.inputHash, inputHash);
for (const change of fire.changes) assert.deepEqual(JSON.parse(canonicalInput.sources.find(s => s.id === change.sourceId).text), change.after);
assert.equal(fileHash(snapshotPath), snapshotSha256);
for (const [file, expected] of Object.entries(sourceHashes)) assert.equal(fileHash(file), expected, `Source changed during rehearsal: ${file}`);
const proof = { verifiedAt: new Date().toISOString(), runtimeRoot, sourceHashes,
  originalReviewInputHash: baseline.inputHash, currentBaseHash, isolatedInputHash: inputHash,
  candidateInputs: [worldProof, fireProof].map(p => ({ path: p.candidatePath, sha256: p.candidateSha256 })),
  candidateProofs: [worldProofPath, fireProofPath].map(file => ({ path: file, sha256: fileHash(file) })),
  candidatePath, candidateSha256: fileHash(candidatePath), sourceSnapshot: snapshotPath, sourceSnapshotSha256: snapshotSha256,
  databasePath: isolatedPath, isolatedPlanId: plan.id, migrationOutput,
  revisions: { world: 37, bible: 69, plan: 72, approved: 10 },
  retainedMapCounts: Object.fromEntries(maps.map(key => [key, before[key].size])),
  beforeRecordHashes: Object.fromEntries(maps.map(key => [key, beforeHashes[key]])),
  allExistingRecordsPreservedExactly: true, staleRetryRejected: true, oldReportsCannotApproveCandidate: true,
  blockersRetained: 41, executionChecksRetained: 41, restartVerified: true,
  sourceConnection: 'read_only_sqlite_backup', isolatedDesignSaves: 1, productionWrites: 0, modelCalls: 0, formalAcceptance: false,
  limitation: 'Combined merge, save, stale-retry and restart rehearsal only. Local candidate reviews, full review reconciliation and production application remain pending. A future application must recalculate its current base hash and repeat checks against the final production state.' };
fs.writeFileSync(outputPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ outputPath, isolatedRevisions: proof.revisions, retained: proof.retainedMapCounts,
  staleRetryRejected: true, oldReportsCannotApproveCandidate: true, productionWrites: 0, modelCalls: 0, formalAcceptance: false }));
