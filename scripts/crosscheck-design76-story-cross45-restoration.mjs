// Check the alleged balance conflict; never overwrite the original revise verdicts.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-notes16-review-segment-17.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath),run=terminal.runs.find(r=>r.input.area==='story'),stage=run.stages.find(s=>s.id==='cross-4-5');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const requestPath='data/audit-runtimes/design76-notes16-review/model-calls/00097.started.json',responsePath='data/audit-runtimes/design76-notes16-review/model-calls/00097.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.equal(raw.requestId,request.requestId);assert.deepEqual(stage.modelResponses,[read(responsePath).response.text]);
const evidence=[
 {sourceId:'plan/chapters/30',quote:'轻柄一次按半成扣，保守余量六成减至五成半；驿站实际完成两小时不施术静息后，仅记回半成至伤后上限六成，不把温养写成伤愈。'},
 {sourceId:'plan/chapters/32',quote:'拉索头和松小楔分别是一次轻物御动，各扣半成，共一成；由六成降至五成。后续日常休整不自动记满，直到下一次复测才增加可用账面数。'},
 {sourceId:'plan/chapters/42',quote:'此次缓慢试注共耗半成，余四成半。试船之前另在原住处完成一小时不受扰温和吐纳，复测只记回半成至伤后上限五成，再赴码头；此后至244出剑前未再施术。'},
 {sourceId:'plan/chapters/43',quote:'凝元伙计一次送钩支出半成真元，自身保守余量五成降至四成半，钩挂稳即停术；后续拖力由船行、普通索具和艉桩承担'},
 {sourceId:'plan/chapters/44',quote:'出剑前沿用239日复测的保守余量五成，一式二成后余三成；二成已含剑的供能，之后不再御物，浮圈用手递。'},
];
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===e.sourceId).text.includes(e.quote));
 const sent=request.sources.filter(s=>s.origin?.sourceId===e.sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>f.id));assert.equal(sent.length,1);return {...e,sent};
});
const calculations=[{chapter:30,actor:'林辰',start:6,changes:[-0.5,0.5],end:6},{chapter:32,actor:'林辰',start:6,changes:[-0.5,-0.5],end:5},{chapter:42,actor:'林辰',start:5,changes:[-0.5,0.5],end:5},{chapter:43,actor:'送钩伙计',start:5,changes:[-0.5],end:4.5},{chapter:44,actor:'林辰',start:5,changes:[-2],end:3}];
for(const c of calculations)assert.equal(c.changes.reduce((n,v)=>n+v,c.start),c.end);
const claims={causality:'第32章又把两次各半成支出写成“由六成降至五成”，忽略第30章已扣的一次半成。',timeline:'第30章第212—213日已发生一次半成御物并收束到五成半，第32章第215日却按六成起算两次半成'};
for(const[criterion,claimQuote]of Object.entries(claims)){
 const check=stage.result.checks.find(c=>c.criterion===criterion);assert.equal(check.verdict,'revise');assert.ok(check.explanation.includes(claimQuote));
 const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:`design76-story-cross45-${criterion}-restoration`,runId:run.id,stageId:stage.id,criterion,expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
  explanation:'这项余额冲突指控漏读了同次请求e353中紧接扣款的实际恢复记录。第30章六成−半成＋驿站两小时静息恢复半成＝六成；第32章两次御物各扣半成后为五成。第42章239日沿用五成，试注扣半成、另完成一小时不受扰吐纳并复测只回半成，仍为五成；第44章完整剑诀再扣二成后为三成。第43章送钩的五成降四成半属于另一名凝元伙计，不属于林辰。原文已写恢复时段和伤后上限，不能据该评语再增加一次恢复、删除原有支出或把伙计与林混账。此核对仅否定所指30—44章余额断裂，不证明其他伤情、术式或全书预算都通过；原revise、返修建议和原答继续保留，不在此改判或关闭问题。',evidence});
 annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
 const proof={kind:`design76_story_cross45_${criterion}_restoration`,verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,actualSupport,calculations,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Independent factual clarification; original revise verdict and advice remain. No automatic resolution or design repair.'};
 const out=`docs/audits/2026-10-18-design76-story-cross45-${criterion}-restoration.json`;
 if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({verified:true,checks:2,calculations:5,productionWrites:0}));
