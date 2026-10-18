// Verify the saved follow-up's numerical claim against its actual sent source.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-notes16-review-segment-17.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath),run=terminal.runs.find(r=>r.input.area==='power'),stage=run.stages.find(s=>s.id==='followup-batch-2/tiers');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const requestPath='data/audit-runtimes/design76-notes16-review/model-calls/00090.started.json',responsePath='data/audit-runtimes/design76-notes16-review/model-calls/00090.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.equal(raw.requestId,request.requestId);assert.deepEqual(stage.modelResponses,[read(responsePath).response.text]);
const check=stage.result.checks.find(c=>c.criterion==='tiers');assert.equal(check.verdict,'pass');
const claimQuote='330日至397日的两个有效周期';assert.ok(check.explanation.includes(claimQuote));
const sourceId='plan/milestones/ms_v3_training',evidence=[
 {sourceId,quote:'331–340为有效1、341–350为有效2。'},
 {sourceId,quote:'358–367有效3、368–377有效4、378–387有效5、388–397有效6，分别开第四至七枚。'},
 {sourceId,quote:'六个有效周期60日，加失败4日，实耗七枚；398日完整静置一日，399–414日只做复诊、稳定观察和获准的空载复测。'},
 {sourceId,quote:'378开始前顾同样借页讲第三段，复述和医修许可都通过后才做378–387、388–397两个有效周期。'},
];
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===e.sourceId).text.includes(e.quote));
 const sent=request.sources.filter(s=>s.origin?.sourceId===e.sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>f.id));assert.equal(sent.length,1);return {...e,sent};
});
const cycles=[[331,340],[341,350],[358,367],[368,377],[378,387],[388,397]];
assert.equal(cycles.reduce((n,[a,b])=>n+b-a+1,0),60);assert.equal(cycles.length,6);
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-power-followup-cycle-count',runId:run.id,stageId:stage.id,criterion:'tiers',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
 explanation:'330日是授课及行前许可，331—397日整个训练安排有六个有效十日周期，不是两个：331—340、341—350为第一段两周期；358—367、368—377为第二段两周期；378—387、388—397为第三段两周期，共60日。351—354失败周期报废一枚、不计有效，355—357停训；总计七枚实际耗材。原解释前句的六周期门槛与原文一致，但后句“两个”误将每段数量写成全程数量。保留原局部pass及解除声明；不能据此缩减训练、提前支付十元载或把勘误当成新的全局资格验收。',evidence});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design76_power_followup_cycle_count',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,cycles,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Independent clarification draft; no annotation append, verdict change or design mutation.'};
const out='docs/audits/2026-10-18-design76-power-followup-cycle-count.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,effectiveCycles:6,effectiveDays:60,productionWrites:0}));
