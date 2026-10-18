// Verify the saved follow-up's numerical claim against its actual sent source.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-notes16-review-segment-17.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath),run=terminal.runs.find(r=>r.input.area==='world'),stage=run.stages.find(s=>s.id==='cross-3-6');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const requestPath='data/audit-runtimes/design76-notes16-review/model-calls/00093.started.json',responsePath='data/audit-runtimes/design76-notes16-review/model-calls/00093.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.equal(raw.requestId,request.requestId);assert.deepEqual(stage.modelResponses,[read(responsePath).response.text]);
const check=stage.result.checks.find(c=>c.criterion==='capacity');assert.equal(check.verdict,'pass');
const claimQuote='第一卷以受限跨海、失箱和港口劳务展开';assert.ok(check.explanation.includes(claimQuote));
const evidence=[
 {sourceId:'plan/volumes/vol_01',quote:'"startChapter": 1,\n  "endChapter": 32'},
 {sourceId:'plan/volumes/vol_01',quote:'在伤势与短寿限制下真正修成凝元，进入有门槛的古境，联合同伴击破墨幽屠本次掳人夺泉行动，取得有限泉液并付出分离代价南渡；卷末凝元三重，不使用逆命真解。'},
 {sourceId:'plan/volumes/vol_02',quote:'"startChapter": 33,\n  "endChapter": 66'},
 {sourceId:'plan/chapters/33',quote:'"chapterNumber": 33,\n  "volumeId": "vol_02"'},
 {sourceId:'plan/chapters/33',quote:'217日晨，林在受护交接位退还旧借衣符，换上船方实付租来的另一张避火符，随后坐到轻役货位。'},
];
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===e.sourceId).text.includes(e.quote));
 const sent=request.sources.filter(s=>s.origin?.sourceId===e.sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>f.id));assert.equal(sent.length,1);return {...e,sent};
});
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-world-cross36-volume-scope',runId:run.id,stageId:stage.id,criterion:'capacity',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
 explanation:'第一卷范围是1—32章，核心是矿务求生、凝元成长、古境救援与有限分泉，南渡和失箱属于卷末转折。第33章起进入第二卷（33—66章）；第217日换租符后到港口轻役货位，以及后续失箱索偿、仓火和港口劳务，不能整体归入第一卷。原解释将第二卷的港口劳务并入第一卷，压缩并错置了第一卷的主要承载功能。保留原局部pass，不因勘误改动卷界、搬移事件或视全书容量已验收；后续综合须按实际卷界分别评价古境成长与港口救援。',evidence});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design76_world_cross36_volume_scope',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Independent clarification draft; no annotation append, verdict change or design mutation.'};
const out='docs/audits/2026-10-18-design76-world-cross36-volume-scope.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,sourceCount:actualSupport.length,productionWrites:0}));
