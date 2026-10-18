// Preserve the actual failed third training stone and the already-completed cycle sequence.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-notes22-review-segment-23.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath);assert.equal(terminal.segment,23);
try{process.kill(terminal.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const run=terminal.runs.find(r=>r.input.area==='power'),stage=run.stages.find(s=>s.id==='followup-cross-2-5/tiers');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const base='data/audit-runtimes/design76-notes22-review/model-calls/';
const requestPath=base+'00150.started.json',responsePath=base+'00150.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.equal(raw.requestId,request.requestId);assert.deepEqual(stage.modelResponses,[read(responsePath).response.text]);
const check=stage.result.checks.find(c=>c.criterion==='tiers');assert.equal(check.verdict,'pass');assert.ok(check.resolves.includes('cross-2-5/tiers'));
const claimQuote='第81—83章正安排六个有效周期、一次回流失败报废第七枚、停训复诊、静置与两项复核，再于415日支付十元载';assert.ok(check.explanation.includes(claimQuote));
const evidence=[
 {sourceId:'plan/milestones/ms_v3_training',quote:'351开第三枚，354出现胸闷与回流立即停练，当日白榆检查并停训，第三枚报废不退、该周期不计有效'},
 {sourceId:'plan/milestones/ms_v3_training',quote:'358–367有效3、368–377有效4、378–387有效5、388–397有效6，分别开第四至七枚。'},
 {sourceId:'plan/milestones/ms_v3_training',quote:'六个有效周期60日，加失败4日，实耗七枚'},
 {sourceId:'plan/milestones/ms_v3_advancement',quote:'第398–414日只做六周期后的静置、丹府稳定观察和普通木柄空载复测，不新增训练周期'},
 {sourceId:'plan/milestones/ms_v3_advancement',quote:'第83章林在顾监督下完成突破并实际支付。'},
];
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===e.sourceId).text.includes(e.quote));
 const sent=request.sources.filter(s=>s.origin?.sourceId===e.sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>f.id));assert.equal(sent.length,1);return {...e,sent};
});
assert.deepEqual(actualSupport.map(e=>e.sent[0]),['e411','e411','e411','e415','e416']);
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-power-failed-third-stone',runId:run.id,stageId:stage.id,criterion:'tiers',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
 explanation:'失败报废的是第3枚，不是第7枚。331–340及341–350用第1、2枚完成有效周期1、2；351开第3枚，354回流即停，该枚报废且该周期不计有效。复诊许可后，358–367、368–377、378–387、388–397依次用第4至第7枚完成有效周期3至6。总耗7枚来自6个有效周期加1次失败，不能把“额外耗一枚”写成“最后第7枚失败”。这些周期已在前一训练里程碑中安排；81–87的晋阶里程碑明确398–414只做静置、观察和空载复测，不新增训练周期，第83章承接415日双重复核后实际支付十元载，不在81–83章重做六周期。原局部pass及cross-2-5/tiers解决声明保留。本说明只纠正耗材序号和阶段概括，不新增耗材、训练回合或寿储支出，不把宏观方案当成已经完成的正文事件。',evidence});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design76_power_failed_third_stone',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Independent clarification draft; does not append an annotation, change a verdict or mutate the design.'};
const out='docs/audits/2026-10-18-design76-power-failed-third-stone.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,sourceQuotes:evidence.length,productionWrites:0}));
