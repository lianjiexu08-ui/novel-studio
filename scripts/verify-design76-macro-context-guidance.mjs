// Reproduce the field conflict and hidden invalid source IDs in calls 75/76.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {JsonDesignPlanner} from '../packages/planner/src/index.ts';
import {prepareDesignReviewEvidence} from '../packages/planner/src/design-review-evidence.ts';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const control='data/audit-runtimes/design76-advice-review',verificationPath='docs/audits/2026-10-18-design76-advice-review-segment-12.json',verification=read(verificationPath);
assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);const state=read(verification.checkpointPath);
assert.equal(state.status,'stopped_after_failure');assert.equal(state.totalCalls,76);
const bindingPath='data/audit-runtimes/design76-citation-unique-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {designReviewStageInput}=await import(binding.runtimePath+'/novel-service-core/src/design-review-run.ts');
const run=state.runs.find(r=>r.input.area==='story'),stage=run.stages.find(s=>s.id==='cross-2-5');assert.ok(!stage.result);
const input=designReviewStageInput(run,stage),prepared=prepareDesignReviewEvidence(input);
const paths=[75,76].flatMap(n=>['started','response'].map(kind=>`${control}/model-calls/${String(n).padStart(5,'0')}.${kind}.json`));
const request=JSON.parse(read(paths[0]).request.user),firstText=read(paths[1]).response.text,secondText=read(paths[3]).response.text;
const first=JSON.parse(firstText),second=JSON.parse(secondText),oldRepair=JSON.parse(read(paths[2]).request.user);
assert.equal(prepared.requestId,request.requestId);assert.deepEqual(prepared.sources,request.sources);
assert.throws(()=>prepared.resolve(first),/不能同时出现/);assert.throws(()=>prepared.resolve(second),/plan\/chapters\/51/);
assert.ok(!oldRepair.awaitingSourceProblems);
let calls=0,repair;
await assert.rejects(new JsonDesignPlanner({complete:async call=>{
 if(++calls===1){assert.equal(call.user,read(paths[0]).request.user);return firstText;}
 assert.equal(calls,2);repair=JSON.parse(call.user);return secondText;
}}).reviewDesignContent(input),/plan\/chapters\/51/);
assert.deepEqual(repair.awaitingSourceProblems,[{checkIndex:2,criterion:'payoff',invalidSourceIds:['plan/chapters/51','plan/chapters/52','plan/chapters/53']}]);
assert.deepEqual(repair.fieldProblems,[{checkIndex:2,criterion:'payoff',issues:['conflicts_with_awaiting_sources']}]);
assert.equal(request.planningHorizon.detailedThroughChapter,50);
const macroRanges=request.stage.coverage.planRanges.filter(p=>p.startChapter<=51&&p.endChapter>=53);
assert.ok(macroRanges.some(p=>p.sourceId==='plan/milestones/ms_v2_fire'));
assert.deepEqual(repair.macroSourceCandidates.map(({unitsInThisRequest,...range})=>range),macroRanges);
for(const candidate of repair.macroSourceCandidates){
 assert.ok(Object.hasOwn(request.stage.coverage.sourceLengths,candidate.sourceId));
 assert.deepEqual(candidate.unitsInThisRequest,request.sources.filter(s=>(s.origin?.sourceId??s.id)===candidate.sourceId).map(s=>s.id));
}
assert.deepEqual(repair.planningHorizon,request.planningHorizon);

const proof={kind:'design76_macro_source_repair_navigation',verificationPath,verificationSha256:sha(verificationPath),checkpointSha256:verification.checkpointSha256,
 bindingPath,bindingSha256:sha(bindingPath),calls:paths.map(path=>({path,sha256:sha(path)})),originalAndRepairStillRejected:true,
 sourceFiles:Object.fromEntries(['packages/planner/src/index.ts','packages/planner/src/design-review-evidence.ts'].map(p=>[p,sha(p)])),
 fieldProblems:repair.fieldProblems,awaitingSourceProblems:repair.awaitingSourceProblems,planningHorizon:request.planningHorizon,macroRanges,
 macroSourceCandidates:repair.macroSourceCandidates,availableSourceIds:repair.availableSourceIds,repairInstruction:repair.instruction,offlinePlannerCalls:calls,modelCalls:0,productionWrites:0,formalAcceptance:false,
 limitation:'Offline reproduction and joint diagnostics only. No automatic source substitution, extra retries, new chapters or accepted model answers; isolated real-model verification is still required.'};
const out='docs/audits/2026-10-18-design76-macro-context-guidance.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,bothRejected:true,invalidSources:repair.awaitingSourceProblems[0].invalidSourceIds,modelCalls:0,productionWrites:0}));
