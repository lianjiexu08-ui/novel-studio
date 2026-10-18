// Separate the coastal approach and ticket purchase from the five-day sea voyage.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-notes24-review-segment-25.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath);assert.equal(terminal.segment,25);
try{process.kill(terminal.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const run=terminal.runs.find(r=>r.input.area==='story'),stage=run.stages.find(s=>s.id==='followup-cross-1-2/timeline');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const base='data/audit-runtimes/design76-notes24-review/model-calls/';
const requestPath=base+'00164.started.json',responsePath=base+'00164.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.equal(raw.requestId,request.requestId);assert.deepEqual(stage.modelResponses,[read(responsePath).response.text]);
const check=stage.result.checks.find(c=>c.criterion==='timeline');assert.equal(check.verdict,'pass');assert.ok(check.resolves.includes('cross-1-2/timeline'));
const claimQuote='271—281日五昼夜北航';assert.ok(check.explanation.includes(claimQuote));
const evidence=[
  {
    "sourceId": "plan/milestones/ms_v2_voyage",
    "quote": "第271–274日乘普通车沿每日复核开放的既有沿岸驿道从天宝外港到极焱天港"
  },
  {
    "sourceId": "plan/milestones/ms_v2_voyage",
    "quote": "第275日贺在极焱航司柜台按本航次实报5000/人支付10000，购买两张普通保温客舱票"
  },
  {
    "sourceId": "plan/milestones/ms_v2_voyage",
    "quote": "276日暮离港、281日暮抵葬骨外港，五昼夜完整航程。"
  },
  {
    "sourceId": "plan/milestones/ms_v2_voyage",
    "quote": "原276—281航期仅适用于本次五日供暖实际持续的正常路径。"
  },
  {
    "sourceId": "plan/milestones/ms_v2_voyage",
    "quote": "延期就改签并重排后续日期和实际费用，不能保持原抵达日。"
  }
];
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===e.sourceId).text.includes(e.quote));
 const sent=request.sources.filter(s=>s.origin?.sourceId===e.sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>f.id));assert.equal(sent.length,1);return {...e,sent};
});
assert.deepEqual(actualSupport.map(e=>e.sent[0]),["e123","e123","e123","e126","e125"]);
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-story-north-voyage-dates',runId:run.id,stageId:stage.id,criterion:'timeline',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
 explanation:"此处将北行准备和陆路日期并入了海程。原文是271—274日沿岸陆路到极焱，275日实际购买两张保温客舱票，276日暮离港、281日暮抵葬骨，海上航行恰为五昼夜；271—281日不能整体称为五昼夜北航。271日拨款、陆路放行和275日购票均不代表已经启航，也不能将276日提前到271日，或把五昼夜改成十昼夜。该航期还以实际登船核验和持续供暖为条件，延期须改签并重排后续日期。本说明只校正评语中的出发日期及陆海阶段划分，保留原局部pass、cross-1-2/timeline补读解决声明与原始回答，不改原章纲、不代表其他时序和角色认知矛盾已经解决。",evidence});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design76_story_north_voyage_dates',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Independent clarification draft; does not append an annotation, change a verdict or mutate the design.'};
const out='docs/audits/2026-10-18-design76-story-north-voyage-dates.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,sourceQuotes:evidence.length,productionWrites:0}));
