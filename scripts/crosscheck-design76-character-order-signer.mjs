// Clarify the signer omitted by a partial synthesis, using source quotations
// actually embedded in its parent reports as well as the immutable original input.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-notes21-review-segment-22.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath);assert.equal(terminal.segment,22);
try{process.kill(terminal.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const run=terminal.runs.find(r=>r.input.area==='characters'),stage=run.stages.find(s=>s.id==='synthesis-3');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const requestPath='data/audit-runtimes/design76-notes21-review/model-calls/00142.started.json',responsePath='data/audit-runtimes/design76-notes21-review/model-calls/00142.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.equal(raw.requestId,request.requestId);assert.deepEqual(stage.modelResponses,[read(responsePath).response.text]);
const parents=request.sources.filter(s=>s.id.startsWith('review-result/'));assert.deepEqual(parents.map(s=>s.id),['review-result/batch-5','review-result/cross-1-2']);
const check=stage.result.checks.find(c=>c.criterion==='agency');assert.equal(check.verdict,'pass');
const claimQuote='祁嵩为保留亲签原令和申辩机会而停斗交械';assert.ok(check.explanation.includes(claimQuote));
const evidence=[
 {sourceId:'plan/milestones/ms_v3_convoy',quote:'他权衡后选择当场保全赵亲签原令与受押者，保留日后逐级申辩的机会'},
 {sourceId:'story/secrets/sec_02',quote:'确认自己433亲签本批撤人毁页令，但尚未收到该令的交付回执或押运败报。'},
 {sourceId:'story/secrets/sec_02',quote:'92章435祁签收是下属场景，95章被截原令不隔空进入赵认知。'},
 {sourceId:'plan/milestones/ms_v3_convoy',quote:'将随身原令亲交苏在见证员面前收存，接受顾监管'},
 {sourceId:'story/arcBeats/message-withdraw-seized',quote:'顾不承诺免罪，祁仍须回答本人具名接押与毁页责任。'},
];
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===e.sourceId)?.text.includes(e.quote));
 const embedded=parents.flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>({parent:s.id,fragment:f.id})));
 assert.ok(embedded.length,'Quoted original not embedded in actual synthesis request');
 // Source headers and quotations may span adjacent fragments; preserve that fact.
 for(const item of embedded){const source=parents.find(s=>s.id===item.parent);assert.ok(source.fragments.map(f=>f.text).join('').includes('"sourceId":"'+e.sourceId+'"'));}
 return {...e,embedded};
});
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-character-order-signer',runId:run.id,stageId:stage.id,criterion:'agency',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
 explanation:'这里省略了“亲签原令”的签发人，应明确为“保留赵玄极亲签的原令”。433日签发本批撤人毁页令的是赵，435日祁嵩是签收、执行的下属；祁自己的具名接押报告与赵签发的撤押原令不是同一文书。436日祁为保全赵的原令和受押者、保留申辩机会而命停斗、交械，随后亲手交苏封存；亲手交出不等于亲自签发。祁仍须承担本人接押和毁页责任，赵的签发责任也不能因下属交令而转移或消失。原局部pass与前置报告保留。本说明只补明省略的主语，不改变停斗先后、持物、角色动机或既有责任，也不将第三次局部综合当作全局验收。',evidence});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design76_character_order_signer',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Clarifies an omitted signer rather than asserting an explicit contrary signer claim. The synthesis saw embedded parent quotations, not complete original sources. No annotation append, verdict change or design mutation.'};
const out='docs/audits/2026-10-18-design76-character-order-signer.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,sourceQuotes:evidence.length,productionWrites:0}));
