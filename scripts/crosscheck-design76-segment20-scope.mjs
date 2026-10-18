// Selected independent checks of the actual sources and repaired answers.
// Structural replay and these checks do not constitute global narrative approval.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const control='data/audit-runtimes/design76-notes18-review';
const verificationPath='docs/audits/2026-10-18-design76-notes18-review-segment-20.json',verification=read(verificationPath),state=read(verification.checkpointPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);assert.equal(state.segment,20);
try{process.kill(state.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
function call(number){
 const base=`${control}/model-calls/${String(number).padStart(5,'0')}`,requestPath=base+'.started.json',responsePath=base+'.response.json';
 const started=read(requestPath),response=read(responsePath),payload=JSON.parse(started.request.user);
 const request=payload.originalRequest??payload,raw=JSON.parse(response.response.text),run=state.runs.find(r=>r.id===started.step.runId),stage=run.stages.find(s=>s.id===started.step.stageId);
 assert.ok(stage.result);assert.ok(stage.modelResponses.includes(response.response.text));
 return {number,requestPath,responsePath,requestSha256:sha(requestPath),responseSha256:sha(responsePath),payload,request,raw,run,stage};
}
const calls=Array.from({length:state.totalCalls-115},(_,i)=>call(i+116)),get=n=>calls.find(c=>c.number===n);
function support(number,sourceId,quote){
 const c=get(number);assert.ok(c.run.input.sources.find(s=>s.id===sourceId)?.text.includes(quote));
 const fragments=c.request.sources.filter(s=>s.origin?.sourceId===sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(quote)).map(f=>f.id));
 assert.ok(fragments.length,`Source not actually sent: ${number} ${sourceId}`);return {number,sourceId,quote,fragments};
}
const deferred=[116,122].flatMap(n=>get(n).raw.checks.filter(c=>c.awaitingSources).map(check=>{
 const c=get(n),alreadySent=check.awaitingSources.filter(id=>c.request.sources.some(s=>s.origin?.sourceId===id));assert.deepEqual(alreadySent,[]);
 for(const id of check.awaitingSources)assert.ok(c.run.input.sources.some(s=>s.id===id));
 return {call:n,criterion:check.criterion,requested:check.awaitingSources,alreadySent};
}));
assert.deepEqual(deferred.map(x=>x.requested.length),[27,18,18]);
const repaired=[117,119,124].map(n=>({call:n,problems:get(n).payload.problems,mode:get(n).raw.repairMode??'full_response'}));
assert.ok(get(117).payload.problems.includes('plan/milestones/ms_growth_v1_crossing'));
assert.ok(get(117).payload.problems.includes('story/chapterPlans/chapter-plan-31'));
assert.equal(get(119).payload.problems,'等待补读来源已完整提供：plan/chapters/44');
assert.ok(get(124).payload.problems.includes('world/axioms/ax_11'));
for(const n of [118,119])for(let ch=44;ch<=50;ch++)assert.ok(get(n).request.sources.some(s=>s.origin?.sourceId===`plan/chapters/${ch}`));
assert.equal(get(118).raw.checks[0].verdict,'insufficient');assert.equal(get(119).stage.result.checks[0].verdict,'pass');
assert.deepEqual(get(119).stage.modelResponses,[read(get(118).responsePath).response.text,read(get(119).responsePath).response.text]);
const evidence=[
 support(116,'plan/chapters/32','第214日日暮至第216日日暮；实体海程两昼夜'),
 support(116,'plan/chapters/32','借衣借符仍留至次晨交割后分别归还。'),
 support(118,'plan/chapters/44','出剑前沿用239日复测的保守余量五成，一式二成后余三成；'),
 support(118,'plan/chapters/48','本章复诊前一小时吐纳使余量三成至四成，复用试注半成后保守余三成半'),
 support(120,'story/secrets/sec_01','延续先前已实际取得的材料；本段没有提前获得后段新信息。'),
 support(123,'plan/milestones/ms_v3_return','14000−10000−3000−780=220'),
 support(123,'plan/milestones/ms_v2_boundary','事前实付符衣82、船班20、十日住食70与首轮诊护28，合200，未用40留库'),
 support(125,'plan/chapters/48','卢公开拒绝吴替自己答应下一趟，吴最终撤回代答、同样要求离开。'),
 support(125,'plan/chapters/50','林松剑让巡员直接听答'),
 support(126,'plan/chapters/44','实际拉上低舷承接在第45章开场，本章不重复完成。'),
 support(126,'plan/chapters/45','吴卢没人应声'),
];
assert.equal(5-2+1-0.5,3.5);assert.equal(14000-10000-3000-780,220);assert.equal(240-82-20-70-28,40);
const identityScope=Object.fromEntries(['story/characters/char_19','plan/chapters/33','plan/chapters/34','plan/chapters/35','story/relationships/rel_17','plan/milestones/ms_v2_loss'].map(id=>[id,get(120).request.sources.some(s=>s.origin?.sourceId===id)]));
assert.deepEqual(Object.values(identityScope),[true,true,true,false,false,false]);
const detailedChaptersSent=Array.from({length:50},(_,i)=>`plan/chapters/${i+1}`);
for(const id of detailedChaptersSent)assert.ok(get(126).request.sources.some(s=>s.origin?.sourceId===id));
assert.equal(get(126).request.planningHorizon.targetChapterCount,100);assert.equal(get(126).request.planningHorizon.detailedThroughChapter,50);
assert.equal(get(126).stage.result.checks[0].verdict,'pass');assert.ok(get(126).stage.result.checks[0].resolves.includes('batch-2/causality'));
const proof={kind:'design76_segment20_source_scope_crosscheck',verified:true,verificationPath,verificationSha256:sha(verificationPath),checkpointSha256:verification.checkpointSha256,
 calls:calls.map(c=>({number:c.number,requestPath:c.requestPath,requestSha256:c.requestSha256,responsePath:c.responsePath,responseSha256:c.responseSha256,stageId:c.stage.id,acceptedStageSha256:hash(c.stage)})),
 deferred,repaired,evidence,identityScope,causalityCoverage:{call:126,detailedChaptersSent,planningHorizon:get(126).request.planningHorizon},
 knowledgeLimit:'Call120 does not cover chapter35, rel17 or ms_v2_loss; its local pass cannot clear the known 严涛 identity-timing issue. sec01 chapter33 inherits prior evidence; later father-case evidence arrives at66/72/85, not as new chapter33 knowledge.',
 contentLimit:'These selected checks do not supersede unresolved identity, message or artifact defects. The separately bound growth annotation corrects a per-day resource misstatement; original verdicts and blockers remain unchanged.',
 annotationsAdded:0,modelCalls:0,productionWrites:0,formalAcceptance:false};
const out='docs/audits/2026-10-18-design76-segment20-source-scope.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,calls:calls.length,sourceClaims:evidence.length,missingSourceChecks:deferred.length,productionWrites:0}));
