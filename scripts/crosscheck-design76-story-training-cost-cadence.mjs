// Clarify one saved growth-review sentence using only its actual sent sources.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-notes18-review-segment-20.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath);assert.equal(terminal.segment,20);
try{process.kill(terminal.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const run=terminal.runs.find(r=>r.input.area==='story'),stage=run.stages.find(s=>s.id==='followup-batch-1/growth');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const requestPath='data/audit-runtimes/design76-notes18-review/model-calls/00121.started.json',responsePath='data/audit-runtimes/design76-notes18-review/model-calls/00121.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.equal(raw.requestId,request.requestId);assert.deepEqual(stage.modelResponses,[read(responsePath).response.text]);
const check=stage.result.checks.find(c=>c.criterion==='growth');assert.equal(check.verdict,'pass');assert.ok(check.resolves.includes('batch-1/growth'));
const claimQuote='每日灵石与复诊';assert.ok(check.explanation.includes(claimQuote));
const evidence=[
 {sourceId:'world/techniques/tech_19',quote:'每个十日周期实际消耗一枚下品青灵石的导引灵气并占用每日一小时静修'},
 {sourceId:'world/techniques/tech_19',quote:'本卷一次失败加六个有效周期实际共耗七枚，耗材开封即扣，失败或中断不返。'},
 {sourceId:'plan/milestones/ms_v3_training',quote:'每周期开始前和结束后都由白榆当面复查肩伤、经脉流向、余量及回流'},
 {sourceId:'plan/milestones/ms_v3_training',quote:'六个有效周期60日，加失败4日，实耗七枚；398日完整静置一日，399–414日只做复诊、稳定观察和获准的空载复测。'},
 {sourceId:'plan/milestones/ms_v3_training',quote:'330日实领后，3枚偿付316–329药舍普通食宿及常规复诊的既有约定欠款，14枚按药舍本次约定预付330–415普通食宿和上述常规复查，剩余7枚完整灵石验纯后单独入训练库存，不再交易或抵费。'},
];
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===e.sourceId).text.includes(e.quote));
 const sent=request.sources.filter(s=>s.origin?.sourceId===e.sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>f.id));assert.equal(sent.length,1);return {...e,sent};
});
assert.deepEqual(actualSupport.map(e=>e.sent[0]),['e118','e118','e307','e307','e308']);
assert.equal(24-3-14,7);assert.equal(6+1,7);
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-story-training-cost-cadence',runId:run.id,stageId:stage.id,criterion:'growth',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
 explanation:'原解释“每日灵石与复诊”混淆了耗材、静修与诊察的频率。tech_19是每个十日周期消耗一枚下品青灵石、每日一小时静修；本次六个有效周期加351—354日失败的已开封周期，共耗七枚，不是每日一枚或60枚。常规医修复查按执行卡在每周期开始前和结束后进行，失败即检查停训、复练另须许可；398日静置，399—414日进行复诊、稳定观察与获准空载复测，不能凭该评语添加全程每日复诊。24枚劳务现金已经分配为3枚旧欠、14枚预付食宿及上述常规复查、7枚训练耗材；异常新增治疗另核费用，不挪已消耗库存。原成长线局部pass和原补读解决声明保留，本说明只澄清评语单位与频率，不改变功法、预算、训练日程、晋阶条件或任何全局阻塞。',evidence});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design76_story_training_cost_cadence',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,actualSupport,costs:{cash:24,oldDebt:3,prepaidLodgingAndChecks:14,trainingStones:7,effectiveCycles:6,failedOpenedCycles:1},annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Independent clarification draft; no annotation append, verdict change or design mutation.'};
const out='docs/audits/2026-10-18-design76-story-training-cost-cadence.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,trainingStones:7,productionWrites:0}));
