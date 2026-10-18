// Bind semantic observations to the actual requests, responses and frozen input.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const control='data/audit-runtimes/design76-notes26-review',verificationPath='docs/audits/2026-10-18-design76-notes26-review-segment-27.json';
const verification=read(verificationPath),state=read(verification.checkpointPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);assert.equal(state.segment,27);
try{process.kill(state.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
function call(number){
 const base=`${control}/model-calls/${String(number).padStart(5,'0')}`,requestPath=base+'.started.json',responsePath=base+'.response.json';
 const started=read(requestPath),response=read(responsePath),payload=JSON.parse(started.request.user),request=payload.originalRequest??payload;
 const raw=JSON.parse(response.response.text),run=state.runs.find(r=>r.id===started.step.runId),stage=run.stages.find(s=>s.id===started.step.stageId);
 assert.ok(stage.result);assert.ok(stage.modelResponses.includes(response.response.text));
 return {number,requestPath,responsePath,requestSha256:sha(requestPath),responseSha256:sha(responsePath),payload,request,raw,run,stage};
}
const calls=Array.from({length:state.totalCalls-177},(_,i)=>call(i+178)),get=n=>calls.find(c=>c.number===n);
function support(number,sourceId,quote){
 const c=get(number);assert.ok(c.run.input.sources.find(s=>s.id===sourceId)?.text.includes(quote),`Absent original: ${number} ${sourceId}`);
 const fragments=c.request.sources.filter(s=>s.origin?.sourceId===sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(quote)).map(f=>f.id));
 assert.ok(fragments.length,`Source not actually sent: ${number} ${sourceId}`);return {number,sourceId,quote,fragments};
}
function supportEmbedded(number,sourceId,quote){
 const c=get(number);assert.ok(c.run.input.sources.find(s=>s.id===sourceId)?.text.includes(quote));
 const embedded=c.request.sources.filter(s=>s.id.startsWith('review-result/')).flatMap(s=>s.fragments.filter(f=>f.text.includes(quote)).map(f=>({parent:s.id,fragment:f.id})));
 assert.ok(embedded.length,`Absent embedded quotation: ${number} ${sourceId}`);return {number,sourceId,quote,embedded,scope:'Independent original excerpt inside a parent report; not a full original-source reread.'};
}
const evidence=[
 support(178,'world/locations/loc_21','内陆抵港时间另算。'),
 support(178,'world/artifacts/art_16','不隔绝明火、浓烟、毒气和修士火法'),
 support(178,'world/artifacts/art_21','不能用它进入界渊、神宫或替代当地许可。'),
 support(178,'plan/chapters/31','第214日申时他登船，日暮启航'),
 support(178,'plan/chapters/32','不能用214日旧通告代替今天核验'),
 support(178,'plan/milestones/ms_v2_voyage','276日暮离港、281日暮抵葬骨外港，五昼夜完整航程。'),
 support(178,'plan/milestones/ms_v2_boundary','不借夜285日给林贺的查货担保入境。'),
 support(179,'world/techniques/tech_19','每个失败或中断的开封周期另耗一枚'),
 support(179,'plan/milestones/ms_v3_training','第三枚报废不退、该周期不计有效'),
 support(179,'plan/milestones/ms_v3_training','任一讲解、复述或复诊未完成均顺延'),
 support(179,'plan/milestones/ms_v3_advancement','六个有效周期完成→静置观察→白榆诊察→顾峤复核→十元载扣除'),
 supportEmbedded(180,'plan/chapters/38','林这时才知道兄弟关系。'),
 supportEmbedded(180,'plan/chapters/48','读者确认两人仍在扣押，林贺尚不知道位置和这些谈话'),
 supportEmbedded(180,'story/relationships/rel_13','完整改签自述仍须53实际书写签认。'),
 supportEmbedded(180,'story/arcBeats/message-first-read','赵府收发房据程报一号签收、交赵亲阅。'),
 supportEmbedded(180,'story/arcBeats/message-dispatch','林贺随巡查进附棚'),
 supportEmbedded(180,'story/arcBeats/message-defeat-report','438抵乾都、439获见赵'),
 support(182,'plan/chapters/26','189日只有原液出入账，林药程190日才开始'),
 support(182,'plan/chapters/27','有效剂数由0到1，个人封存原液由6滴减至3滴'),
 support(182,'plan/chapters/28','有效剂数从1到2、原液库存从3到0'),
 support(182,'plan/chapters/29','林在第212日按第30章的独立护货行程从入口外营分路'),
 support(184,'world/locations/loc_29','访客、矿工须有对应药役、管事或执事登记陪同'),
 support(184,'plan/milestones/ms_v3_return','第311–314日才沿大乾普通驿路返外山'),
 support(184,'plan/milestones/ms_v3_return','315日两人当面交换材料'),
 support(184,'plan/milestones/ms_v3_return','结余220由贺另袋封存，待实际返赤霄交回商盟'),
 support(185,'world/techniques/tech_19','耗材开封即扣，失败或中断不返。'),
 support(185,'plan/milestones/ms_v3_training','现金24枚与课程是同一合同的两个报酬项'),
 support(185,'plan/milestones/ms_v3_training','剩余7枚完整灵石验纯后单独入训练库存'),
 supportEmbedded(186,'story/relationships/rel_01','约定返宗不是林亲见返宗，直到41收信才确认苏实际近况。'),
 supportEmbedded(186,'story/relationships/rel_12','不能以救命要求服从。'),
 supportEmbedded(186,'plan/chapters/23','秦禾说明自己被扣时见过名牌全名“墨幽屠”，林苏至此才核定敌首身份。'),
 supportEmbedded(186,'plan/chapters/50','贺在门外喊名'),
 supportEmbedded(186,'story/arcBeats/message-dispatch','林贺随巡查进附棚'),
 support(187,'world/artifacts/art_20','空载、拒流、提早断开都耗掉本路整枚'),
 support(187,'world/artifacts/art_20','脱接后冷光持续至已付三十息周期结束，代表残能排散'),
 support(187,'story/chapterPlans/chapter-plan-11','腕套已无主动抽力，仍须止血'),
 support(187,'world/techniques/tech_04','已支出的二成当境法力不退。'),
 support(187,'world/artifacts/art_03','器身降温不回补真元或治愈持剑人的伤'),
 support(187,'world/techniques/tech_02','淬体阶段只能低负荷导引，不形成可供外放施术的真元储备'),
];
assert.equal(get(182).raw.repairMode,'citation_edits');assert.deepEqual(get(182).payload.originalRequest,get(181).request);
assert.deepEqual(get(182).raw.updates[0].addEvidence.map(e=>e.fragmentId),['e111','e112','e15']);
assert.deepEqual(get(184).payload.originalRequest,get(183).request);
assert.deepEqual(get(183).raw.checks[0].resolves,['cross-3-7/geography']);
assert.equal(get(184).raw.checks[0].verdict,'revise');assert.ok(!get(184).raw.checks[0].resolves?.length);
assert.ok(get(184).payload.problems.includes('仅原文复核的通过结论'));
assert.deepEqual(get(180).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id),['review-result/followup-cross-4-5/relationships','review-result/followup-cross-4-5/knowledge']);
assert.ok(!get(180).request.sources.some(s=>s.origin?.sourceId==='plan/chapters/33'));
assert.ok(!get(180).request.sources.some(s=>s.fragments.some(f=>f.text.includes('217日晚，林确认严身份'))));
assert.deepEqual(get(186).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id),['review-result/synthesis-1','review-result/synthesis-2']);
assert.ok(!get(186).request.sources.some(s=>s.fragments.some(f=>f.text.includes('217日晚，林确认严身份'))));
const proof={kind:'design76_segment27_source_scope_crosscheck',verified:true,runnerSha256:sha(process.argv[1]),verificationPath,verificationSha256:sha(verificationPath),checkpointSha256:verification.checkpointSha256,
 calls:calls.map(c=>({number:c.number,requestPath:c.requestPath,requestSha256:c.requestSha256,responsePath:c.responsePath,responseSha256:c.responseSha256,stageId:c.stage.id,acceptedStageSha256:hash(c.stage)})),evidence,
 contentLimit:'Selected semantic checks only. The day-315 visitor admission omission is a model revision finding, not a closed blocker. Local and intermediate passes do not approve the whole design, repair known dispatch/identity conflicts, or validate prose.',annotationsAdded:0,modelCalls:0,productionWrites:0,formalAcceptance:false};
const out='docs/audits/2026-10-18-design76-segment27-source-scope.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,calls:calls.length,sourceClaims:evidence.length,productionWrites:0}));
