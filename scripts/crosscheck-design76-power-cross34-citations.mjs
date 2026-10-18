// Identify title-only resolution citations without rewriting the accepted model answer.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const control='data/audit-runtimes/design76-advice-review';
const verificationPath='docs/audits/2026-10-18-design76-capacity-review-segment-11.json',verification=read(verificationPath);
assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const prior=read(verification.checkpointPath),run=prior.runs.find(r=>r.input.area==='power'),stage=run.stages.find(s=>s.id==='cross-3-4');
assert.equal(stage.result,undefined);
const bindingPath='data/audit-runtimes/design76-citation-unique-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {designReviewStageInput}=await import(binding.runtimePath+'/novel-service-core/src/design-review-run.ts');
const {prepareDesignReviewEvidence}=await import(binding.runtimePath+'/packages/planner/src/design-review-evidence.ts');
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const requestPath=control+'/model-calls/00073.started.json',responsePath=control+'/model-calls/00073.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
const prepared=prepareDesignReviewEvidence(designReviewStageInput(run,stage));assert.equal(request.requestId,prepared.requestId);assert.deepEqual(request.sources,prepared.sources);
const result=prepared.resolve(raw),check=result.checks.find(c=>c.criterion==='counters');assert.equal(check.verdict,'pass');
assert.deepEqual(check.resolves,['cross-1-4/counters','cross-2-4/counters']);
const current=read(control+'/result.json'),acceptedRun=current.runs.find(r=>r.id===run.id),accepted=acceptedRun.stages.find(s=>s.id===stage.id);
assert.deepEqual(accepted.result,result);assert.deepEqual(accepted.modelResponses,[read(responsePath).response.text]);
const selectedIds=new Set(raw.checks.find(c=>c.criterion==='counters').evidence.map(e=>e.fragmentId));
const selected=request.sources.flatMap(s=>s.fragments.filter(f=>selectedIds.has(f.id)).map(f=>({sourceId:s.origin?.sourceId??s.id,unitId:s.id,...f})));
const metadataOnly=['plan/chapters/18','plan/chapters/23'].map(sourceId=>{
 const fragments=selected.filter(s=>s.sourceId===sourceId);assert.equal(fragments.length,1);
 const header=JSON.parse(fragments[0].text.trim().replace(/,$/,'')+'}');
 assert.deepEqual(Object.keys(header),['id','chapterNumber','volumeId','title']);
 return {sourceId,fragments,header};
});
assert.deepEqual(metadataOnly.map(s=>s.fragments[0].id),['e294','e318']);
const evidence=[
 {sourceId:'plan/chapters/18',quote:'直到第176日，顾在原训练场复测其可见目标导刃、停式及剑冷后再用，确认凝元式稳定，未教成玄府式。'},
 {sourceId:'plan/chapters/18',quote:'176日的凝元剑诀实测包含一丈与两丈两处直接可见普通靶，顾核定本次已稳定掌握的导刃距离为两丈内；受扰或靶前有人即主动停式，仍付该式二成。'},
 {sourceId:'plan/chapters/21',quote:'本章只扣一次：9−0.5=8.5成，已经包含拨钩支出，不得再扣同一动作。'},
 {sourceId:'plan/chapters/23',quote:'可拨的小销约八两，只锁空载拨片，满斗重量由支轴和闸钩承受；拨片释放既有机械闸钩，落料靠重力，不把满斗载荷藏进御物费。实际出手仍须进入三丈内直视范围。'},
];
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===e.sourceId).text.includes(e.quote));
 const sent=request.sources.filter(s=>(s.origin?.sourceId??s.id)===e.sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>({fragmentId:f.id,selected:selectedIds.has(f.id)})));
 assert.equal(sent.length,1);assert.equal(sent[0].selected,false);return {...e,sent};
});
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-power-cross34-title-only-citations',runId:run.id,stageId:stage.id,criterion:'counters',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),
 claimQuote:'补读第18、21、23章后，前置与本批反制链能够闭合。',
 explanation:'本次报告对第18、23章各只选了e294、e318，二者均仅含编号、卷号和章名，不能独立支持解释中的训练实测、两丈导刃、八两插销与承重边界。第21章选了救人摘要，但半成支出的具体账在未选的cost片段。所需原文实际已经随本次请求提供，下列逐字依据可核对这些具体前置；这是报告引文选择不足，不是设定缺失，也不应据此重写正确章纲。标题命中和格式通过不等于语义证据充分，后续综合须阅读实际训练、费用和动作原文。本说明不替换模型原pass，不自动批准力量设计，资格和成本项的四份补读仍保留。',evidence});
annotationSources({designReviewRuns:new Map([[acceptedRun.id,acceptedRun]])},annotationInput);
const proof={kind:'design76_power_cross34_title_only_citations',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),
 requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,observedAcceptedStageSha256:hash(accepted),originalCheckHash:designReviewCheckHash(check),originalCheck:check,
 metadataOnly,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,
 limitation:'Draft independent clarification only. Exact source presence is not full semantic acceptance. Requires segment terminal verification and private append/restart rehearsal before publication.'};
const out='docs/audits/2026-10-18-design76-power-cross34-citations.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,metadataOnly:metadataOnly.map(s=>s.sourceId),actualSupportQuotes:actualSupport.length,productionWrites:0,formalAcceptance:false}));
