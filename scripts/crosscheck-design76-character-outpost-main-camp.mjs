// Clarify the staged evidence compressed by a partial synthesis, using source quotations
// actually embedded in its parent reports as well as the immutable original input.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-notes25-review-segment-26.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath);assert.equal(terminal.segment,26);
try{process.kill(terminal.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const run=terminal.runs.find(r=>r.input.area==='characters'),stage=run.stages.find(s=>s.id==='synthesis-11');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const requestPath='data/audit-runtimes/design76-notes25-review/model-calls/00175.started.json',responsePath='data/audit-runtimes/design76-notes25-review/model-calls/00175.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.equal(raw.requestId,request.requestId);assert.deepEqual(stage.modelResponses,[read(responsePath).response.text]);
const parents=request.sources.filter(s=>s.id.startsWith('review-result/'));assert.deepEqual(parents.map(s=>s.id),['review-result/followup-cross-3-5/relationships','review-result/followup-cross-3-5/knowledge']);
const check=stage.result.checks.find(c=>c.criterion==='knowledge');assert.equal(check.verdict,'pass');
const claimQuote='林辰在第21章仅因秦禾当面证词获得前哨方向';assert.ok(check.explanation.includes(claimQuote));
const evidence=[
  {
    "sourceId": "story/chapterPlans/chapter-plan-21",
    "quote": "林辰与苏凌霜循残缺采集单找到前哨废料高台"
  },
  {
    "sourceId": "story/chapterPlans/chapter-plan-21",
    "quote": "秦禾当面说明主营方向与已走路线，只答应有限带路、送信，不承诺陪战。"
  },
  {
    "sourceId": "story/chapterPlans/chapter-plan-21",
    "quote": "秦已说明主营大致方向，尚未实核布局或辨清指挥者。"
  },
  {
    "sourceId": "story/secrets/sec_02",
    "quote": "秦禾亲历被扣，知道前哨方向；证词尚不能证明完整幕后指挥。"
  },
  {
    "sourceId": "story/secrets/sec_02",
    "quote": "亲见主营货台、囚笼和样箱，核四里路线；秦返回实报新点检哨与铃绳，两人又实见检修口被岩板堵死，指挥者仍未认出。"
  }
];
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===e.sourceId)?.text.includes(e.quote));
 const embedded=parents.flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>({parent:s.id,fragment:f.id})));
 assert.ok(embedded.length,'Quoted original not embedded in actual synthesis request');
 // Source headers and quotations may span adjacent fragments; preserve that fact.
 for(const item of embedded){const source=parents.find(s=>s.id===item.parent);assert.ok(source.fragments.map(f=>f.text).join('').includes('"sourceId":"'+e.sourceId+'"'));}
 return {...e,embedded};
});
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-character-outpost-main-camp',runId:run.id,stageId:stage.id,criterion:'knowledge',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
 explanation:"这里应区分已经抵达的前哨与秦禾提供方向的主营。21章先由林苏循残缺采集单找到前哨废料高台并救秦，之后秦才当面说明主营方向及已走路线；章末明确主营布局和指挥者仍未实核。22章实地勘查才亲见主营货台、囚笼、样箱并核路线，不能倒写为21章秦一开口便验证全部布局。原秘密档sec_02两人的21章belief仍使用“知道前哨方向”，未准确承接章纲中的新增主营线索，本次综合沿用了这处旧表述；因此不能以本项pass认定这条认知链已经完全一致。原答、pass及前置补读解决记录保留，原设定不在本说明中改写；另行离线候选须将林苏的21章认知与章纲统一，保留口述来源、有限知情及后章实核的先后关系。本次实际收到的是前置报告中的独立摘录，不是重新读取全部原档。",evidence});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design76_character_outpost_main_camp',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Identifies a stale original knowledge-stage field propagated into a partial synthesis. Only embedded parent quotations were sent; no annotation append, verdict change or design mutation.'};
const out='docs/audits/2026-10-18-design76-character-outpost-main-camp.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,sourceQuotes:evidence.length,productionWrites:0}));
