import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateDesignCandidate } from '../../packages/application/src/design-candidate.ts';
const hash=v=>createHash('sha256').update(v).digest('hex');
const sourcePath='data/design-candidates/design64-receipt-exception-draft-v7.json';
const bytes=fs.readFileSync(sourcePath);
assert.equal(hash(bytes),'3af9d36cdf13ec5c1164386ba210334406f9c97149dfd0a957bf9a690ad9322a');
const source=JSON.parse(bytes), candidate=structuredClone(source);
const removals=[
 [1,'opening-knowledge-boundary','当前问题明确要求报令、赵认知、95章撤押原令、北境面报、318日抵押与父案材料递进；此项只核第1章暗桩身份及矿烟的现场认知，不能直接证明这些特定消息链。'],
 [30,'road-and-contract-cost','第212—213日入口外营至南渡港的六箱货运，不是问题指定的北航五日、返航六日、14,000枚专项款和外港担保。'],
 [31,'inspection-and-payment','第214日南渡劳务抵舱与六箱验货，不是问题指定的后续北航专项款支付。'],
 [31,'finite-port-protection','此项核避火衣与借符，问题对象却是绝命死息res_15和诸天通宝res_16的品阶、材质、发行及保存规则，对象不一致。'],
 [32,'loss-and-witness-boundary','此项核六号箱失踪与现场见闻，未核问题指定的报令、赵认知、撤押原令、北境面报、抵押或父案材料递进；通用认知边界不能替代特定消息链。'],
 [32,'arrival-permit','第215—216日南渡抵赤霄的实体航程与许可，不是问题指定的后续北航五日和返航六日。'],
 [37,'private-message-boundary','此项核陆弟请登记员联络哥哥及林离场不知送条，未核问题指定的赵方报令、撤押原令、北境面报或父案资料链。'],
];
const questions={world:source.worldPack.unresolvedQuestions,story:source.storyBible.unresolvedQuestions,plan:source.plan.openQuestions};
const patches=removals.map(([chapterNumber,id,reason])=>{
 const ci=candidate.plan.chapters.findIndex(c=>c.chapterNumber===chapterNumber), chapter=candidate.plan.chapters[ci];
 const ei=chapter.executionChecks.findIndex(c=>c.id===id), check=chapter.executionChecks[ei];
 const before=check.sourceQuestion;assert.ok(before);
 const question=questions[before.document].find(q=>q.id===before.questionId);assert.ok(question);
 delete check.sourceQuestion;
 return {op:'remove',path:`/plan/chapters/${ci}/executionChecks/${ei}/sourceQuestion`,chapterNumber,checkId:id,before,question:structuredClone(question),requirement:check.requirement,reason};
});
const stripRefs=doc=>{const c=structuredClone(doc);for(const chapter of c.plan.chapters)for(const check of chapter.executionChecks??[])delete check.sourceQuestion;return c;};
assert.deepEqual(stripRefs(candidate),stripRefs(source));
const restored=structuredClone(candidate);
for(const p of patches)restored.plan.chapters.find(c=>c.chapterNumber===p.chapterNumber).executionChecks.find(c=>c.id===p.checkId).sourceQuestion=p.before;
assert.deepEqual(restored,source,'Only the seven declared references may change');
const validation=validateDesignCandidate(candidate);assert.equal(validation.valid,true,JSON.stringify(validation.issues));assert.equal(validation.blockers.length,41);
const checks=candidate.plan.chapters.flatMap(c=>c.executionChecks??[]);assert.equal(checks.length,27);assert.equal(checks.filter(c=>c.sourceQuestion).length,20);
const candidatePath='data/design-candidates/design64-execution-links-draft-v8.json';
const output=JSON.stringify(candidate,null,2)+'\n';fs.writeFileSync(candidatePath,output,{flag:'wx'});
const proof={kind:'proposed_execution_link_reconciliation',observedAt:new Date().toISOString(),sourcePath,sourceSha256:hash(bytes),
 appliedBaseline:'docs/audits/2026-10-16-design64-applied.json',sourceInputHash:'32f6ca9f61bbb70b8b56a0a7908ca086a0ce1b6ff4554ff3bafdf7428f05465f',
 candidatePath,candidateSha256:hash(output),patches,validation,requirementsPreserved:27,remainingQuestionReferences:20,
 sourceQuestionObjectsUnchanged:true,storyTextUnchanged:true,productionWrites:0,modelCalls:0,formalAcceptance:false,applied:false,
 limitation:'Manual semantic-scope correction. Removing a misleading link preserves the chapter requirement and all blockers; it does not validate remaining links as exhaustive coverage or accept any design/prose.'};
fs.writeFileSync('docs/audits/2026-10-16-design64-execution-link-repair.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({candidatePath,changes:patches.length,requirements:checks.length,blockers:validation.blockers.length,applied:false}));
