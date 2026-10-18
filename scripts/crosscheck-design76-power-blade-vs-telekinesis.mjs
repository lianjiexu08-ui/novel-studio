// Distinguish the blade technique from the separate telekinesis action and costs.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-notes22-review-segment-23.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath);assert.equal(terminal.segment,23);
try{process.kill(terminal.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const run=terminal.runs.find(r=>r.input.area==='power'),stage=run.stages.find(s=>s.id==='followup-cross-2-3/counters');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const base='data/audit-runtimes/design76-notes22-review/model-calls/';
const requestPath=base+'00145.started.json',responsePath=base+'00146.response.json',initialResponsePath=base+'00145.response.json',repairRequestPath=base+'00146.started.json';
const request=JSON.parse(read(requestPath).request.user),repairRequest=JSON.parse(read(repairRequestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.deepEqual(repairRequest.originalRequest,request);assert.equal(raw.requestId,request.requestId);
assert.deepEqual(stage.modelResponses,[read(initialResponsePath).response.text,read(responsePath).response.text]);
const check=stage.result.checks.find(c=>c.criterion==='counters');assert.equal(check.verdict,'pass');assert.ok(check.resolves.includes('cross-2-3/counters'));
const claimQuote='林辰的凝元剑诀只在已实测两丈内、可见且路径安全的普通吊索或轻销上使用，分别支付二成与半成真元';assert.ok(check.explanation.includes(claimQuote));
const evidence=[
 {sourceId:'plan/chapters/25',quote:'本式结束即停止灌注、收起热剑，之后拨插销用的是御物，不再以发热剑体施术。'},
 {sourceId:'plan/chapters/25',quote:'本场剑诀只放一道，完整二成不减。'},
 {sourceId:'plan/chapters/25',quote:'御动一息拨销，预付半成真元；小销只锁空载拨片'},
 {sourceId:'plan/chapters/25',quote:'林真元以8.5−2−0.5=6成承接，不重复扣21章成本；顾0.25元载属于顾，不记到林寿储。'},
 {sourceId:'plan/chapters/25',quote:'拨废料斗空载轻销另付半成，不御物托斗搬矿料。'},
];
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===e.sourceId).text.includes(e.quote));
 const sent=request.sources.filter(s=>s.origin?.sourceId===e.sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>f.id));assert.equal(sent.length,1);return {...e,sent};
});
assert.deepEqual(actualSupport.map(e=>e.sent[0]),['e175','e178','e176','e180','e179']);
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-power-blade-vs-telekinesis',runId:run.id,stageId:stage.id,criterion:'counters',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
 explanation:'这句把两个独立动作归到了同一个“凝元剑诀”主语下。25章剑诀仅放一道风刃切普通吊索，完整支付二成真元，随即停灌注、收起发热的剑。之后对八两无负载小销施一息御物，另付半成；这不是用风刃切销，也不是半成费用的剑诀或用热剑再施术。轻销仅锁空载拨片，废料斗靠既有机械与重力释放，不由御物承重。两次本章动作在8.5起点上分别扣2和0.5，余6成；21章旧御物费用已计入8.5起点，不再重扣。顾的0.25元载仍单独记账。原局部pass、23章补引修正和cross-2-3/counters解决声明保留。本说明只纠正术式分类与费用主语，不更换技能、不增减成本、不扩大主角对玄府的攻击能力，也不据此验收全局力量体系。',evidence});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design76_power_blade_vs_telekinesis',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),initialResponsePath,initialResponseSha256:sha(initialResponsePath),repairRequestPath,repairRequestSha256:sha(repairRequestPath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Independent clarification draft; does not append an annotation, change a verdict or mutate the design.'};
const out='docs/audits/2026-10-18-design76-power-blade-vs-telekinesis.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,sourceQuotes:evidence.length,productionWrites:0}));
