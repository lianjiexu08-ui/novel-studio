// Independent read through the frozen repository. No save/transaction/model API.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = process.cwd();
const read = file => JSON.parse(fs.readFileSync(file));
const bytesHash = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => bytesHash(JSON.stringify(value));
const control = 'data/audit-runtimes/design68-review';
const bindingPath = 'data/audit-runtimes/design68-runtime-bound.json';
const binding = read(bindingPath);
const baseline = read(`${control}/baseline.json`);
assert.equal(process.env.DATABASE_URL, `file:${path.join(root, 'data/novel-studio.db')}`);
assert.equal(bytesHash(fs.readFileSync(bindingPath)), baseline.runtimeBindingSha256);
for (const [name, expected] of Object.entries(binding.sourceHashes)) {
  assert.equal(bytesHash(fs.readFileSync(path.join(binding.runtimePath, name))), expected, name);
}
const before = read(`${control}/result.json`);
process.kill(before.pid, 0);
const startedAt = new Date().toISOString();
const { PrismaWorkRepository } = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const { designReviewHash } = await import(`${binding.runtimePath}/novel-service-core/src/design-review.ts`);
const repository = new PrismaWorkRepository();
try {
  const work = await repository.get(baseline.workId);
  assert.ok(work);
  const protectedHash = hash({ world: work.worldPack, bible: work.storyBible, plans: [...work.plans], activePlanId: work.activePlanId,
    versions: [...work.versions], events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] });
  assert.equal(protectedHash, baseline.protectedHash);
  assert.equal(designReviewHash(work, baseline.planId), baseline.inputHash);
  for (const [id, expected] of baseline.oldRuns) assert.equal(hash(work.designReviewRuns.get(id)), expected, id);
  for (const [id, expected] of baseline.oldReports) assert.equal(hash(work.designContentReviews.get(id)), expected, id);
  assert.equal(work.versions.size, 101);
  assert.equal(work.events.size, 383);
  assert.equal(work.manuscripts.size, 1);
  assert.equal(work.worldPack.revision, 34);
  assert.equal(work.storyBible.revision, 65);
  assert.equal(work.plans.get(baseline.planId).revision, 68);
  assert.equal(work.plans.get(baseline.planId).plan.chapters.length, 50);
  assert.equal(work.plans.get(work.activePlanId).revision, 10);
  const after = read(`${control}/result.json`);
  process.kill(after.pid, 0);
  assert.equal(after.pid, before.pid);
  const proof = {
    kind: 'design68_independent_live_repository_history_read', startedAt, completedAt: new Date().toISOString(),
    workId: work.id, planId: baseline.planId, inputHash: baseline.inputHash,
    protectedHash, equalsPreparedBaseline: true,
    baselineSha256: bytesHash(fs.readFileSync(`${control}/baseline.json`)),
    frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
    counts: { chapterVersions: work.versions.size, events: work.events.size, manuscripts: work.manuscripts.size,
      candidates: work.candidates.size, plans: work.plans.size, retainedOldReviewRuns: baseline.oldRuns.length, retainedOldReports: baseline.oldReports.length },
    revisions: { world: 34, bible: 65, proposalPlan: 68, approvedPlan: 10, detailedOutlines: 50 },
    worker: { pid: after.pid, liveBeforeAndAfterRead: true, segment: after.segment, beforeCalls: before.totalCalls, afterCalls: after.totalCalls },
    method: 'A separate process loaded the current production aggregate with the frozen PrismaWorkRepository.get, recomputed the same protected-content hash as preparation, and compared every baseline old review run/report hash. No reliance on worker protectedHistoryUnchanged.',
    productionWrites: 0, modelCalls: 0, formalAcceptance: false,
    limitation: 'The repository performs several reads rather than a single atomic database snapshot. Protected content and old reviews match their preparation baseline; new in-flight review records are intentionally not compared for checkpoint equality. This does not prove content quality, future preservation, or the completeness of the final manuscript.',
  };
  fs.writeFileSync('docs/audits/2026-10-16-design68-live-history.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ protectedHash, counts: proof.counts, worker: proof.worker, productionWrites: 0, modelCalls: 0 }));
} finally {
  await repository.disconnect();
}
