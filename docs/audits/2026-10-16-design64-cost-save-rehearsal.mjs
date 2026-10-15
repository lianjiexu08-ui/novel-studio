import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const root = process.cwd(), baseline = read('data/audit-runtimes/design64-control/baseline.json');
const binding = read('data/audit-runtimes/design64-runtime-bound.json');
const repair = read('docs/audits/2026-10-16-design64-cost-wording.json');
const input = read('data/audit-runtimes/design64-control/cost-rehearsal-inputs.json');
assert.notEqual(fs.realpathSync(input.databaseSnapshot), fs.realpathSync(root + '/data/novel-studio.db'));
assert.notEqual(fs.statSync(input.databaseSnapshot).ino, fs.statSync(root + '/data/novel-studio.db').ino);
assert.equal(fileHash(repair.candidatePath), repair.candidateSha256);
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(binding.root + '/' + p), h);
process.env.DATABASE_URL = 'file:' + input.databaseSnapshot;
const { PrismaWorkRepository } = await import(root + '/packages/persistence/src/prisma-repository.ts');
const { ChapterWorkflow } = await import(root + '/packages/application/src/index.ts');
const { qualityAuditFor } = await import(root + '/novel-service-core/src/core.ts');
const { designReviewHash } = await import(root + '/novel-service-core/src/design-review.ts');
const candidate = read(repair.candidatePath), repo = new PrismaWorkRepository();
const protectedRecords = w => ({ activePlanId: w.activePlanId, plans: [...w.plans], designHistory: [...w.designHistory],
  versions: [...w.versions], events: [...w.events], manuscripts: [...w.manuscripts], candidates: [...w.candidates],
  runs: [...w.designReviewRuns], reports: [...w.designContentReviews] });
let before, saved, after;
try {
  const work = await repo.get(baseline.workId);
  assert.equal(designReviewHash(work, baseline.planId), baseline.inputHash);
  before = structuredClone(protectedRecords(work));
  const workflow = new ChapterWorkflow(repo, { generateChapter() { throw new Error('No prose in rehearsal'); } });
  saved = await workflow.saveDesignCandidate(work.id, { basePlanId: baseline.planId, expectedInputHash: baseline.inputHash,
    candidate, note: '隔离演练：三处比例语序澄清，保留40项验收要求和41条阻塞' });
} finally { await repo.disconnect(); }
const restarted = new PrismaWorkRepository();
try { after = await restarted.get(baseline.workId); } finally { await restarted.disconnect(); }
const restored = after.plans.get(saved.plan.id);
const archive = protectedRecords(after);
archive.plans = archive.plans.filter(([id]) => id !== restored.id);
const priorIds = new Set(before.designHistory.map(([id]) => id));
archive.designHistory = archive.designHistory.filter(([id]) => priorIds.has(id));
assert.deepEqual(archive, before, 'All existing histories, reports, failures, chapters and manuscript must survive');
assert.equal(after.designHistory.size, before.designHistory.length + 2);
assert.equal(after.plans.size, before.plans.length + 1);
assert.equal(after.worldPack.revision, 34); assert.equal(after.storyBible.revision, 65);
assert.equal(after.storyBible.worldPackRevision, 34); assert.equal(restored.revision, 65);
assert.equal(restored.worldPackRevision, 34); assert.equal(restored.storyBibleRevision, 65);
assert.equal(restored.status, 'proposed'); assert.equal(after.worldPack.status, 'proposed'); assert.equal(after.storyBible.status, 'proposed');
assert.deepEqual(restored.plan, candidate.plan);
for (const change of repair.changes) {
  const value = change.path.reduce((v, key) => v[key], { worldPack: after.worldPack });
  assert.equal(value, change.proposedField);
}
assert.notEqual(designReviewHash(after, restored.id), baseline.inputHash, 'Old review must not certify new design');
assert.equal(saved.contentReview.ready, false);
const audit = qualityAuditFor(after);
assert.equal(audit.questions.filter(q => q.blocking && q.status !== 'resolved').length, 41);
const links = audit.questions.flatMap(q => q.executionChecks).filter(c => c.planId === restored.id);
assert.equal(links.length, candidate.plan.chapters.flatMap(c => c.executionChecks ?? []).filter(c => c.sourceQuestion).length);
assert.ok(links.every(c => c.executionEvidence.status !== 'verified'));
const proof = { kind: 'isolated_cost_wording_save_rehearsal', observedAt: new Date().toISOString(),
  candidatePath: repair.candidatePath, candidateSha256: repair.candidateSha256, databaseSnapshot: input.databaseSnapshot,
  inputHash: baseline.inputHash, sourcePlanId: baseline.planId,
  rootCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), frozenRuntimeCommit: binding.commit,
  sourceFilesVerified: Object.keys(binding.sourceHashes).length, verifierSha256: fileHash(process.argv[1]),
  protectedBeforeSha256: hash(before), protectedAfterSha256: hash(archive), oldHistoryUnchanged: true,
  worldRevision: 34, bibleRevision: 65, planRevision: 65, newPlanStatus: restored.status,
  approvedPlanRevision: after.plans.get(after.activePlanId).revision, oldReviewsCannotApproveNewDesign: true,
  blockers: 41, totalExecutionChecks: 40, linkedRequirements: links.length, oldProseCannotCertifyNewRequirements: true,
  productionWrites: 0, modelCalls: 0, applied: false, formalAcceptance: false, proseGenerated: false };
fs.writeFileSync('docs/audits/2026-10-16-design64-cost-save-rehearsal.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(proof));
