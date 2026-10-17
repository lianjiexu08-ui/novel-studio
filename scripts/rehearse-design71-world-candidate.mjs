// Save only into an isolated SQLite copy. No production mutation or model call.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaWorkRepository } from '../packages/persistence/src/prisma-repository.ts';
import { ChapterWorkflow } from '../packages/application/src/index.ts';
import { validateDesignCandidate } from '../packages/application/src/design-candidate.ts';
import { designReviewHash, designReviewOverview, designReviewInput } from '../novel-service-core/src/design-review.ts';
import { qualityAuditFor } from '../novel-service-core/src/core.ts';

const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const fileHash = file => sha(fs.readFileSync(file));
const clean = value => JSON.parse(JSON.stringify(value));
const proofPath = 'docs/audits/2026-10-17-design71-world-save-rehearsal.json';
const candidateProofPath = 'docs/audits/2026-10-17-design71-world-candidate.json';
const prepared = read(candidateProofPath), baseline = read('data/audit-runtimes/design71-review/baseline.json');
assert.equal(fileHash(prepared.candidatePath), prepared.candidateSha256);
assert.equal(prepared.expectedInputHash, baseline.inputHash);
const candidate = read(prepared.candidatePath), validation = validateDesignCandidate(candidate);
assert.equal(validation.valid, true); assert.equal(validation.blockers.length, 41);
const directory = path.resolve('data/audit-runtimes/design71-world-save-rehearsal');
assert.ok(!fs.existsSync(directory) && !fs.existsSync(proofPath), 'Preserve the existing rehearsal');
fs.mkdirSync(directory);
const originalDatabase = path.resolve('data/novel-studio.db');
const snapshotPath = path.join(directory, 'before.db');
const isolatedPath = path.join(directory, 'isolated.db');
// Read-only source connection; SQLite's backup produces a consistent snapshot
// while the live worker keeps committing its separate review progress.
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
assert.notEqual(fs.realpathSync(isolatedPath), fs.realpathSync(originalDatabase));
const open = () => new PrismaWorkRepository(new PrismaClient({ datasources: { db: { url: `file:${isolatedPath}` } } }));
const maps = ['plans', 'designHistory', 'versions', 'events', 'manuscripts', 'candidates', 'designReviewRuns', 'designContentReviews'];
const serialize = work => Object.fromEntries(Object.entries(work).map(([key, value]) => [key, value instanceof Map ? [...value] : value]));
const mutable = new Set(['worldPack', 'storyBible', 'plans', 'designHistory', 'constraintRevision']);
const protectedHash = work => hash(Object.fromEntries(Object.entries(serialize(work)).filter(([key]) => !mutable.has(key))));
const baseContent = work => ({ world: work.worldPack, bible: work.storyBible, plans: [...work.plans], activePlanId: work.activePlanId,
  designHistory: [...work.designHistory], versions: [...work.versions], events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] });
let before, saved;
const repo = open();
try {
  before = await repo.get(prepared.workId); assert.ok(before);
  assert.equal(designReviewHash(before, prepared.basePlanId), prepared.expectedInputHash);
  assert.equal(hash(baseContent(before)), baseline.protectedHash);
  const workflow = new ChapterWorkflow(repo, { generateChapter() { throw new Error('No prose generation in rehearsal'); } });
  saved = await workflow.saveDesignCandidate(prepared.workId, { basePlanId: prepared.basePlanId,
    expectedInputHash: prepared.expectedInputHash, candidate,
    note: '仅数据库副本演练：货索宏观描述与第32章对齐，新增港内获救待核规则与七人交接；尚未通过内容评审，不批准写作。' });
} finally { await repo.disconnect(); }

const restarted = open();
let after;
try { after = await restarted.get(prepared.workId); } finally { await restarted.disconnect(); }
assert.ok(after);
assert.equal(protectedHash(after), protectedHash(before));
for (const key of maps) {
  for (const [id, value] of before[key]) assert.equal(hash(after[key].get(id)), hash(value), `${key}/${id}`);
  assert.equal(after[key].size, before[key].size + (key === 'plans' ? 1 : key === 'designHistory' ? 2 : 0), key);
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
assert.equal(designReviewOverview(after, plan.id).ready, false);
assert.ok(designReviewOverview(after, plan.id).areas.every(a => a.status !== 'passed'));
assert.equal(qualityAuditFor(after).questions.filter(q => q.blocking && q.status !== 'resolved').length, 41);
assert.equal(plan.plan.chapters.flatMap(c => c.executionChecks ?? []).length, 41);
assert.equal(plan.plan.chapters.length, 50); assert.equal(plan.plan.targetChapterCount, 100);
const inputHash = designReviewHash(after, plan.id);
assert.notEqual(inputHash, prepared.expectedInputHash);
// Preserve the canonical full candidate input for a later, bounded content review.
const worldInputPath = path.join(directory, 'full-world-input.json');
const full = designReviewInput(after, 'world', plan.id);
assert.equal(full.inputHash, inputHash);
for (const [id, value] of [
  ['world/locations/loc_02', after.worldPack.locations.find(l => l.id === 'loc_02')],
  ['world/locations/loc_25', after.worldPack.locations.find(l => l.id === 'loc_25')],
  ['plan/milestones/ms_growth_v1_crossing', plan.plan.milestones.find(m => m.id === 'ms_growth_v1_crossing')],
  ['plan/milestones/ms_v2_boundary', plan.plan.milestones.find(m => m.id === 'ms_v2_boundary')],
]) assert.deepEqual(JSON.parse(full.sources.find(s => s.id === id).text), value, id);
fs.writeFileSync(worldInputPath, JSON.stringify(full, null, 2) + '\n', { flag: 'wx' });
assert.equal(fileHash(snapshotPath), snapshotSha256);
const tracked = execFileSync('git', ['ls-files', 'packages', 'novel-service-core'], { encoding: 'utf8' }).trim().split('\n');
const proof = { verifiedAt: new Date().toISOString(), candidateProofPath, candidateProofSha256: fileHash(candidateProofPath),
  candidatePath: prepared.candidatePath, candidateSha256: prepared.candidateSha256,
  sourceSnapshot: snapshotPath, sourceSnapshotSha256: snapshotSha256, databasePath: isolatedPath,
  sourceHashes: Object.fromEntries(tracked.filter(p => p.endsWith('.ts')).map(p => [p, fileHash(p)])),
  isolatedPlanId: plan.id, isolatedInputHash: inputHash, worldInputPath, worldInputSha256: fileHash(worldInputPath),
  revisions: { world: 37, bible: 69, plan: 72, approved: 10 },
  retainedMapCounts: Object.fromEntries(maps.map(key => [key, before[key].size])), allExistingRecordsPreservedExactly: true,
  preservedFieldsSha256: protectedHash(after), oldReportsCannotApproveCandidate: true,
  sourceConnection: 'read_only_sqlite_backup', isolatedDesignSaves: 1, productionWrites: 0, modelCalls: 0, formalAcceptance: false,
  limitation: 'Storage and restart rehearsal only, safe on a separate consistent copy while the worker runs. This changes no production design or review. Local model review, full finding reconciliation and any production application remain pending.' };
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ isolatedRevisions: proof.revisions, retained: proof.retainedMapCounts,
  oldReportsCannotApproveCandidate: true, modelCalls: 0, productionWrites: 0, formalAcceptance: false }));
