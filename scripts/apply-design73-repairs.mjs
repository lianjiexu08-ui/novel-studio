// Save the locally reviewed design73 repair as a new proposed revision.
// It never approves the plan or generates prose.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaWorkRepository } from '../packages/persistence/src/prisma-repository.ts';
import { ChapterWorkflow } from '../packages/application/src/index.ts';
import { designReviewHash } from '../novel-service-core/src/design-review.ts';
import { validateDesignCandidate } from '../packages/application/src/design-candidate.ts';

const mode = process.argv[2];
assert.ok(['--apply', '--verify'].includes(mode));
const workId = 'work_8b6c9133e13d404083ca33acc63f4f61';
const candidatePath = 'data/design-candidates/design73-repairs-v4.json';
const proofPath = 'docs/audits/2026-10-18-design73-repairs-applied.json';
const candidateProof = JSON.parse(fs.readFileSync('docs/audits/2026-10-18-design73-repairs-v4-candidate.json'));
const candidate = JSON.parse(fs.readFileSync(candidatePath));
const reviewControl = 'data/audit-runtimes/design73-repair-v4-review';
const reviewAreas = ['world', 'power', 'characters'];
for (const area of reviewAreas) {
  const state = JSON.parse(fs.readFileSync(`${reviewControl}/${area}-result.json`));
  assert.equal(state.status, 'completed');
  assert.ok(state.result.checks.every(check => check.verdict === 'pass'), `${area} local review did not pass`);
  assert.equal(state.productionWrites, 0);
  assert.equal(state.formalAcceptance, false);
}
assert.equal(createHash('sha256').update(JSON.stringify(candidate)).digest('hex'), candidateProof.candidateSha256);
assert.equal(validateDesignCandidate(candidate).valid, true);

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const serialize = work => Object.fromEntries(Object.entries(work).map(([key, value]) => [key, value instanceof Map ? [...value] : value]));
const contentHash = work => hash({ world: work.worldPack, bible: work.storyBible, plans: [...work.plans], activePlanId: work.activePlanId,
  designHistory: [...work.designHistory], versions: [...work.versions], events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] });
const immutableHash = work => hash({ activePlanId: work.activePlanId, versions: [...work.versions], events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] });
const prisma = new PrismaClient({ datasources: { db: { url: 'file:/Users/lianjie/Documents/ChatGPT/novel/data/novel-studio.db' } } });
const repo = new PrismaWorkRepository(prisma);
const before = await repo.get(workId);
assert.ok(before);
const basePlan = [...before.plans.values()].find(item => item.revision === 72);
assert.ok(basePlan && basePlan.id === candidateProof.basePlanId);
assert.equal(before.worldPack.revision, 37);
assert.equal(before.storyBible.revision, 69);
const beforeHash = contentHash(before);
const expectedInputHash = designReviewHash(before, basePlan.id);
assert.ok(expectedInputHash);

if (mode === '--apply') {
  assert.ok(!fs.existsSync(proofPath), 'Existing application proof requires --verify');
  const workflow = new ChapterWorkflow(repo, { generateChapter() { throw new Error('No prose during design repair'); } });
  const saved = await workflow.saveDesignCandidate(workId, {
    basePlanId: basePlan.id, expectedInputHash, candidate,
    note: 'design73局部复审通过：补齐实体通行/港务手续与费用账、丹府晋阶门槛、低流量试注和后段反制动作卡，并修复第33章知情边界；保存为待正式复审提案，不批准写作。',
  });
  assert.equal(saved.validation.valid, true);
  const after = await repo.get(workId);
  assert.ok(after);
  assert.equal(immutableHash(after), immutableHash(before));
  assert.equal(after.worldPack.revision, 38);
  assert.equal(after.storyBible.revision, 70);
  assert.equal(saved.plan.revision, 73);
  assert.equal(saved.plan.status, 'proposed');
  assert.equal(after.plans.get(saved.plan.id).revision, 73);
  assert.deepEqual(after.worldPack, JSON.parse(JSON.stringify({ ...candidate.worldPack, revision: 38, status: 'proposed', lockedAt: undefined })));
  assert.deepEqual(after.storyBible, JSON.parse(JSON.stringify({ ...candidate.storyBible, revision: 70, status: 'proposed', lockedAt: undefined,
    worldPackId: after.worldPack.id, worldPackRevision: 38 })));
  const proof = { kind: 'design73_repairs_applied_as_proposal', appliedAt: new Date().toISOString(), workId,
    sourcePlanId: basePlan.id, appliedPlanId: saved.plan.id, candidatePath, candidateSha256: candidateProof.candidateSha256,
    beforeHash, expectedInputHash, revisions: { world: after.worldPack.revision, storyBible: after.storyBible.revision,
      plan: saved.plan.revision, approvedPlan: after.plans.get(after.activePlanId).revision },
    localReviews: { world: 'passed', power: 'passed', characters: 'passed', modelCalls: 3 },
    blockersRetained: validateDesignCandidate(candidate).blockers.length, oldDesignAndReviewRecordsPreserved: true,
    proposalStatus: 'proposed', formalAcceptance: false, proseGenerated: false, productionDesignSaves: 1,
    nextRequiredAction: 'Run a new four-area formal design review against revision 73 before approval or prose.' };
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ applied: true, planId: saved.plan.id, revisions: proof.revisions, blockersRetained: proof.blockersRetained,
    formalAcceptance: false, proseGenerated: false, productionDesignSaves: 1 }));
} else {
  const proof = JSON.parse(fs.readFileSync(proofPath));
  const after = await repo.get(workId);
  assert.ok(after);
  const plan = after.plans.get(proof.appliedPlanId);
  assert.ok(plan && plan.status === 'proposed' && plan.revision === 73);
  assert.equal(after.worldPack.revision, 38);
  assert.equal(after.storyBible.revision, 70);
  assert.equal(after.plans.get(after.activePlanId).revision, 10);
  assert.equal(proof.formalAcceptance, false);
  assert.equal(proof.proseGenerated, false);
  console.log(JSON.stringify({ verified: true, planId: plan.id, revisions: proof.revisions, formalAcceptance: false, proseGenerated: false }));
}
await repo.disconnect();
await prisma.$disconnect();
