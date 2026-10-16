// Independent transactional read after the complete four-area review.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const read = path => JSON.parse(fs.readFileSync(path));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const root = 'data/audit-runtimes/design68-review';
const checkpointBytes = fs.readFileSync(`${root}/result.json`);
const checkpoint = JSON.parse(checkpointBytes);
assert.equal(checkpoint.status, 'completed', 'Wait for the existing worker to finish all four areas');
assert.equal(checkpoint.runs.length, 4);
assert.ok(checkpoint.runs.every(run => run.status === 'completed'));
const baseline = read(`${root}/baseline.json`);
const bindingPath = 'data/audit-runtimes/design68-runtime-bound.json';
const binding = read(bindingPath);
assert.equal(sha(fs.readFileSync(bindingPath)), baseline.runtimeBindingSha256);
for (const [name, expected] of Object.entries(binding.sourceHashes))
  assert.equal(sha(fs.readFileSync(path.join(binding.runtimePath, name))), expected, name);
assert.equal(process.env.DATABASE_URL, `file:${path.join(process.cwd(), 'data/novel-studio.db')}`);
const { PrismaWorkRepository } = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const { designReviewHash } = await import(`${binding.runtimePath}/novel-service-core/src/design-review.ts`);
const referencePath = read('docs/audits/2026-10-16-design68-applied.json').liveSnapshot;
assert.ok(fs.existsSync(referencePath));
assert.notEqual(fs.realpathSync(referencePath), fs.realpathSync('data/novel-studio.db'));
const prisma = new PrismaClient();
const reference = new PrismaClient({ datasources: { db: { url: `file:${referencePath}` } } });
try {
  const select = { designHistory: true, covenantHistory: true };
  const oldHistory = await reference.project.findFirst({ where: { id: baseline.workId }, select });
  assert.ok(oldHistory);
  const startedAt = new Date().toISOString();
  const { work, histories } = await prisma.$transaction(async tx => ({
    work: await new PrismaWorkRepository(tx).get(baseline.workId),
    histories: await tx.project.findFirst({ where: { id: baseline.workId }, select }),
  }), { timeout: 30_000 });
  assert.ok(work);
  assert.deepEqual(histories, oldHistory, 'Design/covenant history differs from the post-apply baseline');
  const protectedHash = hash({ world: work.worldPack, bible: work.storyBible, plans: [...work.plans], activePlanId: work.activePlanId,
    versions: [...work.versions], events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] });
  assert.equal(protectedHash, baseline.protectedHash);
  assert.equal(designReviewHash(work, baseline.planId), baseline.inputHash);
  for (const [id, expected] of baseline.oldRuns) assert.equal(hash(work.designReviewRuns.get(id)), expected, id);
  for (const [id, expected] of baseline.oldReports) assert.equal(hash(work.designContentReviews.get(id)), expected, id);
  for (const run of checkpoint.runs) assert.equal(hash(work.designReviewRuns.get(run.id)), hash(run), run.id);
  for (const report of checkpoint.reports) assert.equal(hash(work.designContentReviews.get(report.id)), hash(report), report.id);
  assert.equal(sha(fs.readFileSync(`${root}/result.json`)), sha(checkpointBytes), 'Final checkpoint changed during the audit');
  const proof = {
    kind: 'design68_independent_final_history_read', startedAt, completedAt: new Date().toISOString(),
    workId: work.id, planId: baseline.planId, inputHash: baseline.inputHash,
    checkpointSha256: sha(checkpointBytes), protectedHash, equalsPreparedBaseline: true,
    designAndCovenantHistorySha256: hash(histories), referencePath,
    counts: { chapterVersions: work.versions.size, events: work.events.size, manuscripts: work.manuscripts.size,
      candidates: work.candidates.size, plans: work.plans.size, designSnapshots: work.designHistory.size,
      retainedOldReviewRuns: baseline.oldRuns.length, retainedOldReports: baseline.oldReports.length,
      currentRunsCompared: checkpoint.runs.length, currentReportsCompared: checkpoint.reports.length },
    revisions: { world: work.worldPack.revision, bible: work.storyBible.revision,
      proposalPlan: work.plans.get(baseline.planId).revision, approvedPlan: work.plans.get(work.activePlanId).revision },
    method: 'Read the current aggregate and raw design/covenant histories in one Prisma transaction. Recompute the preparation protected-content hash, compare every old run/report and all four completed current runs/reports, and compare raw design/covenant history with the post-apply database snapshot.',
    modelCalls: 0, productionWrites: 0, designApproved: false,
    limitation: 'This proves preservation and checkpoint/database agreement at the observed read, not semantic quality, future preservation, or manuscript acceptance.',
  };
  fs.writeFileSync('docs/audits/2026-10-16-design68-final-history.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ protectedHash, counts: proof.counts, revisions: proof.revisions, modelCalls: 0, productionWrites: 0 }));
} finally {
  await prisma.$disconnect();
  await reference.$disconnect();
}
