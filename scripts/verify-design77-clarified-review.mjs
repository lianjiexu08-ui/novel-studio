// Independent offline replay of every accepted answer and exact request, plus
// raw failed-attempt reconciliation and a fresh read-only production snapshot.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {replayDesignReviewRecord} from './audit-design-reviews.mjs';
import {sourceNavigationGuidance} from './design-review-source-navigation.mjs';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash=v=>createHash('sha256').update(JSON.stringify(v,(_,x)=>x instanceof Map?[...x]:x)).digest('hex');
const control='data/audit-runtimes/design77-clarified-review',checkpointPath=`${control}/result.json`,checkpointHash=sha(checkpointPath);
const state=read(checkpointPath),baseline=read(`${control}/baseline.json`),prior=read(`${control}/predecessor.json`);
assert.ok(['completed','failed','stopped_by_signal','stopped_after_stage_limit','stopped_after_budget','stopped_for_content_inspection'].includes(state.status));
try{process.kill(state.pid,0);assert.fail('Worker is live');}catch(e){assert.equal(e.code,'ESRCH');}
assert.equal(sha(`${control}/baseline.json`),state.baselineSha256);
assert.equal(sha(`${control}/baseline.json`),read('docs/audits/2026-10-20-design77-clarified-review-preflight.json').baselineSha256);
const bindingPath='data/audit-runtimes/design77-navigation-runtime-bound.json',binding=read(bindingPath);
for(const [file,digest]of [[bindingPath,baseline.bindingSha256],['scripts/run-design77-clarified-review.mjs',baseline.runnerSha256],
 [`${control}/runner.mjs`,baseline.runnerSha256],['scripts/shared-review-host.mjs',baseline.hostSha256],['scripts/design-review-source-navigation.mjs',baseline.guidanceSha256],
 [`${control}/predecessor.json`,baseline.predecessorSha256],['docs/audits/2026-10-20-design77-navigation-continuation-segment-3.json',baseline.verificationSha256],
 ['docs/audits/2026-10-20-design77-payoff-clarification.json',baseline.noteSha256],[`${control}/prefix-journal.json`,baseline.prefixSha256]])assert.equal(sha(file),digest);
