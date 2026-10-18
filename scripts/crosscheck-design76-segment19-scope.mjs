// Independently check selected source claims and the limits of this segment.
// This does not approve narrative quality or replace the complete review.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const control='data/audit-runtimes/design76-notes18-review';
const verificationPath='docs/audits/2026-10-18-design76-notes18-review-segment-19.json';
const verification=read(verificationPath),state=read(verification.checkpointPath);
assert.equal(verification.workerAbsent,true);
assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
assert.equal(state.segment,19);assert.equal(state.totalCalls,115);
try{process.kill(state.pid,0);assert.fail('Worker is still running');}catch(e){assert.equal(e.code,'ESRCH');}
function call(number){
 const base=`${control}/model-calls/${String(number).padStart(5,'0')}`;
 const requestPath=base+'.started.json',responsePath=base+'.response.json';
 const started=read(requestPath),response=read(responsePath);
 const run=state.runs.find(r=>r.id===started.step.runId);
 const stage=run.stages.find(s=>s.id===started.step.stageId);
 assert.ok(stage.result);assert.ok(stage.modelResponses.includes(response.response.text));
 return {number,requestPath,responsePath,requestSha256:sha(requestPath),responseSha256:sha(responsePath),
  request:JSON.parse(started.request.user),raw:JSON.parse(response.response.text),run,stage};
}
const calls=[107,108,109,110,111,112,113,114,115].map(call);
const byNumber=n=>calls.find(c=>c.number===n);
function support(number,sourceId,quote){
 const c=byNumber(number);
 assert.ok(c.run.input.sources.find(s=>s.id===sourceId)?.text.includes(quote));
 const fragments=c.request.sources.filter(s=>s.origin?.sourceId===sourceId)
  .flatMap(s=>s.fragments.filter(f=>f.text.includes(quote)).map(f=>f.id));
 assert.ok(fragments.length>0,`Claim was not sent in call ${number}: ${sourceId}`);
 return {number,sourceId,quote,fragments};
}
const deferred=[107,112].flatMap(n=>{
 const c=byNumber(n);
 return c.raw.checks.filter(check=>check.awaitingSources).map(check=>{
  const alreadySent=check.awaitingSources.filter(id=>c.request.sources.some(s=>s.origin?.sourceId===id));
  assert.deepEqual(alreadySent,[]);
  for(const id of check.awaitingSources)assert.ok(c.run.input.sources.some(s=>s.id===id));
  return {call:n,criterion:check.criterion,requested:check.awaitingSources,alreadySent};
 });
});
assert.deepEqual(deferred.map(x=>x.requested.length),[21,44,47]);
assert.deepEqual(byNumber(109).stage.modelResponses,[read(byNumber(108).responsePath).response.text,read(byNumber(109).responsePath).response.text]);
const costs=byNumber(109).stage.result.checks.find(c=>c.criterion==='costs');
assert.equal(costs.verdict,'pass');assert.ok(costs.resolves.includes('batch-3/costs'));
const evidence=[
 support(108,'plan/chapters/20','10−2−0.5+1.5=9成'),
 support(108,'plan/chapters/21','本章只扣一次：9−0.5=8.5成，已经包含拨钩支出，不得再扣同一动作。'),
 support(111,'plan/chapters/49','沉川主动交条、当面拒绝离港并说出亲见'),
 support(113,'plan/milestones/ms_v3_convoy','第三次受伤后剩余二成封存待复诊、不得续用'),
 support(113,'plan/milestones/ms_v3_convoy','不把林三次护罡或顾一次护罡当作这段31分钟的持续屏障。'),
 support(114,'story/relationships/rel_10','"fromCharacterId": "char_02",\n  "toCharacterId": "char_11"'),
 support(114,'story/characters/char_02','"name": "苏凌霜"'),
 support(114,'story/characters/char_11','"name": "秦禾"'),
];
assert.equal(10-2-0.5+1.5,9);assert.equal(9-0.5,8.5);
const coverage=[111,115].map(n=>{
 const c=byNumber(n),required=Array.from({length:50},(_,i)=>`plan/chapters/${i+1}`);
 for(const id of required)assert.ok(c.request.sources.some(s=>s.origin?.sourceId===id));
 return {call:n,detailedChaptersSent:required,planningHorizon:c.request.planningHorizon,
  verdict:c.stage.result.checks[0].verdict};
});
const pacing=byNumber(115).stage.result.checks.find(c=>c.criterion==='pacing');
assert.equal(pacing.verdict,'pass');assert.ok(pacing.explanation.includes('训练与核验段落虽存在静态节奏风险'));
const proof={kind:'design76_segment19_source_scope_crosscheck',verified:true,verificationPath,
 verificationSha256:sha(verificationPath),checkpointSha256:verification.checkpointSha256,
 calls:calls.map(c=>({number:c.number,requestPath:c.requestPath,requestSha256:c.requestSha256,responsePath:c.responsePath,responseSha256:c.responseSha256,stageId:c.stage.id,acceptedStageSha256:hash(c.stage)})),
 deferred,evidence,coverage,originalPacingCheck:pacing,
 relationshipScope:'rel_10 is 苏凌霜—秦禾. The response also discusses 林辰—秦禾 scene cooperation; that does not establish a separate formal relationship record or change the recorded endpoints.',
 contentLimit:'Selected source checks and review scope only. Local passes do not supersede known identity/message/artifact defects, prove prose pacing, close blockers or approve the design.',
 annotationsAdded:0,modelCalls:0,productionWrites:0,formalAcceptance:false};
const out='docs/audits/2026-10-18-design76-segment19-source-scope.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);
else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,sourceClaims:evidence.length,missingSourceChecks:deferred.length,productionWrites:0,formalAcceptance:false}));
