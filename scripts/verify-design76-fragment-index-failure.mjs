// Replay the two recorded failures through the frozen fix without model or DB writes.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(`${binding.runtimePath}/${p}`),h);
for(const[p,h]of Object.entries(binding.dependencyHashes))assert.equal(sha(p),h);
const checkpointPath='data/audit-runtimes/design76-macro-review/terminal-segment-14.json',checkpoint=read(checkpointPath);
const verification=read('docs/audits/2026-10-18-design76-macro-review-segment-14.json');
assert.equal(sha(checkpointPath),verification.checkpointSha256);assert.equal(verification.workerAbsent,true);assert.equal(verification.unsettledCalls,0);
const {designReviewStageInput}=await import(binding.runtimePath+'/novel-service-core/src/design-review-run.ts');
const {JsonDesignPlanner}=await import(binding.runtimePath+'/packages/planner/src/index.ts');
const {prepareDesignReviewEvidence}=await import(binding.runtimePath+'/packages/planner/src/design-review-evidence.ts');
const run=checkpoint.runs.find(r=>r.input.area==='world'),stage=run.stages.find(s=>s.id==='cross-2-7');assert.equal(stage.result,undefined);
const input=designReviewStageInput(run,stage),prepared=prepareDesignReviewEvidence(input);
const base='data/audit-runtimes/design76-macro-review/model-calls/';
const seed=read(base+'00081.started.json').request,responses=[81,82].map(n=>read(base+String(n).padStart(5,'0')+'.response.json').response.text);
const original=JSON.parse(seed.user),directory=original.sources.map(s=>({unitId:s.id,sourceId:s.origin?.sourceId??s.id,fragmentIds:s.fragments.map(f=>f.id)}));
assert.deepEqual(prepared.sources,original.sources);
const failures=responses.map(text=>{
 const answer=JSON.parse(text),context=prepared.fragmentRepairContext(answer);
 assert.throws(()=>prepared.resolve(answer),/评审片段编号不属于本次材料/);
 return context.fragmentReferenceProblems;
});
assert.deepEqual(failures[0].map(p=>p.invalidFragmentId),['e350','e351','e352']);
assert.deepEqual(failures[1].map(p=>p.invalidFragmentId),['e354','e355','e356','e357','e358','e359','e360']);
let calls=0,repair;
const planner=new JsonDesignPlanner({complete:async request=>{
 if(++calls===1){assert.equal(request.user,seed.user);assert.ok(seed.system.startsWith(request.system));return responses[0];}
 assert.equal(calls,2);repair=JSON.parse(request.user);assert.deepEqual(repair.originalRequest,original);
 assert.deepEqual(repair.availableEvidenceSources,directory);assert.deepEqual(repair.fragmentReferenceProblems,failures[0]);
 return responses[1];
}});
await assert.rejects(planner.reviewDesignContent(input),error=>{assert.match(error.message,/e354/);assert.deepEqual(error.modelResponses,responses);return true;});
assert.equal(calls,2);
const proof={kind:'design76_fragment_index_failure_regression',verified:true,bindingSha256:sha(bindingPath),sourceCommit:binding.sourceCommit,checkpointSha256:sha(checkpointPath),
 calls:[81,82].map(n=>{const b=base+String(n).padStart(5,'0');return {call:n,requestSha256:sha(b+'.started.json'),responseSha256:sha(b+'.response.json')};}),
 originalFailuresStillRejected:true,failures,availableEvidenceSources:directory,fragmentCount:directory.reduce((n,s)=>n+s.fragmentIds.length,0),
 sourceCount:directory.length,newRepairInstruction:repair.instruction,modelCalls:0,productionWrites:0,formalAcceptance:false,
 limitation:'The exact directory diagnoses fabricated IDs without mapping or accepting them. This offline replay does not prove model repair success or semantic correctness.'};
const out='docs/audits/2026-10-18-design76-fragment-index-failure.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,originalFailuresStillRejected:true,fragmentCount:proof.fragmentCount,sourceCount:proof.sourceCount,modelCalls:0}));
