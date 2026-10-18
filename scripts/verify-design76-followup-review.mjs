// Replay the detached follow-up review entirely offline from durable files.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p));
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const control='data/audit-runtimes/design76-followup-v1-review';
const manifest=read(`${control}/manifest.json`),statePath=`${control}/result.json`,state=read(statePath);
assert.equal(state.status,'completed');
try{process.kill(state.pid,0);assert.fail('Follow-up worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
assert.equal(fileHash('scripts/review-design76-followup-candidate.mjs'),manifest.runnerSha256);
assert.equal(fileHash('docs/audits/2026-10-18-design76-followup-controls-v1.json'),manifest.proofSha256);
const candidateProof=read('docs/audits/2026-10-18-design76-followup-controls-v1.json');
assert.equal(hash(read(candidateProof.candidatePath)),manifest.candidateSha256);
assert.equal(state.candidateSha256,manifest.candidateSha256);
const bindingPath='data/audit-runtimes/design76-recovery-runtime-bound.json',binding=read(bindingPath);
assert.equal(fileHash(bindingPath),manifest.bindingSha256);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(fileHash(`${binding.runtimePath}/${p}`),h);
for(const[p,h]of Object.entries(binding.dependencyHashes))assert.equal(fileHash(p),h);
assert.equal(state.model,'gpt-5.6-luna');assert.equal(state.fallback,false);
const {JsonDesignPlanner}=await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const journalDir=`${control}/model-calls`,names=fs.readdirSync(journalDir).filter(n=>n.endsWith('.started.json')).sort();
assert.equal(names.length,state.calls);
const journal=names.map((name,index)=>{
  const start=read(`${journalDir}/${name}`),responsePath=`${journalDir}/${name.replace('.started.json','.response.json')}`;
  assert.equal(start.number,index+1);assert.ok(fs.existsSync(responsePath));
  assert.ok(!fs.existsSync(`${journalDir}/${name.replace('.started.json','.failure.json')}`));
  const response=read(responsePath);assert.equal(response.number,start.number);assert.equal(response.area,start.area);
  return {start,response,startSha256:fileHash(`${journalDir}/${name}`),responseSha256:fileHash(responsePath)};
});
assert.deepEqual(state.areas.map(a=>a.area),['power','characters']);
const results=[];
for(const area of state.areas){
  assert.equal(area.status,'completed');
  const input=read(`${control}/${area.area}-input.json`);assert.equal(hash(input),manifest.inputs[area.area]);
  const calls=journal.filter(c=>c.start.area===area.area);
  assert.deepEqual(calls.map(c=>c.response.response.text),area.rawResponses);
  let next=0;
  const planner=new JsonDesignPlanner({complete:async req=>{
    const call=calls[next++];assert.ok(call);
    assert.deepEqual(call.start.request,{role:req.role??'reviewing',model:state.model,system:req.system,user:req.user,maxOutputTokens:req.maxOutputTokens,responseFormat:'json',temperature:0.2});
    return call.response.response.text;
  }});
  assert.deepEqual(await planner.reviewDesignContent(input),area.result);
  assert.equal(next,calls.length);
  results.push({area:area.area,inputSha256:hash(input),responsesReplayed:next,result:area.result});
}
assert.ok(journal.every(c=>state.areas.some(a=>a.area===c.start.area)));
const formalProof=read('docs/audits/2026-10-18-design76-recovery-segment-0.json');
assert.equal(state.formalCheckpointSha256,formalProof.checkpointSha256);
const proof={kind:'design76_followup_review_replayed',observedAt:new Date().toISOString(),verified:true,
  statePath,stateSha256:fileHash(statePath),candidatePath:candidateProof.candidatePath,candidateSha256:state.candidateSha256,
  sourceCommit:binding.sourceCommit,runnerSha256:manifest.runnerSha256,model:state.model,fallback:false,
  originalModelCalls:state.calls,modelCalls:0,productionWrites:0,formalAcceptance:false,blockersClosed:0,
  results,journal:journal.map(c=>({number:c.start.number,area:c.start.area,startSha256:c.startSha256,responseSha256:c.responseSha256,usage:c.response.response.usage})),
  limitation:'Verifies actual requests, raw responses, citations and local verdicts for the offline follow-up candidate only. Production remains design76; full four-area acceptance and all historical blockers remain separate.'};
fs.writeFileSync('docs/audits/2026-10-18-design76-followup-review.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,originalModelCalls:state.calls,areas:results.map(r=>({area:r.area,checks:r.result.checks.map(c=>({criterion:c.criterion,verdict:c.verdict}))})),formalAcceptance:false}));
