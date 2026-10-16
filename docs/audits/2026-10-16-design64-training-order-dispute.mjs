import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayDesignReviewPrefix } from '../../scripts/audit-design-reviews.mjs';

const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const binding = read('data/audit-runtimes/design64-runtime-bound.json');
const baseline = read('data/audit-runtimes/design64-control/baseline.json');
const checkpointPath = 'data/audit-runtimes/design64-control/training-order-checkpoint.json';
if (!process.argv.includes('--use-saved-checkpoint')) fs.copyFileSync('data/audit-runtimes/design64-control/resume-3-result.json', checkpointPath, fs.constants.COPYFILE_EXCL);
const checkpoint = read(checkpointPath), run = checkpoint.runs.find(r => r.input.area === 'power');
assert.equal(run.input.inputHash, baseline.inputHash);
assert.equal(checkpoint.runtimeCommit, binding.commit);
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(binding.root + '/' + p), h);
const stages = await import(binding.root + '/novel-service-core/src/design-review-run.ts');
const { JsonDesignPlanner } = await import(binding.root + '/packages/planner/src/index.ts');
const replay = await replayDesignReviewPrefix(run, run.input, { ...stages, JsonDesignPlanner });
const stage = run.stages.find(s => s.id === 'synthesis-1');
const check = stage.result.checks.find(c => c.criterion === 'tiers');
assert.equal(check.verdict, 'pass');
const misstatement = '先完成凝元基础与乾元御风剑诀训练，再付3元载入凝元';
assert.ok(check.explanation.includes(misstatement));
const source = run.input.sources.find(s => s.id === 'plan/chapters/18');
const chapter = JSON.parse(source.text);
const appliedPath = 'data/design-candidates/design64-receipt-exception-draft-v7.json';
const candidatePath = 'data/design-candidates/design64-motivation-wording-draft-v11.json';
assert.equal(fileHash(appliedPath), checkpoint.candidateFileSha256);
assert.equal(fileHash(candidatePath), 'ec7d90cb870f6d35f9cfc9d1c95cc21169f97bf856940f8ef8bf2a70273c19be');
assert.deepEqual(chapter, read(appliedPath).plan.chapters.find(c => c.chapterNumber === 18));
const { executionChecks: addedExecutionChecks, ...latestChapterContent } = read(candidatePath).plan.chapters.find(c => c.chapterNumber === 18);
assert.equal(chapter.executionChecks, undefined);
assert.deepEqual(chapter, latestChapterContent);
assert.deepEqual(addedExecutionChecks.map(c => c.id), ['advancement-paid-once', 'trained-skill-and-equipment-limit', 'measured-recovery-before-departure']);
const advancementQuote = '第120日清晨，白榆复查旧伤、经脉与寿储，确认未有新增耗损，下界为7−101/365≈6.7233元载。林辰在屋里以清风引气诀收束气流，按既定晋阶法门主动付出3元载，真元初成而寿储下界降至约3.7233';
const teachingQuote = '第132日，顾以护送候补的授业职责，向已凝元并获准练习的林辰借授宗门乾元御风剑诀的凝元导刃章';
assert.ok(chapter.summary.includes(advancementQuote));
assert.ok(chapter.summary.includes(teachingQuote));
assert.ok(chapter.summary.indexOf(advancementQuote) < chapter.summary.indexOf(teachingQuote));
const ownEvidence = check.evidence.find(e => e.quote.includes('第18章明确林辰凝元后接受顾峤指导'));
assert.ok(ownEvidence, 'The synthesis itself cited a report with the correct ordering');
assert.equal(ownEvidence.sourceId, 'review-result/batch-2');
const proof = {
  kind: 'manual_synthesis_training_order_dispute', observedAt: new Date().toISOString(),
  inputHash: run.input.inputHash, runId: run.id, stageId: stage.id, checkpointPath,
  checkpointSha256: fileHash(checkpointPath), runtimeCommit: binding.commit, replay,
  originalCheck: check, resultSha256: hash(stage.result), modelResponsesSha256: hash(stage.modelResponses),
  source: { id: source.id, sha256: hash(source), text: source.text },
  excerpts: [{ field: 'summary', day: 120, quote: advancementQuote }, { field: 'summary', day: 132, quote: teachingQuote }],
  ownEvidence, misstatement, addedExecutionChecks, appliedCandidateSha256: fileHash(appliedPath), latestCandidateSha256: fileHash(candidatePath),
  assessment: '该局部汇总虽判pass，解释却将凝元后剑诀训练误置于凝元前；冻结第18章先120日晋阶，再132日授剑诀，其自身引用的前置报告也说凝元后训练。应复核汇总措辞，不能用误述改写原章纲或授予淬体剑诀能力。',
  productionWrites: 0, modelCalls: 0, formalVerdictsOverridden: false, questionsResolved: 0, designApproved: false,
  limitation: '只核对该汇总解释的事件先后，不以人工原文核对代替领域评审；pass标签不保证解释无误。该意见须与负面争议一同纳入最终复核。',
};
fs.writeFileSync('docs/audits/2026-10-16-design64-training-order-dispute.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ stageId: stage.id, originalVerdict: check.verdict, advancementDay: 120, teachingDay: 132, replayedStages: replay.completedStages, responses: replay.responsesReplayed, productionWrites: 0 }));
