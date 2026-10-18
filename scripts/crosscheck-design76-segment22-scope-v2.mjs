// Independently bind selected semantic checks to the exact segment22 requests.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const control='data/audit-runtimes/design76-notes21-review';
const verificationPath='docs/audits/2026-10-18-design76-notes21-review-segment-22.json',verification=read(verificationPath),state=read(verification.checkpointPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);assert.equal(state.segment,22);
try{process.kill(state.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
function call(number){
 const base=`${control}/model-calls/${String(number).padStart(5,'0')}`,requestPath=base+'.started.json',responsePath=base+'.response.json';
 const started=read(requestPath),response=read(responsePath),payload=JSON.parse(started.request.user),request=payload.originalRequest??payload;
 const raw=JSON.parse(response.response.text),run=state.runs.find(r=>r.id===started.step.runId),stage=run.stages.find(s=>s.id===started.step.stageId);
 assert.ok(stage.result);assert.ok(stage.modelResponses.includes(response.response.text));
 return {number,requestPath,responsePath,requestSha256:sha(requestPath),responseSha256:sha(responsePath),payload,request,raw,run,stage};
}
const calls=Array.from({length:state.totalCalls-134},(_,i)=>call(i+135)),get=n=>calls.find(c=>c.number===n);
function support(number,sourceId,quote){
 const c=get(number);assert.ok(c.run.input.sources.find(s=>s.id===sourceId)?.text.includes(quote));
 const fragments=c.request.sources.filter(s=>s.origin?.sourceId===sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(quote)).map(f=>f.id));
 assert.ok(fragments.length,`Source not actually sent: ${number} ${sourceId}`);return {number,sourceId,quote,fragments};
}
function supportEmbedded(number,sourceId,quote){
 const c=get(number);assert.ok(c.run.input.sources.find(s=>s.id===sourceId)?.text.includes(quote));
 const embedded=c.request.sources.filter(s=>s.id.startsWith('review-result/')).flatMap(s=>s.fragments.filter(f=>f.text.includes(quote)).map(f=>({parent:s.id,fragment:f.id})));
 assert.ok(embedded.length);return {number,sourceId,quote,embedded,scope:'Original quotation embedded in a partial parent report, not a complete original-source reading.'};
}
const evidence=[
 support(135,'world/locations/loc_21','同一天地内的虚海航网，不穿越太古界门'),
 support(135,'world/locations/loc_21','苍冥通天渡口至青玄沧溟古港约六日实体海程'),
 support(135,'plan/chapters/35','两人完成眼前分工后才问沉川，把目标放回实际领箱者而非无根据的箱影。'),
 support(137,'plan/chapters/18','176日复测只证明两丈内可见目标导刃和主动停式'),
 support(137,'plan/chapters/20','10−2−0.5+1.5=9成'),
 support(137,'plan/chapters/25','林真元以8.5−2−0.5=6成承接，不重复扣21章成本；顾0.25元载属于顾，不记到林寿储。'),
 support(137,'plan/milestones/ms_v3_training','六个有效周期60日，加失败4日，实耗七枚'),
 support(137,'plan/milestones/ms_v3_advancement','六个有效周期完成→静置观察→白榆诊察→顾峤复核→十元载扣除'),
 support(139,'plan/chapters/17','苏只为公开调令、伤势记录和图纸交接程序担保，不为残玉作证。'),
 support(139,'plan/chapters/45','章末唐仍按习惯铺了五个人的位置，空着的两处使救援的胜利第一次显出缺口。'),
 support(139,'plan/chapters/50','五名雇工至此全部脱控；被谁雇用、为谁作证，仍由他们自己回答。'),
 support(139,'plan/chapters/50','林未施术，保守余量三成半，旧伤许可不变'),
 support(140,'world/historicalEvents/event_14','历史约页不是当前库存或已付船票。'),
 support(140,'story/relationships/rel_06','不能把程收令当炎煞也收令，不能认定炎煞知本港火仓和北境结果。'),
 support(140,'plan/milestones/ms_v3_training','赵只按利己口供登记，核欠账后到80章410日才正式选择本地短途重整'),
 support(141,'plan/milestones/ms_v3_training','剩余7枚完整灵石验纯后单独入训练库存，不再交易或抵费。'),
 support(141,'plan/milestones/ms_v3_training','现金24枚与课程是同一合同的两个报酬项，不把一份劳务再次换出第二笔钱'),
 supportEmbedded(142,'plan/milestones/ms_v3_return','315日两人当面交换材料，梁九拒绝让林拿家人作诱饵。'),
 supportEmbedded(142,'plan/milestones/ms_v3_training','夜至此才知道林贺304日按期离开苍冥'),
 support(143,'plan/chapters/42','现在能进去，不等于接到人后能出来。'),
 support(143,'plan/chapters/46','林第一次对尚未见过的苍冥生出不是追凶的向往'),
 support(143,'plan/chapters/47','林已经付尽最后一枚食宿钱，无法兑现方才的包赔。'),
];
assert.equal(10-2-0.5+1.5,9);assert.equal(8.5-2-0.5,6);
assert.equal(3+14+7,24);
assert.match(get(136).payload.problems,/新增来源 plan\/chapters\/35/);assert.equal(get(136).raw.repairMode,'citation_edits');
assert.deepEqual(get(136).payload.originalRequest,get(135).request);
const geography=get(136).stage.result.checks.find(c=>c.criterion==='geography');assert.equal(geography.verdict,'pass');assert.ok(geography.resolves.includes('cross-2-3/geography'));
for(let n=19;n<=50;n++)assert.ok(get(135).request.sources.some(s=>s.origin?.sourceId===`plan/chapters/${n}`));
const artifactScope=Object.fromEntries(['art_04','art_06','art_08'].map(id=>[id,get(137).request.sources.some(s=>s.origin?.sourceId===`world/artifacts/${id}`)]));assert.deepEqual(Object.values(artifactScope),[false,false,false]);
const tiers=get(137).stage.result.checks.find(c=>c.criterion==='tiers');assert.equal(tiers.verdict,'pass');assert.ok(tiers.resolves.includes('cross-2-3/tiers'));
const synthesisParents=get(138).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id);assert.deepEqual(synthesisParents,['review-result/batch-3','review-result/batch-4']);
assert.equal(get(138).request.stage.kind,'synthesis');
const thirdSynthesisParents=get(142).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id);assert.deepEqual(thirdSynthesisParents,['review-result/batch-5','review-result/cross-1-2']);
for(let n=1;n<=50;n++)assert.ok(get(139).request.sources.some(s=>s.origin?.sourceId===`plan/chapters/${n}`));
assert.equal(get(139).request.planningHorizon.targetChapterCount,100);assert.equal(get(139).request.planningHorizon.detailedThroughChapter,50);
for(let n=33;n<=50;n++)assert.ok(get(143).request.sources.some(s=>s.origin?.sourceId===`plan/chapters/${n}`));
assert.equal(get(143).request.planningHorizon.detailedThroughChapter,50);
const proof={kind:'design76_segment22_source_scope_crosscheck',verified:true,runnerSha256:sha(process.argv[1]),preservedFirstAttempt:{path:'docs/audits/2026-10-18-design76-segment22-scope-check-failure.json',sha256:sha('docs/audits/2026-10-18-design76-segment22-scope-check-failure.json')},verificationPath,verificationSha256:sha(verificationPath),checkpointSha256:verification.checkpointSha256,
 calls:calls.map(c=>({number:c.number,requestPath:c.requestPath,requestSha256:c.requestSha256,responsePath:c.responsePath,responseSha256:c.responseSha256,stageId:c.stage.id,acceptedStageSha256:hash(c.stage)})),evidence,
 geographyScope:{initialCall:135,repairCall:136,chapter35CitationRepaired:true,detailedChapters19Through50Sent:true,tradeRouteActuallySent:true,limitation:'The accepted all-actions-in-port wording is too broad: chapter33 also contains the Qingxuan return subplot. A separately source-bound clarification preserves the two places, independent viewpoints and delayed knowledge.'},
 artifactScope,powerScope:'Selected qualification and cost checks only. The three known artifact defects were outside this request and remain unresolved.',
 synthesisScope:{call:138,parents:synthesisParents,limitation:'Partial synthesis of batches3/4 and their reported resolutions only. It cannot erase independently established message-chain or identity-timing defects or approve characters globally.'},
 thirdSynthesisScope:{call:142,parents:thirdSynthesisParents,limitation:'Partial synthesis only. Embedded quotations preserve actual 315-day personal exchange and 318-day delivered notice. The omitted signer in the agency explanation is clarified separately: Zhao signs, Qi receives and later hands over.'},
 openingScope:{call:139,detailedChapters1Through50Sent:true,planningHorizon:get(139).request.planningHorizon,limitation:'Proposal-level feasibility only. Different rescue stages, relationship boundaries and consequences are supported; actual narrative pacing and reader experience remain unproven until prose is reviewed.'},
 pacingScope:{call:143,detailedChapters33Through50Sent:true,limitation:'Retreat after actual tide measurement, independent travel wishes and unaffordable compensation give adjacent scenes distinct choices. Chapters51-100 remain macro proposals; no prose pacing or global acceptance is established.'},
 contentLimit:'Selected semantic checks only; local passes do not close existing blockers, approve global design, or validate prose.',annotationsAdded:0,modelCalls:0,productionWrites:0,formalAcceptance:false};
const out='docs/audits/2026-10-18-design76-segment22-source-scope.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,calls:calls.length,sourceClaims:evidence.length,productionWrites:0}));
