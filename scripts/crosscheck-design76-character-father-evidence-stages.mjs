// Clarify the staged evidence compressed by a partial synthesis, using source quotations
// actually embedded in its parent reports as well as the immutable original input.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-notes24-review-segment-25.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath);assert.equal(terminal.segment,25);
try{process.kill(terminal.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const run=terminal.runs.find(r=>r.input.area==='characters'),stage=run.stages.find(s=>s.id==='synthesis-9');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const requestPath='data/audit-runtimes/design76-notes24-review/model-calls/00167.started.json',responsePath='data/audit-runtimes/design76-notes24-review/model-calls/00167.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.equal(raw.requestId,request.requestId);assert.deepEqual(stage.modelResponses,[read(responsePath).response.text]);
const parents=request.sources.filter(s=>s.id.startsWith('review-result/'));assert.deepEqual(parents.map(s=>s.id),['review-result/followup-cross-2-4/knowledge','review-result/followup-cross-2-5/relationships']);
const check=stage.result.checks.find(c=>c.criterion==='knowledge');assert.equal(check.verdict,'pass');
const claimQuote='sec_01限定林辰在第1—32章仅怀疑父案关联';assert.ok(check.explanation.includes(claimQuote));
const evidence=[
  {
    "sourceId": "story/secrets/sec_01",
    "quote": "只有家传笔记和残玉与父亲有关，未确认守门或投毒经过。"
  },
  {
    "sourceId": "story/secrets/sec_01",
    "quote": "父亲曾参与守门工作的证据来自署名图纸和撤离记录；尚不知父案全貌。"
  },
  {
    "sourceId": "story/secrets/sec_01",
    "quote": "第18章179日，凭顾新签的限时调阅单，林苏共同核对韩叙交接的实物记录。"
  },
  {
    "sourceId": "story/secrets/sec_01",
    "quote": "残片刻痕可与旧图对应，为追查收货链提供线索，未得到过去的完整影像。"
  },
  {
    "sourceId": "story/secrets/sec_01",
    "quote": "不知九鼎全阵、父案投毒全貌或门外死渊"
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
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-character-father-evidence-stages',runId:run.id,stageId:stage.id,criterion:'knowledge',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
 explanation:"“第1—32章仅怀疑父案关联”压平了这段期间已经发生的证据变化。sec_01的suspects仍表示父案全貌未明，不表示每个局部事实都只有无证猜测：13—17章只有家传物与有限信息，18章179日林苏已凭限时调阅单核对韩叙交接的署名图纸和撤离记录，获得父亲参与守门的具体依据；27—32章又以实际残片刻痕和旧图对应追查收货链。上述原文以独立摘录实际嵌在本次前置报告中。本说明保留原suspects标签、原局部pass和未知边界，不将父案全貌、投毒、九鼎全阵或门外景象提前确认为已知；同时不得因为概括为“仅怀疑”而撤回18章已取得的局部证据或重复安排首次发现。这里只补明被概括省去的证据阶段，不声称本次综合重读了完整原档或通过全局验收。",evidence});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design76_character_father_evidence_stages',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Clarifies compressed evidence stages without upgrading the original suspects certainty label. Only embedded parent quotations were sent; no annotation append, verdict change or design mutation.'};
const out='docs/audits/2026-10-18-design76-character-father-evidence-stages.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,sourceQuotes:evidence.length,productionWrites:0}));
