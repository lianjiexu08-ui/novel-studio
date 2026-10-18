// Clarify a geographic overgeneralization without relocating the independent return subplot.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-notes21-review-segment-22.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath);assert.equal(terminal.segment,22);
try{process.kill(terminal.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const run=terminal.runs.find(r=>r.input.area==='world'),stage=run.stages.find(s=>s.id==='followup-cross-2-3/geography');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const base='data/audit-runtimes/design76-notes21-review/model-calls/';
const requestPath=base+'00135.started.json',responsePath=base+'00136.response.json',initialResponsePath=base+'00135.response.json',repairRequestPath=base+'00136.started.json';
const request=JSON.parse(read(requestPath).request.user),repairRequest=JSON.parse(read(repairRequestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.deepEqual(repairRequest.originalRequest,request);assert.equal(raw.requestId,request.requestId);
assert.deepEqual(stage.modelResponses,[read(initialResponsePath).response.text,read(responsePath).response.text]);
const check=stage.result.checks.find(c=>c.criterion==='geography');assert.equal(check.verdict,'pass');assert.ok(check.resolves.includes('cross-2-3/geography'));
const claimQuote='第33—50章的行动均发生在天宝外港及其受护港区、货院、公共码头、潮沟和北三水台';assert.ok(check.explanation.includes(claimQuote));
const evidence=[
 {sourceId:'plan/chapters/33',quote:'loc_23天宝外港原船卸货区与侧门；插叙为loc_05入口外营至loc_29太清外门院'},
 {sourceId:'plan/chapters/33',quote:'第217日；插叙覆盖第212日至第216日的太清销班与四日慢车返宗'},
 {sourceId:'plan/chapters/33',quote:'213–216返宗以白天慢车行路、夜间停营执行，不连夜赶车'},
 {sourceId:'plan/chapters/33',quote:'苏于217日将损剑交外门器械房登记入库待处置，当面验领库内原有的一柄普通备用铁剑'},
 {sourceId:'plan/chapters/33',quote:'林41章收到信前不得知道其返宗结果。'},
];
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===e.sourceId).text.includes(e.quote));
 const sent=request.sources.filter(s=>s.origin?.sourceId===e.sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>f.id));assert.equal(sent.length,1);return {...e,sent};
});
assert.deepEqual(actualSupport.map(e=>e.sent[0]),['e391','e391','e389','e390','e391']);
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-world-port-scope',runId:run.id,stageId:stage.id,criterion:'geography',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
 explanation:'“均发生在天宝外港”只能用来概括这段林辰的港区主线，不能覆盖所有人物和场景。第33章同时有苏凌霜在青玄的独立视角：212日古境外营销班，213—216日慢车返宗，216日19时抵太清外门，217日接押及交回损剑、领取普通备用铁剑。该章地点栏明确并列天宝外港与入口外营至太清外门的返宗支线；前者在赤霄，后者仍在青玄，不是两地瞬移或同一港区内行动。返宗过程与林的海程并行，林在41章实际收到信前不得知道返宗结果。原局部pass、35章补引修正及cross-2-3/geography解决声明保留。本说明只缩小评语中的全称范围，不移动支线、不合并两地角色、不使消息即时送达，也不据此关闭全局设计问题。',evidence});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design76_world_port_scope',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),initialResponsePath,initialResponseSha256:sha(initialResponsePath),repairRequestPath,repairRequestSha256:sha(repairRequestPath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Independent clarification draft; does not append an annotation, change a verdict or mutate the design.'};
const out='docs/audits/2026-10-18-design76-world-port-scope.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,sourceQuotes:evidence.length,productionWrites:0}));
