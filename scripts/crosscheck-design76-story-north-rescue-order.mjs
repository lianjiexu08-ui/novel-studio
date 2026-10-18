// Check the saved causal review against the chronology in its actual request.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-notes17-review-segment-18.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath),run=terminal.runs.find(r=>r.input.area==='story'),stage=run.stages.find(s=>s.id==='followup-batch-1/causality');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const requestPath='data/audit-runtimes/design76-notes17-review/model-calls/00102.started.json',responsePath='data/audit-runtimes/design76-notes17-review/model-calls/00102.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.equal(raw.requestId,request.requestId);assert.deepEqual(stage.modelResponses,[read(responsePath).response.text]);
const check=stage.result.checks.find(c=>c.criterion==='causality');assert.equal(check.verdict,'pass');
const claimQuote='依次推进七人救援与候查安置、北航、黑舱取舍';assert.ok(check.explanation.includes(claimQuote));
const evidence=[
 {sourceId:'plan/milestones/ms_v2_voyage',quote:'"startChapter": 54,\n  "endChapter": 60'},
 {sourceId:'plan/milestones/ms_v2_voyage',quote:'276日暮离港、281日暮抵葬骨外港，五昼夜完整航程。'},
 {sourceId:'plan/milestones/ms_v2_boundary',quote:'"startChapter": 61,\n  "endChapter": 66'},
 {sourceId:'plan/milestones/ms_v2_boundary',quote:'第64章的实际转运在第291日，285日只是夜抵港会面，不把两日混为同一场。夜要先封存污染货并救出七名被扣在普通货舱的青玄矿工；林在仍可追程的小艇与先开囚舱之间选择救人。'},
 {sourceId:'plan/milestones/ms_v2_boundary',quote:'七人在原定衣符、短板和保温救助舟条件下，由原陪护港卫随实际批次交到同一监管泊区内的候查暖房'},
 {sourceId:'plan/milestones/ms_v2_boundary',quote:'7名矿工上岸、与5名已在赤霄获救的雇工名单分开'},
];
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===e.sourceId).text.includes(e.quote));
 const sent=request.sources.filter(s=>s.origin?.sourceId===e.sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>f.id));assert.equal(sent.length,1);return {...e,sent};
});
assert.ok(281<291);
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-story-north-rescue-order',runId:run.id,stageId:stage.id,criterion:'causality',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
 explanation:'原解释把“七人救援与候查安置”列在北航之前，顺序不符实际发送的里程碑。第54—60章先北航：276日暮离港、281日暮抵葬骨外港；第61—66章才展开黑舱行动，其中第64章291日救出七名青玄籍矿工，随后由港卫按实际批次交入同一监管泊区内的候查暖房。林放弃追程、取第二片而先救人，属于这次291日行动中的选择，不是另一个先于北航的救援。北境七人与此前赤霄获救的五名雇工须分开，不能混算或重复救援。保留原局部pass及补读解决声明；本说明只纠正评语列举的先后，不搬移里程碑、不改写原日历，也不代表全部因果或全书设计已验收。',evidence});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design76_story_north_rescue_order',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Independent clarification draft; no annotation append, verdict change or design mutation.'};
const out='docs/audits/2026-10-18-design76-story-north-rescue-order.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,sourceCount:actualSupport.length,productionWrites:0}));
