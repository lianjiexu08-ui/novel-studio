// Check selected semantic claims against the exact sources sent in segment21.
// These checks preserve the distinction between local judgments and final approval.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const control='data/audit-runtimes/design76-notes20-review';
const verificationPath='docs/audits/2026-10-18-design76-notes20-review-segment-21.json',verification=read(verificationPath),state=read(verification.checkpointPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);assert.equal(state.segment,21);
try{process.kill(state.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
function call(number){
 const base=`${control}/model-calls/${String(number).padStart(5,'0')}`,requestPath=base+'.started.json',responsePath=base+'.response.json';
 const started=read(requestPath),response=read(responsePath),payload=JSON.parse(started.request.user),request=payload.originalRequest??payload;
 const raw=JSON.parse(response.response.text),run=state.runs.find(r=>r.id===started.step.runId),stage=run.stages.find(s=>s.id===started.step.stageId);
 assert.ok(stage.result);assert.ok(stage.modelResponses.includes(response.response.text));
 return {number,requestPath,responsePath,requestSha256:sha(requestPath),responseSha256:sha(responsePath),payload,request,raw,run,stage};
}
const calls=Array.from({length:state.totalCalls-126},(_,i)=>call(i+127)),get=n=>calls.find(c=>c.number===n);
function support(number,sourceId,quote){
 const c=get(number);assert.ok(c.run.input.sources.find(s=>s.id===sourceId)?.text.includes(quote));
 const fragments=c.request.sources.filter(s=>s.origin?.sourceId===sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(quote)).map(f=>f.id));
 assert.ok(fragments.length,`Source not actually sent: ${number} ${sourceId}`);return {number,sourceId,quote,fragments};
}
const geography=get(127).stage.result.checks.find(c=>c.criterion==='geography');
assert.equal(geography.verdict,'insufficient');assert.deepEqual(geography.awaitingSources,['world/locations/loc_21']);
assert.ok(get(127).run.input.sources.some(s=>s.id==='world/locations/loc_21'));
assert.equal(get(127).request.sources.some(s=>s.origin?.sourceId==='world/locations/loc_21'),false);
for(let n=32;n<=49;n++)assert.ok(get(127).request.sources.some(s=>s.origin?.sourceId===`plan/chapters/${n}`));
const history=get(127).stage.result.checks.find(c=>c.criterion==='history');assert.equal(history.verdict,'pass');assert.ok(history.resolves.includes('cross-5-7/history'));
const evidence=[
 support(127,'plan/chapters/36','五人都被拦回'),
 support(127,'plan/chapters/37','陆沉川不计入贺那5名被扣雇工。'),
 support(127,'plan/chapters/39','本箱24=12回收+6火毁+6售用'),
 support(127,'plan/chapters/50','和244获救的唐许冯合计五人脱控'),
 support(128,'plan/chapters/25','解囚与同阶交锋至巳初后09:15结束'),
 support(128,'plan/chapters/25','墨仍有至少三成玄府元罡，不因属性受克自动失去行动。'),
 support(128,'plan/milestones/ms_v3_convoy','八→六→四→二，第三次受伤后剩余二成封存待复诊、不得续用'),
 support(129,'story/arcBeats/message-dispatch','林贺随巡查进附棚、两工及两看守被分别带出'),
 support(129,'story/secrets/sec_02','也不确认林贺曾进入棚内。'),
 support(132,'plan/chapters/13','诊断不是寿储收入或预知死期'),
 support(132,'plan/chapters/25','林真元以8.5−2−0.5=6成承接，不重复扣21章成本；顾0.25元载属于顾，不记到林寿储。'),
 support(132,'plan/chapters/42','本次试注后四成半，经实际一小时温和吐纳复测仅回半成至五成，不新增第二次恢复。'),
 support(134,'plan/milestones/ms_v2_fire','50细纲已规划两工实际撤出，五工全部脱控；51–53的照护、短工、船舶交检及陆自述仍是后续设计'),
];
assert.equal(12+6+6,24);assert.equal(3+2,5);
assert.equal(8.5-2-0.5,6);assert.equal(5-0.5+0.5,5);
const artifactScope=Object.fromEntries(['art_03','art_04','art_06','art_08','art_21'].map(id=>[id,get(128).request.sources.some(s=>s.origin?.sourceId===`world/artifacts/${id}`)]));
assert.deepEqual(Object.values(artifactScope),[true,false,false,false,true]);
const counters=get(128).stage.result.checks.find(c=>c.criterion==='counters');assert.equal(counters.verdict,'pass');assert.ok(counters.resolves.includes('batch-4/counters'));
const knowledgeScope=Object.fromEntries(['story/arcBeats/message-dispatch','story/secrets/sec_02','story/relationships/rel_17','story/characters/char_19','plan/chapters/33','plan/chapters/34','plan/chapters/35','plan/milestones/ms_v2_loss'].map(id=>[id,get(129).request.sources.some(s=>s.origin?.sourceId===id)]));
assert.deepEqual(Object.values(knowledgeScope),[true,true,false,true,false,false,true,true]);
const synthesisParents=get(133).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id);
assert.deepEqual(synthesisParents,['review-result/batch-1','review-result/batch-2']);
assert.equal(get(133).request.stage.kind,'synthesis');
const payoffMilestones=['ms_v2_fire','ms_v2_voyage','ms_v2_boundary','ms_v3_return','ms_v3_training','ms_v3_advancement','ms_v3_convoy','ms_v3_payoff'].map(id=>`plan/milestones/${id}`);
for(const id of payoffMilestones)assert.ok(get(134).request.sources.some(s=>s.origin?.sourceId===id));
assert.equal(get(134).request.sources.some(s=>s.origin?.sourceId==='plan/chapters/50'),false);
assert.equal(get(134).request.planningHorizon.targetChapterCount,100);assert.equal(get(134).request.planningHorizon.detailedThroughChapter,50);
const previousPath=control+'/segment-20.json',previous=read(previousPath),oldWorld=previous.runs.find(r=>r.input.area==='world'),world=state.runs.find(r=>r.input.area==='world');
const oldIds=new Set(oldWorld.stages.map(s=>s.id)),added=world.stages.filter(s=>!oldIds.has(s.id)).map(s=>({id:s.id,kind:s.kind}));
assert.equal(oldWorld.stages.length,55);assert.equal(world.stages.length,95);
assert.equal(added.filter(s=>s.id.startsWith('followup-')).length,20);assert.equal(added.filter(s=>s.kind==='synthesis').length,20);
const proof={kind:'design76_segment21_source_scope_crosscheck',verified:true,verificationPath,verificationSha256:sha(verificationPath),checkpointSha256:verification.checkpointSha256,
 calls:calls.map(c=>({number:c.number,requestPath:c.requestPath,requestSha256:c.requestSha256,responsePath:c.responsePath,responseSha256:c.responseSha256,stageId:c.stage.id,acceptedStageSha256:hash(c.stage)})),
 evidence,worldScope:{deferredSource:'world/locations/loc_21',actuallyAbsent:true,detailedChapters32Through49Sent:true,historyResolution:'cross-5-7/history'},artifactScope,knowledgeScope,
 counterScope:'Call128 did not include art04/art06/art08. Its local pass does not resolve their known control defects. Chapter25 explicitly describes Gu and Mo fighting at the same realm; Lin contributes limited actions and does not personally defeat a higher realm through willpower.',
 knowledgeLimit:'Call129 received both the stale message-dispatch entry into the shed and sec02 limiting the report to outside events, yet passed. The existing v4 message correction remains necessary. It also omitted chapters33/34 and rel17, so does not settle identity timing. The new recipient misstatement is addressed by a separately source-bound clarification.',
 clarificationScope:'Separate drafts bind call129 recipient confusion, call130 next-day patrol rescue, call131 sequential return/voyage wording and call134 order/receipt confusion. The actual design preserves the intended recipients, same-night rescue, parallel journeys and document custody.',
 synthesisScope:{call:133,parents:synthesisParents,limitation:'First partial merge only, not the final character report. Original review excerpts and resolution records do not override independently established defects.'},
 payoffScope:{call:134,milestonesSent:payoffMilestones,chapter50NotSent:true,planningHorizon:get(134).request.planningHorizon,limitation:'Later macro-plan reading only. The actual milestone places escape in chapter50 and care/work/testimony in51-53; this response must not move or repeat the rescue.'},
 scheduling:{previousPath,previousSha256:sha(previousPath),oldWorldStages:55,newWorldStages:95,added,explanation:'20 supplemental reading stages and20 synthesis stages; no new novel chapters.'},
 contentLimit:'Selected claims only. Local passes do not erase the existing artifact, message-chain or identity-timing defects, close blockers, or approve global design or prose.',
 annotationsAdded:0,modelCalls:0,productionWrites:0,formalAcceptance:false};
const out='docs/audits/2026-10-18-design76-segment21-source-scope.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,calls:calls.length,sourceClaims:evidence.length,productionWrites:0}));
