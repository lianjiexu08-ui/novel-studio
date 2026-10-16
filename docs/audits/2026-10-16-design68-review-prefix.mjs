import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {replayDesignReviewPrefix} from '../../scripts/audit-design-reviews.mjs';
const read=p=>JSON.parse(fs.readFileSync(p));
const fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const control='data/audit-runtimes/design68-review', binding=read('data/audit-runtimes/design68-runtime-bound.json');
const checkpointPath=control+'/first-prefix.json';
assert.ok(!fs.existsSync(checkpointPath),'Preserve the original snapshot');
fs.copyFileSync(control+'/result.json',checkpointPath,fs.constants.COPYFILE_EXCL);
const checkpoint=read(checkpointPath),baseline=read(control+'/baseline.json');
assert.equal(checkpoint.inputHash,baseline.inputHash);
assert.equal(checkpoint.runnerSha256,baseline.runnerSha256);
for(const [p,h] of Object.entries(binding.sourceHashes))assert.equal(fileHash(binding.runtimePath+'/'+p),h,p);
const stages=await import(binding.runtimePath+'/novel-service-core/src/design-review-run.ts');
const {JsonDesignPlanner}=await import(binding.runtimePath+'/packages/planner/src/index.ts');
const results=[];
for(const run of checkpoint.runs){
 const completed=run.stages.filter(s=>s.result);
 assert.ok(completed.length>0);
 const replay=await replayDesignReviewPrefix(run,run.input,{...stages,JsonDesignPlanner});
 results.push({area:run.input.area,runId:run.id,completed:completed.length,total:run.stages.length,replay,
  checks:completed.flatMap(s=>s.result.checks.map(c=>({stageId:s.id,criterion:c.criterion,verdict:c.verdict,
    awaitingSources:c.awaitingSources??[],insufficiencyReason:c.insufficiencyReason,
    explanation:c.explanation,revisionAdvice:c.revisionAdvice}))),
  retainedResponses:completed.reduce((n,s)=>n+(s.modelResponses?.length??0),0)});
}
const proof={kind:'design68_saved_review_prefix_verified',observedAt:new Date().toISOString(),planId:baseline.planId,inputHash:baseline.inputHash,
 checkpointPath,checkpointSha256:fileHash(checkpointPath),runtimePath:binding.runtimePath,
 sourceFilesVerified:Object.keys(binding.sourceHashes).length,areas:results,
 modelCalls:0,productionWrites:0,formalAcceptance:false,questionsResolved:0,
 limitation:'Offline replay verifies the saved prefix and citation/source binding, not final content quality or review completion.'};
fs.writeFileSync('docs/audits/2026-10-16-design68-review-prefix.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({areas:results.map(({area,completed,total,replay})=>({area,completed,total,replay})),formalAcceptance:false}));
