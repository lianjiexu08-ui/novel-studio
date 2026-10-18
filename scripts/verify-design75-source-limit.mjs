// Replay the detached probe and measure actual complete-source followup inputs.
// Other raw steps use synthetic results ONLY to expose scheduler capacity;
// they are never stored, reviewed for quality, or synthesized into a report.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {JsonDesignPlanner} from '../packages/planner/src/index.ts';
import {createDesignReviewRun,designReviewStageInput,acceptDesignReviewStage,designReviewCapacity} from '../novel-service-core/src/design-review-run.ts';
const read=p=>JSON.parse(fs.readFileSync(p)),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const control='data/audit-runtimes/design75-source-limit-probe',state=read(`${control}/result.json`),input=read(`${control}/input.json`);
assert.equal(state.status,'completed');assert.equal(hash(input),state.inputHash);
let calls=0;
const result=await new JsonDesignPlanner({complete:async req=>{
 const recorded=state.requests[calls];assert.ok(recorded);assert.equal(req.user,recorded.user);assert.ok(recorded.system.startsWith(req.system));
 return state.rawResponses[calls++];
}}).reviewDesignContent(input);
assert.equal(calls,state.rawResponses.length);assert.deepEqual(result,state.result);
const formalProof=read('docs/audits/2026-10-18-design75-review-segment-0.json');
assert.equal(fileHash(formalProof.checkpointPath),formalProof.checkpointSha256);
const checkpoint=read(formalProof.checkpointPath),original=checkpoint.runs.find(r=>r.input.area==='story');
assert.equal(hash(original.stages[0].result),state.originalResultSha256);
const run=createDesignReviewRun(original.input,original.createdAt,original.scheduleVersion);
assert.deepEqual(designReviewStageInput(run,run.stages[0]),input);
const completeRequestOnly=process.argv.includes('--complete-request-only');
const {modelResponses,...replayedContent}=result;
const content=completeRequestOnly?structuredClone(original.stages[0].result):replayedContent;
if(completeRequestOnly){
 const all=original.input.sources.filter(s=>/^plan\/(chapters|milestones)\//.test(s.id)).map(s=>s.id);
 assert.equal(all.length,68);
 for(const check of content.checks.filter(c=>['causality','timeline'].includes(c.criterion))){
  assert.equal(check.insufficiencyReason,'capacity_limit');
  delete check.insufficiencyReason;check.awaitingSources=all;
 }
}
acceptDesignReviewStage(run,run.stages[0],content);
for(const stage of run.stages.filter(s=>s.kind!=='synthesis'&&!s.followupFor).slice(1)){
 const staged=designReviewStageInput(run,stage),source=staged.sources[0];
 acceptDesignReviewStage(run,stage,{summary:'Synthetic scheduling fixture; no content review.',checks:Object.keys(staged.rubric).map(criterion=>({criterion,verdict:'pass',explanation:'Synthetic capacity fixture only.',evidence:[{sourceId:source.id,quote:source.text.slice(0,40)}],revisionAdvice:''}))});
}
const followups=run.stages.filter(s=>s.followupFor).map(stage=>{
 const staged=designReviewStageInput(run,stage),pending=staged.stage.coverage.pendingChecks.find(p=>p.id===stage.followupFor);
 const required=[...new Set([...pending.requiredSourceIds,...pending.priorSourceIds??[]])];
 for(const id of required){const source=run.input.sources.find(s=>s.id===id);assert.ok(source);
 const units=staged.stage.sourceMap.filter(u=>u.sourceId===id).sort((a,b)=>a.start-b.start);
 assert.equal(units.map(u=>staged.sources.find(s=>s.id===u.id).text).join(''),source.text,id);}
 const characters=JSON.stringify(staged.sources).length;assert.ok(characters<=designReviewCapacity);
 return {stageId:stage.id,criterion:pending.criterion,requestedSources:pending.requiredSourceIds.length,mandatorySources:required.length,characters,fullMandatorySourcesVerified:true};
});
const checks=result.checks.map(c=>({criterion:c.criterion,verdict:c.verdict,awaitingSources:c.awaitingSources?.length,insufficiencyReason:c.insufficiencyReason}));
if(completeRequestOnly)for(const criterion of ['causality','timeline'])assert.ok(followups.some(f=>f.criterion===criterion&&f.requestedSources===68),'Complete original requested range must fit');
const proof={kind:'design75_detached_source_limit_probe_verified',createdAt:new Date().toISOString(),inputSha256:hash(input),resultFileSha256:fileHash(`${control}/result.json`),responsesReplayed:calls,checks,followups,
 rawSourceCapacity:designReviewCapacity,originalCheckpointUnchanged:fileHash(formalProof.checkpointPath)===formalProof.checkpointSha256,syntheticOtherRawSteps:true,
 syntheticCompleteRequest:completeRequestOnly,
 modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Replays a real local response; synthetic raw-stage completion demonstrates followup scheduling and full-source capacity only. No new followup content verdict or formal review is proven.'};
fs.writeFileSync(`docs/audits/2026-10-18-design75-source-limit-${completeRequestOnly?'complete-request':'verified'}.json`,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,checks,followups,formalAcceptance:false}));
