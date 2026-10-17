// Apply the two independently reviewed design repairs as one proposed revision.
// This preserves every prior design/review record and never approves writing.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const mode = process.argv[2];
assert.ok(['--apply', '--verify'].includes(mode), 'Usage: --apply|--verify');
const root = process.cwd();
const read = file => JSON.parse(fs.readFileSync(file));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileHash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const clean = value => JSON.parse(JSON.stringify(value));
const baseline = read('data/audit-runtimes/design71-review/baseline.json');
const worldProof = read('docs/audits/2026-10-17-design71-world-candidate.json');
const fireProof = read('docs/audits/2026-10-17-design71-fire-control-candidate.json');
const worldReview = read('docs/audits/2026-10-17-design71-world-content-review.json');
const fireReview = read('docs/audits/2026-10-17-design71-fire-control-content-review.json');
const outputPath = 'docs/audits/2026-10-17-design71-reviewed-candidates-applied.json';
const candidate = read(worldProof.candidatePath);
const fire = read(fireProof.candidatePath);

assert.equal(worldProof.workId, baseline.workId);
assert.equal(fire.workId, baseline.workId);
assert.equal(worldProof.basePlanId, baseline.planId);
assert.equal(worldProof.expectedInputHash, baseline.inputHash);
assert.equal(fireProof.expectedInputHash, baseline.inputHash);
assert.equal(fileHash(worldProof.candidatePath), worldProof.candidateSha256);
assert.equal(fileHash(fireProof.candidatePath), fireProof.candidateSha256);
assert.equal(worldReview.result.checks.every(check => check.verdict === 'pass'), true);
assert.equal(fireReview.result.checks.every(check => check.verdict === 'pass'), true);
assert.equal(fire.applied, false);
assert.equal(fire.modelReviewed, false);
assert.deepEqual(fire.changes.map(change => change.sourceId).sort(), ['world/resources/res_12', 'world/techniques/tech_07']);

const load = file => import(pathToFileURL(`${root}/${file}`).href);
const { PrismaClient } = await import('@prisma/client');
const { PrismaWorkRepository } = await load('packages/persistence/src/prisma-repository.ts');
const { ChapterWorkflow } = await load('packages/application/src/index.ts');
const { validateDesignCandidate } = await load('packages/application/src/design-candidate.ts');
const { designReviewHash } = await load('novel-service-core/src/design-review.ts');

for (const change of fire.changes) {
  const [, collection, id] = change.sourceId.split('/');
  const index = candidate.worldPack[collection].findIndex(item => item.id === id);
  assert.ok(index >= 0, change.sourceId);
  assert.deepEqual(candidate.worldPack[collection][index], change.before, `overlap: ${change.sourceId}`);
  candidate.worldPack[collection][index] = structuredClone(change.after);
}
const validation = validateDesignCandidate(candidate);
assert.equal(validation.valid, true, JSON.stringify(validation.issues));
assert.equal(validation.blockers.length, 41);

const protectedContent = work => hash({ world: work.worldPack, bible: work.storyBible,
  plans: [...work.plans], activePlanId: work.activePlanId, designHistory: [...work.designHistory],
  versions: [...work.versions], events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] });
const immutableContent = work => hash({ activePlanId: work.activePlanId, versions: [...work.versions],
  events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] });
