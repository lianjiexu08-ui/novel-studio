// Bind two independent clarifications only after the segment's complete terminal replay.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const control='data/audit-runtimes/design76-notes21-review';
const verificationPath='docs/audits/2026-10-18-design76-notes21-review-segment-22.json',verification=read(verificationPath);
const checkpoint=read(control+'/result.json');assert.equal(checkpoint.segment,22);assert.equal(verification.workerAbsent,true);
assert.equal(sha(control+'/result.json'),verification.checkpointSha256);
try{process.kill(checkpoint.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(`${binding.runtimePath}/${p}`),h);
const {annotationSources}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const draftPaths=['docs/audits/2026-10-18-design76-world-port-scope.json','docs/audits/2026-10-18-design76-character-order-signer.json'];
const annotations=draftPaths.map(draftPath=>{
 const draft=read(draftPath);assert.equal(draft.bindingSha256,sha(bindingPath));
 assert.equal(sha(draft.requestPath),draft.requestSha256);assert.equal(sha(draft.responsePath),draft.responseSha256);
 const run=checkpoint.runs.find(r=>r.id===draft.runId),stage=run.stages.find(s=>s.id===draft.stageId);
 assert.equal(hash(stage),draft.acceptedStageSha256);
 const replay=verification.replays.find(r=>r.runId===run.id).records.find(s=>s.stageId===stage.id);assert.equal(hash(stage),replay.stageSha256);
 return addDesignReviewAnnotationSchema.parse(draft.annotationInput);
});
const work={designReviewRuns:new Map(checkpoint.runs.map(r=>[r.id,r]))};
const sourceDigests=annotations.map(input=>({requestKey:input.requestKey,sources:annotationSources(work,input).map(s=>({id:s.id,sha256:hash(s)}))}));
const outputPath=control+'/segment22-annotations.json',output={workId:checkpoint.scope.workId,annotations};
const proof={kind:'design76_segment22_clarification_inputs',verificationPath,verificationSha256:sha(verificationPath),
 checkpointSha256:verification.checkpointSha256,bindingPath,bindingSha256:sha(bindingPath),drafts:draftPaths.map(path=>({path,sha256:sha(path)})),
 outputPath,outputSha256:hash(output),annotationCount:annotations.length,sourceDigests,productionWrites:0,modelCalls:0,formalAcceptance:false,
 limitation:'Exact original claims and source bindings only. Private rehearsal, atomic publication, restart readback and UI checks remain required.'};
const proofPath='docs/audits/2026-10-18-design76-segment22-annotation-inputs.json';
if(process.argv.includes('--check')){assert.deepEqual(read(outputPath),output);assert.deepEqual(read(proofPath),proof);}
else{fs.writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n',{flag:'wx'});fs.writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});}
console.log(JSON.stringify({prepared:true,annotations:annotations.length,productionWrites:0}));
