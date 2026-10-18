// Clarify the new world review without changing correct voyage dates or old verdicts.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design77-shared-review-segment-1.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath);assert.equal(terminal.segment,1);
try{process.kill(terminal.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const run=terminal.runs.find(r=>r.input.area==='world'),stage=run.stages.find(s=>s.id==='batch-2');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design77-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const base='data/audit-runtimes/design77-shared-review/model-calls/';
const requestPath=base+'00006.started.json',responsePath=base+'00007.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.equal(raw.requestId,request.requestId);assert.deepEqual(stage.modelResponses,[read(base+'00006.response.json').response.text,read(responsePath).response.text]);
const check=stage.result.checks.find(c=>c.criterion==='geography');assert.equal(check.verdict,'insufficient');
const claimQuote='第275—281日五昼夜北航';assert.ok(check.explanation.includes(claimQuote));
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
assert.ok(actualSupport.every(e=>e.sent.length===1));
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design77-world-batch2-north-voyage-dates',runId:run.id,stageId:stage.id,criterion:'geography',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
 explanation:"评语将购票日压缩进海程。当前原文是271—274日沿岸陆路到极焱，275日购两张保温客舱票，276日暮离港、281日暮抵葬骨；实际海上航行为五昼夜。第275—281日包含购票与准备，不能整体当作五昼夜海程，不能据此把启航提前到275日或把航程改为六昼夜。正常航期仍以实际登船核验及持续供暖为前提，延期需重排日期。本说明只澄清评语中的时间压缩，保留原insufficient、全部awaitingSources及两份原始回答，不更改章纲或其他时序结论。",evidence});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design77_world_batch2_north_voyage_dates',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Independent clarification draft; does not append an annotation, change a verdict or mutate the design.'};
const out='docs/audits/2026-10-18-design77-world-batch2-north-voyage-dates.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,sourceQuotes:evidence.length,productionWrites:0}));
