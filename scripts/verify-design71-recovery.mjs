// Replay preserved failures and recovered responses without touching the running worker.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {replayDesignReviewRecord} from './audit-design-reviews.mjs';
const read=p=>JSON.parse(fs.readFileSync(p));
const sha=x=>createHash('sha256').update(x).digest('hex');
const fileHash=p=>sha(fs.readFileSync(p));
const root='data/audit-runtimes/design71-review';
const baseline=read(`${root}/baseline.json`),bindingPath='data/audit-runtimes/design71-runtime-bound.json',binding=read(bindingPath);
assert.equal(fileHash(bindingPath),baseline.runtimeBindingSha256);
assert.equal(fileHash('scripts/run-design71-review.mjs'),baseline.runnerSha256);
for(const [p,h]of Object.entries(binding.sourceHashes))assert.equal(fileHash(`${binding.runtimePath}/${p}`),h,p);
assert.equal(fileHash(`${root}/inputs.json`),baseline.inputsSha256);
const inputs=read(`${root}/inputs.json`);
const segmentPaths=[`${root}/segment-0.json`,`${root}/segment-1.json`];
const segments=segmentPaths.map(read);
const bytes=fs.readFileSync(`${root}/result.json`),current=JSON.parse(bytes);
assert.equal(current.segment,2);assert.equal(current.status,'running');process.kill(current.pid,0);
const snapshotPath=`${root}/recovery-prefix.json`,proofPath='docs/audits/2026-10-17-design71-recovery.json';
assert.ok(!fs.existsSync(snapshotPath)&&!fs.existsSync(proofPath),'Preserve prior verification');
const runtime=await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const {JsonDesignPlanner}=await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const replays=[];
for(const [index,state]of [...segments,current].entries()){
 assert.equal(state.segment,index);assert.equal(state.inputHash,baseline.inputHash);
 assert.equal(state.model,'gpt-5.6-luna');assert.equal(state.fallback,false);assert.equal(state.scheduleVersion,32);
 assert.equal(state.runs.length,1);assert.equal(state.runs[0].id,current.runs[0].id);
 assert.deepEqual(state.runs[0].input,inputs.world);
 if(index<2){
  assert.equal(state.status,'stopped_after_failure');
  assert.throws(()=>process.kill(state.pid,0),{code:'ESRCH'});
  assert.equal(state.runs[0].stages.filter(s=>s.result).length,2);
 }
 const replay=await replayDesignReviewRecord(state.runs[0],inputs.world,undefined,{...runtime,JsonDesignPlanner});
 replays.push({segment:index,status:state.status,totalCalls:state.totalCalls,replay});
}
assert.equal(segments[1].priorCheckpointSha256,fileHash(segmentPaths[0]));
assert.equal(current.priorCheckpointSha256,fileHash(segmentPaths[1]));
assert.equal(segments[0].totalCalls,3);assert.equal(segments[1].previousCalls,3);assert.equal(segments[1].totalCalls,4);assert.equal(current.previousCalls,4);
const run=current.runs[0];
for(const id of ['batch-1','batch-2'])for(const state of segments)
 assert.deepEqual(run.stages.find(s=>s.id===id),state.runs[0].stages.find(s=>s.id===id));
const recovered=run.stages.find(s=>s.id==='batch-3');
assert.equal(recovered.attempts,3);assert.ok(recovered.result);assert.equal(recovered.failures.length,2);
assert.deepEqual(recovered.failures,segments[1].runs[0].stages.find(s=>s.id==='batch-3').failures);
assert.deepEqual(recovered.failures[0],segments[0].runs[0].stages.find(s=>s.id==='batch-3').failures[0]);
assert.ok(recovered.failures[0].error.includes('(429)'));assert.ok(recovered.failures[1].error.includes('HTTP/2'));
const cargo=run.stages.find(s=>s.id==='cross-2-4')?.result?.checks.find(c=>c.criterion==='geography');
assert.equal(cargo?.verdict,'insufficient');assert.deepEqual(cargo.awaitingSources,['plan/chapters/31']);
const source=id=>inputs.world.sources.find(s=>s.id===id);
const chapter32=JSON.parse(source('plan/chapters/32').text);
const action=chapter32.scenes.find(s=>s.includes('货索松脱'));
assert.ok(action.includes('半斤索头'));assert.ok(action.includes('水手再系索、用普通船桩受力'));
const proof={verifiedAt:new Date().toISOString(),kind:'design71_same_run_transport_recovery',
 runId:run.id,snapshotPath,snapshotSha256:sha(bytes),inputHash:baseline.inputHash,
 segments:segmentPaths.map(p=>({path:p,sha256:fileHash(p)})),replays,
 recoveredStep:{id:recovered.id,attempts:recovered.attempts,failures:recovered.failures,result:recovered.result},
 originalTwoStagesPreservedExactly:true,originalFailureRecordsPreservedExactly:true,
 retainedNonPassChecks:run.stages.filter(s=>s.result).flatMap(s=>s.result.checks.filter(c=>c.verdict!=='pass')
  .map(c=>({stageId:s.id,criterion:c.criterion,verdict:c.verdict,explanation:c.explanation,awaitingSources:c.awaitingSources}))),
 cargoScope:{originalCheck:{stageId:'cross-2-4',...cargo},
  actualActionSource:source('plan/chapters/32'),requestedSource:source('plan/chapters/31'),
  macroSource:source('plan/milestones/ms_growth_v1_crossing'),
  observation:'Requested chapter31 is inspection/departure; the actual storm cargo action is chapter32. Its unloaded half-jin rope end is moved briefly; sailors and ship posts take the load. Preserve the question and wait for explicit original-source followup; do not edit the correct scene to match the requested chapter number.'},
 modelCalls:0,productionWrites:0,formalAcceptance:false,
 limitation:'Verifies only captured checkpoint prefixes, not the terminal run or production database. No question is resolved by this audit; pending source reads and their actual judgments remain necessary.'};
fs.writeFileSync(snapshotPath,bytes,{flag:'wx'});
fs.writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({runId:run.id,replays:replays.map(r=>({segment:r.segment,responses:r.replay.responsesReplayed})),
 completedStages:run.stages.filter(s=>s.result).length,retainedNonPassChecks:proof.retainedNonPassChecks.length,modelCalls:0,formalAcceptance:false}));
