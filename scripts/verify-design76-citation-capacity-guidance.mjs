// Offline regression of capacity navigation against the two preserved real answers.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {JsonDesignPlanner} from '../packages/planner/src/index.ts';
import {prepareDesignReviewEvidence,applyDesignReviewCitationEdits} from '../packages/planner/src/design-review-evidence.ts';
import {designReviewResultSchema} from '../packages/contracts/src/index.ts';
import {designReviewReportEnvelopeSize} from '../novel-service-core/src/design-review-report.ts';
const read=p=>JSON.parse(fs.readFileSync(p)), sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const failurePath='docs/audits/2026-10-18-design76-citation-budget-failure.json',failure=read(failurePath);
for(const call of failure.calls)assert.equal(sha(call.path),call.sha256);
const verification=read(failure.verificationPath);assert.equal(sha(failure.verificationPath),failure.verificationSha256);
const checkpoint=read(verification.checkpointPath);assert.equal(sha(verification.checkpointPath),failure.checkpointSha256);
const binding=read(failure.runtimeBindingPath);assert.equal(sha(failure.runtimeBindingPath),failure.runtimeBindingSha256);
const {designReviewStageInput}=await import(binding.runtimePath+'/novel-service-core/src/design-review-run.ts');
const {designReviewReportEnvelopeSize:oldSize}=await import(binding.runtimePath+'/novel-service-core/src/design-review-report.ts');
const run=checkpoint.runs.find(r=>r.input.area==='world'),stage=run.stages.find(s=>s.id===failure.stageId);
const input=designReviewStageInput(run,stage),prepared=prepareDesignReviewEvidence(input);
const firstText=read(failure.calls[1].path).response.text, secondText=read(failure.calls[3].path).response.text;
const first=JSON.parse(firstText),second=applyDesignReviewCitationEdits(JSON.parse(secondText),first);
const lookup=new Map(prepared.sources.flatMap(s=>s.fragments.map(f=>[f.id,{sourceId:s.id,quote:f.text}])));
const expand=v=>designReviewResultSchema.parse({...v,checks:v.checks.map(c=>({...c,evidence:c.evidence.map(e=>lookup.get(e.fragmentId))}))});
const contexts=[first,second].map(v=>prepared.resolutionRepairContext(v).reportCapacity);
for(const [i,value]of [first,second].entries()){
 const result=expand(value),size=designReviewReportEnvelopeSize(input,result,input.stage.reportBudget.sourceId);
 assert.equal(size,oldSize(input,result,input.stage.reportBudget.sourceId),'Renderer extraction must preserve report bytes');
 assert.equal(contexts[i].currentCharacters,size);assert.equal(contexts[i].remainingCharacters,90000-size);
}
assert.equal(contexts[0].currentCharacters,83622);assert.equal(contexts[0].remainingCharacters,6378);
assert.equal(contexts[1].currentCharacters,91471);assert.equal(contexts[1].remainingCharacters,-1471);
let calls=0;
const planner=new JsonDesignPlanner({complete:async request=>{
 if(++calls===1){assert.equal(request.user,read(failure.calls[0].path).request.user);return firstText;}
 assert.equal(calls,2);const body=JSON.parse(request.user);
 assert.deepEqual(body.reportCapacity,contexts[0]);assert.match(body.problems,/ms_v2_boundary/);
 return secondText;
}});
await assert.rejects(planner.reviewDesignContent(input),error=>{
 assert.match(error.message,/91471 字符，上限 90000/);assert.deepEqual(error.modelResponses,[firstText,secondText]);return true;
});
assert.equal(calls,2);
const proof={kind:'real_citation_capacity_guidance_regression',verified:true,failurePath,failureSha256:sha(failurePath),
 sourceHashes:Object.fromEntries(['novel-service-core/src/design-review-report.ts','packages/planner/src/design-review-evidence.ts','packages/planner/src/index.ts','packages/planner/test/design-review.test.ts'].map(p=>[p,sha(p)])),
 measurements:contexts.map(c=>({currentCharacters:c.currentCharacters,remainingCharacters:c.remainingCharacters,maxCharacters:c.maxCharacters,fragmentCount:c.fragments.length})),
 rendererSizesUnchanged:true,missingEvidenceStillRejected:true,oversizedRepairStillRejected:true,rawAnswersRetained:true,modelCalls:0,productionWrites:0,formalAcceptance:false};
const out='docs/audits/2026-10-18-design76-citation-capacity-guidance.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(proof));
