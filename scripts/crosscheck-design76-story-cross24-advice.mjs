// Preserve and explain a model advice error without changing the model verdict
// or the correct design account. Prepare an append-only note, never save it here.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {annotationSources,designReviewCheckHash} from '../novel-service-core/src/design-review-annotations.ts';
import {addDesignReviewAnnotationSchema} from '../packages/contracts/src/design-review.ts';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const control='data/audit-runtimes/design76-capacity-review';
const bindingPath='data/audit-runtimes/design76-citation-capacity-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(`${binding.runtimePath}/${p}`),h);
const {designReviewStageInput}=await import(binding.runtimePath+'/novel-service-core/src/design-review-run.ts');
const {prepareDesignReviewEvidence}=await import(binding.runtimePath+'/packages/planner/src/design-review-evidence.ts');
const verifiedPath='docs/audits/2026-10-18-design76-capacity-review-segment-10.json',verified=read(verifiedPath);
assert.equal(sha(verified.checkpointPath),verified.checkpointSha256);
const old=read(verified.checkpointPath),run=old.runs.find(r=>r.input.area==='story'),stage=run.stages.find(s=>s.id==='cross-2-4');
assert.equal(stage.result,undefined);
const requestPath=control+'/model-calls/00068.started.json',responsePath=control+'/model-calls/00068.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
const prepared=prepareDesignReviewEvidence(designReviewStageInput(run,stage));
assert.equal(request.requestId,prepared.requestId);assert.deepEqual(request.sources,prepared.sources);
const result=prepared.resolve(raw),check=result.checks.find(c=>c.criterion==='causality');
assert.equal(check.verdict,'insufficient');assert.deepEqual(check.awaitingSources,['plan/chapters/18','plan/chapters/19']);
assert.ok(check.revisionAdvice.includes('第20章的九成真元起点'));
assert.ok(result.checks.find(c=>c.criterion==='growth').revisionAdvice.includes('第20章十成真元起点'));
const current=read(control+'/result.json'),acceptedRun=current.runs.find(r=>r.id===run.id),accepted=acceptedRun.stages.find(s=>s.id===stage.id);
assert.deepEqual(accepted.result,result);assert.deepEqual(accepted.modelResponses,[read(responsePath).response.text]);
const source=run.input.sources.find(s=>s.id==='plan/chapters/20');assert.ok(source);
const quotes=['当日出发前余量为十成，剑诀后八成','10−2−0.5+1.5=9成','当夜复测真元九成，下一次轻钩御物仍须另付半成。'];
const evidence=quotes.map(quote=>{
 assert.ok(source.text.includes(quote));
 const sent=request.sources.flatMap(s=>s.fragments.map(f=>({unitId:s.id,fragmentId:f.id,text:f.text}))).filter(f=>f.text.includes(quote));
 assert.ok(sent.length);return {sourceId:source.id,quote,sent};
});
assert.equal(10-2-0.5+1.5,9);
const candidatePath='data/design-candidates/design76-followup-controls-v4.json',candidate=read(candidatePath);
assert.deepEqual(candidate.plan.chapters.find(c=>c.chapterNumber===20),JSON.parse(source.text),'Do not alter the correct account in the candidate');
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-story-cross24-starting-balance',runId:run.id,stageId:stage.id,
 criterion:'causality',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimField:'revisionAdvice',
 claimQuote:'第20章的九成真元起点',
 explanation:'此处把第20章完成支出及恢复后的九成余量写成起点。该次请求实际提供的第20章cost明确十成出发，支付二成剑诀及半成试注，再经实际两小时吐纳复测回一成半，10−2−0.5+1.5=9；endState的九成是当夜复测结果。原答growth建议也写十成起点。不能据这条建议把正确章纲改为九成出发或重复扣费。第18、19章的晋阶、实测、伤情和准入仍须实际补读；本说明只纠正这一账目时点，不改原insufficient、解除补读或批准设计。',
 evidence:evidence.map(({sourceId,quote})=>({sourceId,quote})),
});
annotationSources({designReviewRuns:new Map([[acceptedRun.id,acceptedRun]])},annotationInput);
const proof={kind:'story_cross24_advice_balance_crosscheck',verified:true,verifiedPath,verificationSha256:sha(verifiedPath),
 checkpointSha256:verified.checkpointSha256,bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),
 runId:run.id,stageId:stage.id,observedAcceptedStageSha256:hash(accepted),originalCheckHash:designReviewCheckHash(check),originalCheck:check,
 candidatePath,candidateSha256:sha(candidatePath),candidateAccountUnchanged:true,evidence,arithmetic:{starting:10,swordCost:2,testCost:0.5,actualRecovery:1.5,endBalance:9},annotationInput,
 annotationValidationSources:Object.fromEntries(['novel-service-core/src/design-review-annotations.ts','packages/contracts/src/design-review.ts'].map(p=>[p,sha(p)])),
 modelCalls:0,productionWrites:0,formalAcceptance:false,
 limitation:'Draft note only. Segment 11 terminal replay and an atomic append/restart check remain required before publication. Original verdicts, required readings and all design blockers remain.'};
const out='docs/audits/2026-10-18-design76-story-cross24-advice.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,runId:run.id,stageId:stage.id,claimField:'revisionAdvice',starting:10,endBalance:9,modelCalls:0,productionWrites:0}));