for(const [file,digest]of Object.entries(binding.sourceHashes))assert.equal(sha(`${binding.runtimePath}/${file}`),digest);
for(const [file,digest]of Object.entries(binding.dependencyHashes))assert.equal(sha(file),digest);
const calls=read(`${control}/prefix-journal.json`).map(item=>{
 assert.equal(sha(item.startPath),item.startSha256);assert.equal(sha(item.outcomePath),item.outcomeSha256);
 const start=read(item.startPath);if(item.runId)start.step.runId=item.runId;
 const outcome=read(item.outcomePath);
 return {...item,start,response:outcome.response,failure:outcome.response?undefined:outcome};
});
assert.equal(calls.length,43);
const starts=fs.readdirSync(`${control}/model-calls`).filter(f=>/^\d{5}\.started\.json$/.test(f)).sort();assert.equal(starts.length,state.calls);
const newCalls=starts.map((name,index)=>{
 const file=`${control}/model-calls/${name}`,start=read(file);assert.equal(start.number,index+1);
 const responsePath=file.replace('.started.','.response.'),failurePath=file.replace('.started.','.failure.');
 assert.notEqual(fs.existsSync(responsePath),fs.existsSync(failurePath));
 const outPath=fs.existsSync(responsePath)?responsePath:failurePath,out=read(outPath);assert.equal(out.number,start.number);
 return {key:`clarified/${start.number}`,start,response:out.response,failure:out.response?undefined:out,startPath:file,outcomePath:outPath,startSha256:sha(file),outcomeSha256:sha(outPath),formal:false};
});
calls.push(...newCalls);
const runtime=await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const {JsonDesignPlanner}=await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const oldSuffixHash=read('data/audit-runtimes/design77-formal-continuation/baseline.json').suffixSha256;
const replays=[];let preservedStages=0;
for(const run of state.runs){
 const old=prior.runs.find(r=>r.id===run.id);assert.ok(old);assert.deepEqual(run.input,old.input);
 for(const stage of old.stages.filter(s=>s.result)){assert.deepEqual(run.stages.find(s=>s.id===stage.id),stage);preservedStages++;}
 const accepted=[];
 for(const stage of run.stages){
  const received=calls.filter(c=>c.start.step.runId===run.id&&c.start.step.stageId===stage.id&&c.response);
  const saved=[...(stage.failures??[]).flatMap(f=>f.modelResponses??[]),...(stage.result?stage.modelResponses??[]:[])];
  assert.deepEqual(received.map(c=>c.response.text),saved,`${run.input.area}/${stage.id}: raw answers differ`);
  if(stage.result){assert.ok(stage.modelResponses?.length);accepted.push(...received.slice(-stage.modelResponses.length));}
 }
 let count=0;
 class JournalPlanner extends JsonDesignPlanner{
  constructor(client){super({complete:async request=>{
   const entry=accepted[count++];assert.ok(entry);
   assert.equal(request.user,entry.start.request.user);assert.equal(request.maxOutputTokens,entry.start.request.maxOutputTokens);
   if(entry.formal)assert.equal(request.system,entry.start.request.system);
   else if(entry.key.startsWith('original/')){
    assert.ok(entry.start.request.system.startsWith(request.system));assert.ok(entry.start.request.system.endsWith(sourceNavigationGuidance));
    assert.equal(hash(entry.start.request.system.slice(request.system.length,-sourceNavigationGuidance.length)),oldSuffixHash);
   }else assert.equal(entry.start.request.system,request.system+sourceNavigationGuidance);
   return client.complete(request);
  }});}
 }
 const replay=await replayDesignReviewRecord(run,run.input,state.reports.find(r=>r.id===run.reportId),{...runtime,JsonDesignPlanner:JournalPlanner});
 assert.equal(count,accepted.length);replays.push({area:run.input.area,...replay});
}
assert.equal(preservedStages,33);
assert.equal(state.runs.reduce((n,r)=>n+r.stages.filter(s=>s.result).length,0)-preservedStages,state.completed.length);
for(const item of state.completed){
 const run=state.runs.find(r=>r.id===item.runId);assert.ok(run);
 assert.deepEqual(run.stages.find(s=>s.id===item.stageId).result,item.result);
}
assert.ok(newCalls.every(c=>state.runs.some(r=>r.id===c.start.step.runId&&r.stages.some(s=>s.id===c.start.step.stageId))));
const snapshot=path.join(fs.mkdtempSync(path.resolve(control,'verify-')),'production.db');
execFileSync('python3',['-c',"import sqlite3,sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()",path.resolve('data/novel-studio.db'),snapshot]);
const {PrismaClient}=createRequire(`${binding.runtimePath}/package.json`)('@prisma/client');
const {PrismaWorkRepository}=await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const client=new PrismaClient({datasources:{db:{url:`file:${snapshot}`}}}),repo=new PrismaWorkRepository(client);let work;
try{work=await repo.get(baseline.workId);}finally{await repo.disconnect();await client.$disconnect();}assert.ok(work);
const fields=Object.fromEntries(Object.keys(work).sort().map(k=>[k,hash(work[k])]));assert.deepEqual(fields,state.workFields);
for(const [key,digest]of Object.entries(baseline.fields))if(!['designReviewRuns','designContentReviews','constraintRevision'].includes(key))assert.equal(fields[key],digest,key);
for(const [id,digest]of baseline.oldRuns)assert.equal(hash(work.designReviewRuns.get(id)),digest);
for(const [id,digest]of baseline.oldReports)assert.equal(hash(work.designContentReviews.get(id)),digest);
for(const [id,digest]of baseline.oldAnnotations)assert.equal(hash(work.designReviewAnnotations.get(id)),digest);
for(const run of state.runs)assert.deepEqual(work.designReviewRuns.get(run.id),run);
for(const report of state.reports)assert.deepEqual(work.designContentReviews.get(report.id),report);
assert.equal(work.designReviewRuns.size,103);assert.equal(work.designContentReviews.size,92+state.reports.length);assert.equal(work.designReviewAnnotations.size,45);
assert.equal(work.plans.get(baseline.planId).status,'proposed');assert.equal(work.plans.get(work.activePlanId).revision,10);
assert.equal(work.plans.get(baseline.planId).plan.chapters.length,50);assert.ok([...work.designReviewRuns.values()].every(r=>!r.leaseToken));
assert.equal(sha(checkpointPath),checkpointHash);fs.copyFileSync(checkpointPath,`${control}/terminal.json`,fs.constants.COPYFILE_EXCL);
const proof={verified:true,status:state.status,checkpointSha256:checkpointHash,baselineSha256:sha(`${control}/baseline.json`),
 sourceCommit:binding.sourceCommit,runtimeBindingSha256:baseline.bindingSha256,runnerSha256:baseline.runnerSha256,runnerBoundBeforeExecution:true,
 prefixCalls:43,newCalls:newCalls.length,newResponses:newCalls.filter(c=>c.response).length,newFailures:newCalls.filter(c=>c.failure).length,
 unsettledCalls:0,completedStages:state.completed.length,originalStagesPreserved:33,oldRunsPreserved:99,oldReportsPreserved:92,oldAnnotationsPreserved:45,
 journal:newCalls.map(({start,response,failure,...entry})=>({...entry,step:start.step,hasResponse:!!response})),replays,
 databaseSnapshotPath:snapshot,modelCalls:0,productionWrites:0,formalAcceptance:false,proseGenerated:false,
 limitation:'Independent evidence replay and preservation checks; local verdicts are not global quality approval.'};
fs.writeFileSync('docs/audits/2026-10-20-design77-clarified-review-verified.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx',flush:true});
console.log(JSON.stringify({verified:true,status:state.status,completed:state.completed.length,calls:newCalls.length,areas:replays.map(r=>({area:r.area,completed:r.completedStages,total:r.totalStages})),formalAcceptance:false}));