const assertOldReviews = work => {
  for (const [id, expected] of baseline.oldRuns) assert.equal(hash(work.designReviewRuns.get(id)), expected, `old run ${id}`);
  for (const [id, expected] of baseline.oldReports) assert.equal(hash(work.designContentReviews.get(id)), expected, `old report ${id}`);
};
const prisma = new PrismaClient({ datasources: { db: { url: `file:${root}/data/novel-studio.db` } } });
const repository = new PrismaWorkRepository(prisma);
let before;
try {
  before = await repository.get(baseline.workId);
  assert.ok(before);
  if (mode === '--apply') assert.equal(protectedContent(before), baseline.protectedHash);
  assert.equal(before.plans.get(before.activePlanId)?.revision, 10);
  assert.equal(before.plans.has(baseline.planId), true);
  const currentBaseHash = designReviewHash(before, baseline.planId);
  assert.ok(currentBaseHash && currentBaseHash !== baseline.inputHash, 'Expected current rubric hash to differ from frozen review hash');

  if (mode === '--apply') {
    assert.ok(!fs.existsSync(outputPath), 'Existing application proof requires --verify');
    const workflow = new ChapterWorkflow(repository, { generateChapter() { throw new Error('No prose during design repair'); } });
    const saved = await workflow.saveDesignCandidate(baseline.workId, {
      basePlanId: baseline.planId,
      expectedInputHash: currentBaseHash,
      candidate,
      note: '世界安置与时间线澄清、玄府/神海控火规则修复均通过局部模型复审；保存为待复审提案，保留旧设计与全部旧评审，不批准写作。',
    });
    assert.equal(saved.validation.valid, true);
    await repository.disconnect();
    await prisma.$disconnect();

    const verifyPrisma = new PrismaClient({ datasources: { db: { url: `file:${root}/data/novel-studio.db` } } });
    const verifyRepo = new PrismaWorkRepository(verifyPrisma);
    try {
      const after = await verifyRepo.get(baseline.workId);
      assert.ok(after);
      assert.equal(immutableContent(after), immutableContent(before));
      assertOldReviews(after);
      assert.equal(after.worldPack.revision, 37);
      assert.equal(after.storyBible.revision, 69);
      const plan = after.plans.get(saved.plan.id);
      assert.ok(plan);
      assert.equal(plan.revision, 72);
      assert.equal(plan.status, 'proposed');
      assert.deepEqual(plan.plan, candidate.plan);
      assert.deepEqual(after.worldPack, clean({ ...candidate.worldPack, revision: 37, status: 'proposed', lockedAt: undefined }));
      assert.deepEqual(after.storyBible, clean({ ...candidate.storyBible, revision: 69, status: 'proposed', lockedAt: undefined,
        worldPackId: after.worldPack.id, worldPackRevision: 37 }));
      const proof = { kind: 'design71_reviewed_candidates_applied_as_proposal', appliedAt: new Date().toISOString(),
        workId: baseline.workId, sourcePlanId: baseline.planId, appliedPlanId: plan.id,
        originalReviewInputHash: baseline.inputHash, currentBaseHash, candidateSha256: hash(candidate),
        worldCandidateSha256: worldProof.candidateSha256, fireCandidateSha256: fireProof.candidateSha256,
        revisions: { world: after.worldPack.revision, bible: after.storyBible.revision, plan: plan.revision, approved: after.plans.get(after.activePlanId).revision },
        localReviews: { world: 'passed', power: 'passed', modelCalls: 2 },
        oldDesignAndReviewRecordsPreserved: true, proposalStatus: 'proposed', formalAcceptance: false,
        proseGenerated: false, blockersRetained: validation.blockers.length,
        nextRequiredAction: 'Recompute current inputs and run a new four-area design review before approval or prose.' };
      fs.writeFileSync(outputPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
      console.log(JSON.stringify({ applied: true, planId: plan.id, revisions: proof.revisions, formalAcceptance: false, productionWrites: 1 }));
    } finally { await verifyRepo.disconnect(); await verifyPrisma.$disconnect(); }
    process.exit(0);
  }

  const proof = fs.existsSync(outputPath) ? read(outputPath) : undefined;
  if (!proof) {
    const plan = [...before.plans.values()].find(item => item.revision === 72);
    assert.ok(plan, 'No applied proposed revision found');
    assert.equal(before.worldPack.revision, 37);
    assert.equal(before.storyBible.revision, 69);
    assert.deepEqual(before.worldPack, clean({ ...candidate.worldPack, revision: 37, status: 'proposed', lockedAt: undefined }));
    assert.deepEqual(before.storyBible, clean({ ...candidate.storyBible, revision: 69, status: 'proposed', lockedAt: undefined,
      worldPackId: before.worldPack.id, worldPackRevision: 37 }));
    assert.deepEqual(plan.plan, candidate.plan);
    assertOldReviews(before);
    const generated = { kind: 'design71_reviewed_candidates_applied_as_proposal', appliedAt: new Date().toISOString(),
      workId: baseline.workId, sourcePlanId: baseline.planId, appliedPlanId: plan.id,
      originalReviewInputHash: baseline.inputHash, currentBaseHash: designReviewHash(before, baseline.planId),
      candidateSha256: hash(candidate), worldCandidateSha256: worldProof.candidateSha256, fireCandidateSha256: fireProof.candidateSha256,
      revisions: { world: before.worldPack.revision, bible: before.storyBible.revision, plan: plan.revision, approved: before.plans.get(before.activePlanId).revision },
      localReviews: { world: 'passed', power: 'passed', modelCalls: 2 }, oldDesignAndReviewRecordsPreserved: true,
      proposalStatus: 'proposed', formalAcceptance: false, proseGenerated: false, blockersRetained: validation.blockers.length,
      nextRequiredAction: 'Recompute current inputs and run a new four-area design review before approval or prose.' };
    fs.writeFileSync(outputPath, JSON.stringify(generated, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ verified: true, planId: plan.id, revisions: generated.revisions, formalAcceptance: false, recoveredProof: true }));
    process.exit(0);
  }
  const plan = before.plans.get(proof.appliedPlanId);
  assert.ok(plan);
  assert.equal(plan.status, 'proposed');
  assert.equal(before.worldPack.revision, 37);
  assert.equal(before.storyBible.revision, 69);
  assert.equal(plan.revision, 72);
  assert.equal(protectedContent(before), baseline.protectedHash);
  console.log(JSON.stringify({ verified: true, planId: plan.id, revisions: proof.revisions, formalAcceptance: false }));
} finally {
  try { await repository.disconnect(); } catch {}
  try { await prisma.$disconnect(); } catch {}
}
