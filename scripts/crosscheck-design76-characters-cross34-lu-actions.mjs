// Separate the brothers’ two actions without replacing the accepted model judgment.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const control='data/audit-runtimes/design76-advice-review';
const verificationPath='docs/audits/2026-10-18-design76-capacity-review-segment-11.json',verification=read(verificationPath);
assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const prior=read(verification.checkpointPath),run=prior.runs.find(r=>r.input.area==='characters'),stage=run.stages.find(s=>s.id==='cross-3-4');
assert.equal(stage.result,undefined);
const bindingPath='data/audit-runtimes/design76-citation-unique-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {designReviewStageInput}=await import(binding.runtimePath+'/novel-service-core/src/design-review-run.ts');
const {prepareDesignReviewEvidence}=await import(binding.runtimePath+'/packages/planner/src/design-review-evidence.ts');
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const requestPath=control+'/model-calls/00074.started.json',responsePath=control+'/model-calls/00074.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
const prepared=prepareDesignReviewEvidence(designReviewStageInput(run,stage));assert.equal(request.requestId,prepared.requestId);assert.deepEqual(request.sources,prepared.sources);
const result=prepared.resolve(raw),check=result.checks.find(c=>c.criterion==='agency');assert.equal(check.verdict,'pass');
assert.ok(check.explanation.includes('陆沉川主动交条并承认本次押送'));
const current=read(control+'/result.json'),acceptedRun=current.runs.find(r=>r.id===run.id),accepted=acceptedRun.stages.find(s=>s.id===stage.id);
assert.deepEqual(accepted.result,result);assert.deepEqual(accepted.modelResponses,[read(responsePath).response.text]);
const evidence=[
 {sourceId:'story/characters/char_16',quote:'"name": "陆沉舟"'},
 {sourceId:'story/characters/char_21',quote:'"name": "陆沉川"'},
 {sourceId:'plan/chapters/49',quote:'沉川主动交条、当面拒绝离港并说出亲见；陆走入有巡员的岗房，接受看护，再把亲走入口交出。'},
 {sourceId:'plan/chapters/50',quote:'吴指认陆曾把他们点交到这里，陆当着巡员承认，不再用认路掩盖押送。'},
];
const chapter50=JSON.parse(run.input.sources.find(s=>s.id==='plan/chapters/50').text);
assert.ok(chapter50.characterIds.includes('char_16'));assert.ok(!chapter50.characterIds.includes('char_21'));
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===e.sourceId).text.includes(e.quote));
 const sent=request.sources.filter(s=>(s.origin?.sourceId??s.id)===e.sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>({fragmentId:f.id})));
 assert.equal(sent.length,1);return {...e,sent};
});
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-characters-cross34-lu-actions',runId:run.id,stageId:stage.id,criterion:'agency',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),
 claimQuote:'陆沉川主动交条并承认本次押送',
 explanation:'这句把两兄弟分别作出的选择合给了陆沉川。第49章主动交条、拒绝离港的是弟弟陆沉川（char_21）；第50章被吴伍指认后承认本次点交押送的是哥哥、旧押运头目陆沉舟（char_16）。第50章人物清单含char_16而不含char_21，同次请求也实际提供了两人的姓名档案。不能把整句一律改成哥哥，交条仍是弟弟的行为；应分别保留两人的选择、知情与责任。原模型原话和agency局部pass保留，这条说明不认定关系或秘密已通过，也不把尚待核实的220夜完整改签内容补给任何人。',evidence});
annotationSources({designReviewRuns:new Map([[acceptedRun.id,acceptedRun]])},annotationInput);
const proof={kind:'design76_characters_cross34_lu_actions',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),
 requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,observedAcceptedStageSha256:hash(accepted),originalCheckHash:designReviewCheckHash(check),originalCheck:check,
 chapter50CharacterIds:chapter50.characterIds,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,
 limitation:'Draft independent clarification only. Exact source presence is not full semantic acceptance. Requires segment terminal verification and private append/restart rehearsal before publication.'};
const out='docs/audits/2026-10-18-design76-characters-cross34-lu-actions.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,actionsSeparated:true,actualSupportQuotes:actualSupport.length,productionWrites:0,formalAcceptance:false}));
