// Preserve original verdicts while binding two recurring summary errors to actual input excerpts.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-notes29-review-segment-30.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath);assert.equal(terminal.segment,30);
try{process.kill(terminal.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const cases=[
 {number:211,area:'power',stageId:'synthesis-6',criterion:'tiers',verdict:'revise',name:'power-synthesis6-training-scope',
 claimQuote:'当前综合提供的原始计划片段也未直接呈现这些细节。',
 explanation:'这一步没有重新发送完整训练与晋阶里程碑，但实际请求中已有前置报告嵌入的独立原文摘录，并非只有另一报告的结论。e57逐字包含训练执行卡：六个有效周期60日、一次失败4日、七枚灵石，逐周期医修复查、异常停训及延期；e47逐字包含完成六周期、静置观察、白榆诊察、顾峤复核后才支付十元载的顺序。这些摘录可与本任务保存的原始里程碑逐字对应。因此，保留cross-2-4的历史返修不等于证明完整宏观设计缺少这些前置；本项成本解释中的同类缺料概括也须按此范围阅读。原tiers/costs返修均保留，本说明不代替完整预算复审、不撤销其他法宝缺陷、不批准设计或正文。',
 evidence:[
 {sourceId:'plan/milestones/ms_v3_training',quote:'六个有效周期60日，加失败4日，实耗七枚'},
 {sourceId:'plan/milestones/ms_v3_training',quote:'每次未通过立即停，不把上次许可无限沿用。'},
 {sourceId:'plan/milestones/ms_v3_training',quote:'所有日期是正常复诊通过的候选路径，任何异常或耗材不足均顺延训练、415日拟晋阶及后续参战资格，不能追赶固定日期。'},
 {sourceId:'plan/milestones/ms_v3_advancement',quote:'六个有效周期完成→静置观察→白榆诊察→顾峤复核→十元载扣除'},
 ]},
 {number:213,area:'story',stageId:'synthesis-3',criterion:'timeline',verdict:'pass',name:'story-synthesis3-voyage-scope',
 claimQuote:'后段宏观给出271—281日五昼夜北航',
 explanation:'271—281日覆盖领款、陆路、买票和海程，不能全部称为五昼夜海程。同次实际请求e38的原文摘录明确271日领取专项航款，271—274日乘普通车从天宝外港到极焱天港；e39明确275日支付两张保温客舱票，276日暮离港、281日暮抵葬骨外港，海程才是五昼夜。这些摘录均可与本任务原始ms_v2_voyage逐字对应。历史补读处理记录的同类缩写不能覆盖原文日期。本说明只纠正评语中阶段与海程的混称，不修改任何出发日、到港日、费用或人员路线；原timeline局部pass保留，不据此认定后半细纲、正文或全书已通过。',
 evidence:[
 {sourceId:'plan/milestones/ms_v2_voyage',quote:'第271日商盟港务理事会为追缴被挪货与避免北境封港，从本案追偿周转款实拨14000枚下品灵石给具名领款的贺青梧'},
 {sourceId:'plan/milestones/ms_v2_voyage',quote:'第271–274日乘普通车沿每日复核开放的既有沿岸驿道从天宝外港到极焱天港'},
 {sourceId:'plan/milestones/ms_v2_voyage',quote:'第275日贺在极焱航司柜台按本航次实报5000/人支付10000，购买两张普通保温客舱票'},
 {sourceId:'plan/milestones/ms_v2_voyage',quote:'276日暮离港、281日暮抵葬骨外港，五昼夜完整航程。'},
 ]},
];
for(const item of cases){
 const run=terminal.runs.find(r=>r.input.area===item.area),stage=run.stages.find(s=>s.id===item.stageId);
 const base=`data/audit-runtimes/design76-notes29-review/model-calls/${String(item.number).padStart(5,'0')}`;
 const requestPath=base+'.started.json',responsePath=base+'.response.json',request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
 assert.equal(raw.requestId,request.requestId);assert.deepEqual(stage.modelResponses,[read(responsePath).response.text]);
 const check=stage.result.checks.find(c=>c.criterion===item.criterion);assert.equal(check.verdict,item.verdict);assert.ok(check.explanation.includes(item.claimQuote));
 const actualSupport=item.evidence.map(e=>{
  assert.ok(run.input.sources.find(s=>s.id===e.sourceId).text.includes(e.quote));
  const sent=request.sources.filter(s=>s.id.startsWith('review-result/')).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>({sourceId:s.id,fragmentId:f.id})));
  assert.ok(sent.length);return {...e,sent};
 });
 const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-'+item.name,runId:run.id,stageId:stage.id,criterion:item.criterion,expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote:item.claimQuote,explanation:item.explanation,evidence:item.evidence});
 annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
 const proof={kind:'design76_'+item.name.replaceAll('-','_'),runnerSha256:sha(process.argv[1]),verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Independent clarification draft based on original excerpts embedded in parent reports; no complete source reread, verdict change or design mutation.'};
 const out=`docs/audits/2026-10-18-design76-${item.name}.json`;
 if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({verified:true,annotations:cases.length,productionWrites:0}));
