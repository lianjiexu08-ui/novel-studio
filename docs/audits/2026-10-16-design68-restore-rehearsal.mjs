// Rehearse on an SQLite backup, then optionally save the exact candidate through
// the API. Never update/delete old plans, reports, chapters, events or exports.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = process.cwd(), workId = 'work_8b6c9133e13d404083ca33acc63f4f61';
const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const candidatePath = 'data/design-candidates/design64-motivation-wording-draft-v11.json';
assert.equal(fileHash(candidatePath), 'ec7d90cb870f6d35f9cfc9d1c95cc21169f97bf856940f8ef8bf2a70273c19be');
const candidate = read(candidatePath);
assert.equal(candidate.plan.chapters.length, 50);
const binding = read('data/audit-runtimes/design64-runtime-bound.json');
for (const [name, value] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(path.join(binding.root, name)), value);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'novel68-restore-'));
const backup = name => {
  const destination = path.join(directory, name);
  execFileSync('python3', ['-c', 'import sqlite3,sys\ns=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)\nd=sqlite3.connect(sys.argv[2])\ns.backup(d)\nd.close()\ns.close()', path.join(root, 'data/novel-studio.db'), destination]);
  return destination;
};
const snapshot = backup('before.db');
process.env.DATABASE_URL = 'file:' + snapshot;
const { PrismaWorkRepository } = await import(binding.root + '/packages/persistence/src/prisma-repository.ts');
const { ChapterWorkflow } = await import(binding.root + '/packages/application/src/index.ts');
const { designReviewHash } = await import(binding.root + '/novel-service-core/src/design-review.ts');
const { qualityAuditFor } = await import(binding.root + '/novel-service-core/src/core.ts');
const protectedRecords = w => ({ activePlanId: w.activePlanId, plans: [...w.plans], designHistory: [...w.designHistory],
  versions: [...w.versions], events: [...w.events], manuscripts: [...w.manuscripts], candidates: [...w.candidates],
  runs: [...w.designReviewRuns], reports: [...w.designContentReviews] });
const verify = (before, after, saved) => {
  const actual = protectedRecords(after), original = protectedRecords(before);
  actual.plans = actual.plans.filter(([id]) => id !== saved.plan.id);
  const oldDesignIds = new Set(before.designHistory.keys());
  actual.designHistory = actual.designHistory.filter(([id]) => oldDesignIds.has(id));
  assert.deepEqual(actual, original, 'Every pre-existing record must survive unchanged');
  assert.equal(after.plans.size, before.plans.size + 1);
  assert.equal(after.designHistory.size, before.designHistory.size + 2);
  assert.deepEqual(after.plans.get(saved.plan.id).plan, candidate.plan);
  assert.equal(after.worldPack.revision, 34);
  assert.equal(after.storyBible.revision, 65);
  assert.equal(after.storyBible.worldPackRevision, 34);
  assert.equal(saved.plan.revision, 68);
  assert.equal(saved.plan.status, 'proposed');
  assert.equal(saved.contentReview.ready, false);
  assert.equal(qualityAuditFor(after).questions.filter(q => q.blocking && q.status !== 'resolved').length, 41);
  return { protectedBeforeSha256: hash(original), protectedAfterSha256: hash(actual), historyUnchanged: true,
    preservedPlans: before.plans.size, preservedChapterVersions: before.versions.size, preservedEvents: before.events.size,
    preservedManuscripts: before.manuscripts.size, approvedPlanRevision: after.plans.get(after.activePlanId).revision,
    worldRevision: 34, bibleRevision: 65, planRevision: 68, outlineCount: 50, macroChapterTarget: 100, blockers: 41,
    executionChecks: candidate.plan.chapters.flatMap(c => c.executionChecks ?? []).length,
    formalAcceptance: false, proseGenerated: false };
};
const api = 'http://127.0.0.1:8787/works/' + workId + '/design/candidate';
const baselineResponse = await fetch(api);
assert.ok(baselineResponse.ok);
const baseline = await baselineResponse.json();
assert.equal(baseline.basePlanId, 'plan_c1191975881b4503bfc67eabbbfec949');
const repository = new PrismaWorkRepository();
let before, rehearsal;
const request = { basePlanId: baseline.basePlanId, expectedInputHash: baseline.expectedInputHash, candidate,
  note: '先核验基础再扩展：Plan65—67扩写及局部修订存在未解决的时间、许可、知情和账目矛盾，完整保留历史但不沿用其51—90章。恢复前50章细纲与100章三卷宏观规划，合入v11验收关联、预算、成本与动机澄清。保留41条阻塞，必须重新评审，不审批、不生成正文。' };
try {
  before = structuredClone(await repository.get(workId));
  assert.equal(designReviewHash(before, baseline.basePlanId), baseline.expectedInputHash);
  assert.equal(before.plans.size, 67);
  assert.equal(before.designReviewRuns.size > 0, true);
  const workflow = new ChapterWorkflow(repository, { generateChapter() { throw new Error('No prose'); } });
  rehearsal = await workflow.saveDesignCandidate(workId, request);
} finally { await repository.disconnect(); }
const restarted = new PrismaWorkRepository();
let rehearsalProof;
try { rehearsalProof = verify(before, await restarted.get(workId), rehearsal); } finally { await restarted.disconnect(); }
const proof = { kind: 'restore_quality_first_design', observedAt: new Date().toISOString(), candidatePath,
  candidateSha256: fileHash(candidatePath), sourcePlanId: baseline.basePlanId, sourceInputHash: baseline.expectedInputHash,
  snapshot, frozenRuntimeCommit: binding.commit, rehearsal: rehearsalProof, modelCalls: 0, productionWrites: 0 };
fs.writeFileSync('docs/audits/2026-10-16-design68-restore-rehearsal.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
if (process.argv.includes('--apply')) {
  const response = await fetch(api, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  const saved = await response.json();
  assert.equal(response.status, 201, JSON.stringify(saved).slice(0, 500));
  const liveSnapshot = backup('after.db');
  process.env.DATABASE_URL = 'file:' + liveSnapshot;
  const readback = new PrismaWorkRepository();
  let liveProof;
  try { liveProof = verify(before, await readback.get(workId), saved); } finally { await readback.disconnect(); }
  const applied = { ...proof, kind: 'quality_first_design_applied', productionWrites: 1, appliedPlanId: saved.plan.id,
    inputHash: saved.contentReview.inputHash, readback: liveProof, liveSnapshot, appliedAt: new Date().toISOString() };
  fs.writeFileSync('docs/audits/2026-10-16-design68-applied.json', JSON.stringify(applied, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(applied));
} else console.log(JSON.stringify(proof));
