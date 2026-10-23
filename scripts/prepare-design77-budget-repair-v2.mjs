// Prepare a detached repair for the chapter-31 payment-ledger wording found
// by the bounded design77 review. It never writes production design state.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaWorkRepository } from '../packages/persistence/src/prisma-repository.ts';
import { validateDesignCandidate } from '../packages/application/src/design-candidate.ts';

const workId = 'work_8b6c9133e13d404083ca33acc63f4f61';
const planId = 'plan_14b9ff794fce4e67b7ff6dbf33344e29';
const candidatePath = 'data/design-candidates/design77-budget-repair-v2.json';
const proofPath = 'docs/audits/2026-10-23-design77-budget-repair-v2-candidate.json';
assert.ok(!fs.existsSync(candidatePath));
assert.ok(!fs.existsSync(proofPath));
const clean = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const prisma = new PrismaClient({ datasources: { db: { url: 'file:/Users/lianjie/Documents/ChatGPT/novel/data/novel-studio.db' } } });
const repo = new PrismaWorkRepository(prisma);
const work = await repo.get(workId);
assert.ok(work);
assert.equal(work.worldPack.revision, 41);
assert.equal(work.storyBible.revision, 73);
assert.equal(work.plans.get(planId)?.revision, 77);
const worldPack = clean(work.worldPack);
const storyBible = clean(work.storyBible);
const plan = clean(work.plans.get(planId).plan);
const plan31 = plan.chapters.find(item => item.chapterNumber === 31);
const bible31 = storyBible.chapterPlans.find(item => item.chapterNumber === 31);
assert.ok(plan31 && bible31);

const ledger = '本航次账户统一按一条结算链记录：基础护货劳务六枚；普通舱/船费四枚从该劳务抵扣；受潮封签复验费半枚继续从同一余款扣除；第30章已明确不发的一枚加急奖金不计入收入。因此214日副联签认的本航次可领余额为一枚半。港务验籍费两枚由程记承运账户现场实付，不从林辰个人账扣；第31章不得把“扣验货费”写成另扣一笔奖金。';
plan31.summary = plan31.summary.replace('验货费按护货合同扣当次奖金', '验货费按护货合同从基础护货劳务余额扣除，并在副本中与舱费分栏');
plan31.cost = '本航次账户按副联逐项结算：基础护货劳务六枚，普通舱/船费抵扣四枚，受潮封签复验费从余款抵扣半枚；第30章已取消的一枚加急奖金不计入收入，港务验籍费两枚由程记承运账户现场实付，不从林辰个人账户扣除。214日登船前签认本航次最终可领一枚半；不得把复验费再写成另扣一次奖金。借衣与借符仍按附单归还，后续217日另签轻役合同的租符和药费不回填本航次账。';
bible31.purpose = bible31.purpose.replace('验货费按护货合同扣当次奖金', '验货费按护货合同从基础护货劳务余额扣除，并与舱费在副本中分栏');
bible31.requiredEvents.push(ledger);

const candidate = { worldPack, storyBible, plan };
const validation = validateDesignCandidate(candidate);
assert.equal(validation.valid, true, JSON.stringify(validation.issues, null, 2));
const proof = {
  kind: 'design77_budget_repair_v2_unapplied', createdAt: new Date().toISOString(), workId,
  basePlanId: planId, baseRevisions: { world: 41, storyBible: 73, plan: 77 }, candidatePath,
  candidateSha256: hash(candidate), inputHash: hash({ workId, planId, candidateSha256: hash(candidate) }),
  changes: [
    '第31章摘要、cost和圣经目的统一为同一条六枚护货劳务结算链，消除“扣当次奖金”与“从基础劳务扣除”的歧义。',
    '明确港务验籍费由程记承运账户现场支付，复验费只从余款扣一次；第30章取消的加急奖金不计入收入。',
    '明确第31章一枚半与第33—39章另签轻役合同的三枚净酬分账，不能互相回填。',
  ],
  validation: { valid: validation.valid, warnings: validation.warnings, blockers: validation.blockers },
  formalAcceptance: false, proseGenerated: false, productionWrites: 0,
  limitation: '候选尚未写入生产；需局部模型复核和后续四领域复核。',
};
fs.mkdirSync('data/design-candidates', { recursive: true });
fs.mkdirSync('docs/audits', { recursive: true });
fs.writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ candidatePath, proofPath, candidateSha256: proof.candidateSha256, validation: { valid: validation.valid, blockers: validation.blockers.length }, formalAcceptance: false }));
await repo.disconnect();
await prisma.$disconnect();
