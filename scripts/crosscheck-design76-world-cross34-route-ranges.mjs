// Verify the chapter ranges in a saved review without changing its verdict.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-clarified-review-segment-16.json';
const verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);
assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath);
const run=terminal.runs.find(r=>r.input.area==='world');
const stage=run.stages.find(s=>s.id==='cross-3-4');
assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const control='data/audit-runtimes/design76-clarified-review';
const requestPath=control+'/model-calls/00084.started.json',responsePath=control+'/model-calls/00084.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.equal(raw.requestId,request.requestId);
assert.deepEqual(stage.modelResponses,[read(responsePath).response.text]);
const check=stage.result.checks.find(c=>c.criterion==='geography');
assert.equal(check.verdict,'insufficient');
const claimQuote='但这些路线的具体出发、验籍、交通、票款、供能和抵达动作位于第18—50章';
assert.ok(check.explanation.includes(claimQuote));
const ids=['plan/milestones/ms_growth_v1_expedition','plan/milestones/ms_growth_v1_crossing','plan/milestones/ms_v2_voyage','plan/milestones/ms_v3_return'];
const ranges=ids.map(id=>{
  const source=run.input.sources.find(s=>s.id===id);assert.ok(source);
  const value=JSON.parse(source.text);
  const quote=`"startChapter": ${value.startChapter},\n  "endChapter": ${value.endChapter}`;
  assert.ok(source.text.includes(quote));
  const sent=request.sources.filter(s=>s.origin?.sourceId===id).flatMap(s=>s.fragments.filter(f=>f.text.includes(quote)).map(f=>f.id));
  assert.equal(sent.length,1);
  return {sourceId:id,title:value.title,startChapter:value.startChapter,endChapter:value.endChapter,quote,sent};
});
assert.deepEqual(ranges.map(r=>[r.startChapter,r.endChapter]),[[19,22],[30,32],[54,60],[67,72]]);
const available=new Set(run.input.sources.map(s=>s.id));
const sentSources=new Set(request.sources.map(s=>s.origin?.sourceId??s.id));
assert.deepEqual(check.awaitingSources,Array.from({length:33},(_,i)=>`plan/chapters/${i+18}`));
assert.ok(check.awaitingSources.every(id=>available.has(id)&&!sentSources.has(id)));
const annotationInput=addDesignReviewAnnotationSchema.parse({
  requestKey:'design76-world-cross34-route-ranges',runId:run.id,stageId:stage.id,criterion:'geography',
  expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
  explanation:'第18—50章待补读只覆盖已展开的前段行动，不能覆盖前句所列全部跨陆路线。已发送的里程碑明确：古境行程为19—22章，青玄南渡赤霄为30—32章；赤霄赴苍冥北航为54—60章，北境返青玄为67—72章。后两段应据现有宏观原文审查，不应写成发生于18—50章，也不能认为补读18—50章就完成后两段执行核验。保留原insufficient和33份真实存在、当次未发送的待补读细纲，不新增后半本细纲要求；本说明仅纠正章号范围，不证明任何路线的资格、费用或行程已经通过。',
  evidence:ranges.map(({sourceId,quote})=>({sourceId,quote})),
});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design76_world_cross34_route_ranges',verificationPath,verificationSha256:sha(verificationPath),
  bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),
  runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,
  ranges,awaitingSourcesVerified:check.awaitingSources,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,
  limitation:'Independent clarification draft only. The original verdict and pending readings remain unchanged; no annotation has been appended by this script.'};
const out='docs/audits/2026-10-18-design76-world-cross34-route-ranges.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);
else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,ranges:ranges.map(r=>[r.startChapter,r.endChapter]),pendingSources:check.awaitingSources.length,productionWrites:0}));
