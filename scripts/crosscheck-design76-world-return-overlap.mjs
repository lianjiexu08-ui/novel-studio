// Keep parallel journeys distinct from the order in which chapters present them.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-notes20-review-segment-21.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath);assert.equal(terminal.segment,21);
try{process.kill(terminal.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const run=terminal.runs.find(r=>r.input.area==='world'),stage=run.stages.find(s=>s.id==='followup-cross-1-4/geography');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const requestPath='data/audit-runtimes/design76-notes20-review/model-calls/00131.started.json',responsePath='data/audit-runtimes/design76-notes20-review/model-calls/00131.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.equal(raw.requestId,request.requestId);assert.deepEqual(stage.modelResponses,[read(responsePath).response.text]);
const check=stage.result.checks.find(c=>c.criterion==='geography');assert.equal(check.verdict,'pass');assert.ok(check.resolves.includes('cross-1-4/geography'));
const claimQuote='第33—35章的销班、四日慢车返宗、港内卸货与侧门调查均发生在已抵赤霄之后';assert.ok(check.explanation.includes(claimQuote));
const evidence=[
 {sourceId:'plan/chapters/33',quote:'212日18:30，杜与26章原配额台登记书吏核对本批最后一人退出记录，先离开的林亦有212日退出记录；19时书吏按原授权当面签收本批退出联、回收的准入符牌及未清事项，原登记台留存签收联，杜才撤本批临时接待桌。'},
 {sourceId:'plan/chapters/33',quote:'212日19时褚先接本批外营驻车的夜间护路，杜交清白班后休息；213日07时杜接回后出发。'},
 {sourceId:'plan/chapters/33',quote:'213–216返宗以白天慢车行路、夜间停营执行，不连夜赶车'},
 {sourceId:'plan/chapters/32',quote:'第214日日暮至第216日日暮；实体海程两昼夜'},
 {sourceId:'plan/chapters/33',quote:'林尚不知道这次返宗。'},
];
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===e.sourceId).text.includes(e.quote));
 const sent=request.sources.filter(s=>s.origin?.sourceId===e.sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>f.id));assert.equal(sent.length,1);return {...e,sent};
});
assert.deepEqual(actualSupport.map(e=>e.sent[0]),['e271','e271','e271','e266','e268']);
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-world-return-overlap',runId:run.id,stageId:stage.id,criterion:'geography',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
 explanation:'这里的“均发生在已抵赤霄之后”混淆了叙述顺序与事件时间。第33章回述的本批退出核验与撤临时桌在212日18:30—19时；返宗车队213日07时出发，213—216日按白天慢车、夜间停营执行。林辰的跨海是214日日暮至216日日暮，两条路线有并行时段，不能等林抵赤霄后才开始四日返宗。217日港口交接和之后的侧门调查属于抵港后行动，但不可把它们的日期套到回述的销班与返宗上。原文还明确林尚不知道返宗；不能由并行叙述生成即时消息。保留原地理局部pass和补读解决声明，本说明仅澄清评语范围，不移动行程、不缩短护送或休息、不改变人物知情。',evidence});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design76_world_return_overlap',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Independent clarification draft; no annotation append, verdict change or design mutation.'};
const out='docs/audits/2026-10-18-design76-world-return-overlap.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,returnDays:'213-216',voyageDays:'214-216',productionWrites:0}));
