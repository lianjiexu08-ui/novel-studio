// Bind selected semantic checks to this segment's actual requests and immutable inputs.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const control='data/audit-runtimes/design76-notes25-review';
const verificationPath='docs/audits/2026-10-18-design76-notes25-review-segment-26.json',verification=read(verificationPath),state=read(verification.checkpointPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);assert.equal(state.segment,26);
try{process.kill(state.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
function call(number){
 const base=`${control}/model-calls/${String(number).padStart(5,'0')}`,requestPath=base+'.started.json',responsePath=base+'.response.json';
 const started=read(requestPath),response=read(responsePath),payload=JSON.parse(started.request.user),request=payload.originalRequest??payload;
 const raw=JSON.parse(response.response.text),run=state.runs.find(r=>r.id===started.step.runId),stage=run.stages.find(s=>s.id===started.step.stageId);
 assert.ok(stage.result);assert.ok(stage.modelResponses.includes(response.response.text));
 return {number,requestPath,responsePath,requestSha256:sha(requestPath),responseSha256:sha(responsePath),payload,request,raw,run,stage};
}
const calls=Array.from({length:state.totalCalls-168},(_,i)=>call(i+169)),get=n=>calls.find(c=>c.number===n);
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
 support(177,'plan/milestones/ms_v3_return','肩伤按普通治疗好转后才恢复轻练。'),
 support(177,'plan/milestones/ms_v3_training','第三枚报废不退、该周期不计有效'),
 support(177,'plan/milestones/ms_v3_training','现金24枚与课程是同一合同的两个报酬项'),
 support(177,'plan/milestones/ms_v3_advancement','六个有效周期完成→静置观察→白榆诊察→顾峤复核→十元载扣除'),

 supportEmbedded(175,'story/secrets/sec_01','父亲曾参与守门工作的证据来自署名图纸和撤离记录；尚不知父案全貌。'),
 supportEmbedded(175,'story/chapterPlans/chapter-plan-21','秦已说明主营大致方向，尚未实核布局或辨清指挥者。'),
 supportEmbedded(175,'story/secrets/sec_02','秦禾亲历被扣，知道前哨方向；证词尚不能证明完整幕后指挥。'),

 support(174,'plan/chapters/25','并非推劲付费就必能击倒同阶。'),
 support(174,'plan/chapters/25','若墨稳定重新施术，普通绳并不能阻止。'),
 support(174,'plan/chapters/26','若左臂气路也不稳或墨恢复术法，必须停运呼援'),
 support(174,'plan/chapters/43','本章停在施术前，44接切索、支出二成真元和热剑停术，不把准备当已发动。'),

 support(173,'plan/chapters/32','215日海上风暴不被当作地火喷发，也不能用214日旧通告代替今天核验'),
 support(173,'plan/chapters/33','苏于217日将损剑交外门器械房登记入库待处置，当面验领库内原有的一柄普通备用铁剑'),
 support(173,'plan/chapters/40','不能把退还租符的余量转入新符。'),
 support(173,'plan/chapters/43','后续拖力由船行、普通索具和艉桩承担'),

 support(172,'plan/chapters/36','唐失去接触外来搬工的路，只能记住走过的门向和缆位；这些见闻尚未传给贺林。'),
 support(172,'plan/chapters/47','贺不是不动心：自己船还在架上，下一顿和下一单都要重来。'),
 support(172,'plan/chapters/48','吴第一次听见同伴和自己不是同一个答案。'),

 supportEmbedded(171,'story/relationships/rel_09','林辰不能把准入当贴身护卫，顾保留守口优先。'),
 supportEmbedded(171,'story/relationships/rel_10','苏先救秦禾，再以一枚个人青灵石补本次引路损失；秦禾说明不陪队伍冲营。'),
 supportEmbedded(171,'story/chapterPlans/chapter-plan-24','林苏在营地看不到这些交接'),
 supportEmbedded(171,'story/chapterPlans/bible-chapter-48','读者确认两人仍在扣押，林贺尚不知道位置和这些谈话'),

 support(170,'plan/chapters/25','顾的0.25元载属于顾本人，林本场没有发动燃寿术。'),
 support(170,'plan/chapters/26','合计一成后余二成。'),
 support(170,'plan/chapters/42','本次试注后四成半，经实际一小时温和吐纳复测仅回半成至五成，不新增第二次恢复。'),
 support(170,'plan/chapters/43','伙计行动前可用真元按自身实测基准保守计五成'),
 support(170,'plan/chapters/44','剑独立散热，不能借散热把真元账重置。'),

 support(169,'plan/chapters/19','古境通路依旧属于同一天地内部，不涉及太古界门。'),
 support(169,'plan/chapters/32','第214日日暮至第216日日暮；实体海程两昼夜'),

 support(169,'plan/chapters/33','林41章收到信前不得知道其返宗结果。'),
 support(169,'plan/chapters/33','217日晚，林确认严身份'),
 support(169,'plan/chapters/33','知识边界修复：本章侧门视角只属于读者与独立角色，不能回写林辰的endHook或当晚认知'),

];
assert.ok(!get(169).request.sources.some(s=>s.origin?.sourceId==='world/locations/loc_21'));
for(let chapter=18;chapter<=50;chapter++)assert.ok(get(169).request.sources.some(s=>s.origin?.sourceId===`plan/chapters/${chapter}`));
assert.ok(!get(171).request.sources.some(s=>s.origin?.sourceId==='plan/chapters/33'));
assert.ok(!get(171).request.sources.some(s=>s.fragments.some(f=>f.text.includes('217日晚，林确认严身份'))));
for(let chapter=1;chapter<=50;chapter++)assert.ok(get(172).request.sources.some(s=>s.origin?.sourceId===`plan/chapters/${chapter}`));
assert.equal(get(177).raw.repairMode,'citation_edits');
assert.deepEqual(get(177).payload.originalRequest,get(176).request);
for(const [number,parents]of [[171,['followup-cross-3-4/relationships','followup-cross-3-4/knowledge']],[175,['followup-cross-3-5/relationships','followup-cross-3-5/knowledge']]])assert.deepEqual(get(number).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id.slice('review-result/'.length)),parents);
const proof={kind:'design76_segment26_source_scope_crosscheck',verified:true,runnerSha256:sha(process.argv[1]),verificationPath,verificationSha256:sha(verificationPath),checkpointSha256:verification.checkpointSha256,
 calls:calls.map(c=>({number:c.number,requestPath:c.requestPath,requestSha256:c.requestSha256,responsePath:c.responsePath,responseSha256:c.responseSha256,stageId:c.stage.id,acceptedStageSha256:hash(c.stage)})),evidence,
 contentLimit:'Selected semantic checks only; local passes do not close blockers, approve global design or validate prose.',annotationsAdded:0,annotationDrafts:2,modelCalls:0,productionWrites:0,formalAcceptance:false};
const out='docs/audits/2026-10-18-design76-segment26-source-scope.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,calls:calls.length,sourceClaims:evidence.length,productionWrites:0}));
