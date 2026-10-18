// Separate story-day numbers from elapsed training time. Do not rewrite the review.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const control='data/audit-runtimes/design76-fragment-review',verificationPath='docs/audits/2026-10-18-design76-macro-review-segment-14.json',verification=read(verificationPath);
assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const prior=read(verification.checkpointPath),run=prior.runs.find(r=>r.input.area==='world'),stage=run.stages.find(s=>s.id==='cross-2-7');assert.equal(stage.result,undefined);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {designReviewStageInput}=await import(binding.runtimePath+'/novel-service-core/src/design-review-run.ts');
const {prepareDesignReviewEvidence}=await import(binding.runtimePath+'/packages/planner/src/design-review-evidence.ts');
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const requestPath=control+'/model-calls/00083.started.json',responsePath=control+'/model-calls/00083.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text),prepared=prepareDesignReviewEvidence(designReviewStageInput(run,stage));
assert.equal(request.requestId,prepared.requestId);assert.deepEqual(request.sources,prepared.sources);
const result=prepared.resolve(raw),check=result.checks.find(c=>c.criterion==='capacity');assert.equal(check.verdict,'pass');assert.ok(check.explanation.includes('三百余日训练'));
const current=read(control+'/result.json'),acceptedRun=current.runs.find(r=>r.id===run.id),accepted=acceptedRun.stages.find(s=>s.id===stage.id);
assert.deepEqual(accepted.result,result);assert.deepEqual(accepted.modelResponses,[read(responsePath).response.text]);
const sourceId='plan/milestones/ms_v3_training',evidence=[
 {sourceId,quote:'331–340为有效1、341–350为有效2。'},
 {sourceId,quote:'351开第三枚，354出现胸闷与回流立即停练，当日白榆检查并停训，第三枚报废不退、该周期不计有效；355–357仅休息及遵医嘱观察'},
 {sourceId,quote:'358–367有效3、368–377有效4、378–387有效5、388–397有效6，分别开第四至七枚。'},
 {sourceId,quote:'六个有效周期60日，加失败4日，实耗七枚；398日完整静置一日，399–414日只做复诊、稳定观察和获准的空载复测。'},
];
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===sourceId).text.includes(e.quote));
 const sent=request.sources.filter(s=>s.origin?.sourceId===sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>({fragmentId:f.id})));assert.equal(sent.length,1);return {...e,sent};
});
const cycles=[[331,340],[341,350],[358,367],[368,377],[378,387],[388,397]],effectiveDays=cycles.reduce((n,[a,b])=>n+b-a+1,0),elapsedDays=397-331+1;
assert.equal(effectiveDays,60);assert.equal(elapsedDays,67);assert.equal(effectiveDays+(354-351+1)+(357-355+1),elapsedDays);
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-world-cross27-training-duration',runId:run.id,stageId:stage.id,criterion:'capacity',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote:'三百余日训练',
 explanation:'第三卷丹府训练不是连续三百多天。原文的331、350、397等是故事日序：331–340、341–350、358–367、368–377、378–387、388–397共六个有效十日周期，合计60日；351–354一次失败4日，355–357停训观察3日，331–397整个区间共67日。398静置、399–414复诊与稳定观察，不新增有效周期；415还须通过两项确认才支付十元载。不能把第几日写成持续几日或为符合该误述改长时间线。保留原局部pass与其他补读项；该算术核对不证明全书寿储、全部训练资格或后续正文已通过。',evidence});
annotationSources({designReviewRuns:new Map([[acceptedRun.id,acceptedRun]])},annotationInput);
const proof={kind:'design76_world_cross27_training_duration',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,observedAcceptedStageSha256:hash(accepted),originalCheckHash:designReviewCheckHash(check),originalCheck:check,cycles,effectiveDays,elapsedDays,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Independent clarification draft; requires terminal replay, private rehearsal and verified append. Does not replace the original verdict.'};
const out='docs/audits/2026-10-18-design76-world-cross27-training-duration.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,effectiveDays,elapsedDays,productionWrites:0}));
