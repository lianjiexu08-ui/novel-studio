// Verify a stopped segment or final design76 run without model/network calls.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';import {PrismaWorkRepository} from '../packages/persistence/src/prisma-repository.ts';
import {replayDesignReviewRecord} from './audit-design-reviews.mjs';
import {sourceNavigationGuidance} from './design-review-source-navigation.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),read=p=>JSON.parse(fs.readFileSync(p));
const control='data/audit-runtimes/design76-review',checkpointPath=`${control}/result.json`,checkpointHash=fileHash(checkpointPath),state=read(checkpointPath),baseline=read(`${control}/baseline.json`),binding=read('data/audit-runtimes/design76-runtime-bound.json');
assert.ok(['stopped_after_stage_limit','stopped_after_failure','stopped_after_budget','stopped_by_signal','completed'].includes(state.status),'Wait for a terminal worker checkpoint');
try{process.kill(state.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
assert.equal(fileHash('scripts/run-design76-review.mjs'),baseline.runnerSha256);assert.equal(hash(sourceNavigationGuidance),baseline.guidanceHash);
assert.equal(fileHash('data/audit-runtimes/design76-runtime-bound.json'),baseline.runtimeBindingSha256);
for(const [file,h]of Object.entries(binding.sourceHashes))assert.equal(fileHash(`${binding.runtimePath}/${file}`),h,file);
for(const [file,h]of Object.entries(binding.dependencyHashes))assert.equal(fileHash(file),h,file);
assert.equal(fileHash(`${control}/inputs.json`),baseline.inputsSha256);
const inputs=read(`${control}/inputs.json`),runtime=await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`),{JsonDesignPlanner}=await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const journalDirectory=`${control}/model-calls`,starts=fs.readdirSync(journalDirectory).filter(n=>n.endsWith('.started.json')).sort();assert.equal(starts.length,state.totalCalls);
const calls=starts.map((name,i)=>{
 const start=read(`${journalDirectory}/${name}`);assert.equal(start.callNumber,i+1);
 const responsePath=`${journalDirectory}/${name.replace('.started.json','.response.json')}`,failurePath=`${journalDirectory}/${name.replace('.started.json','.failure.json')}`;
 assert.notEqual(fs.existsSync(responsePath),fs.existsSync(failurePath),'Each dispatched call needs exactly one durable outcome');
 const response=fs.existsSync(responsePath)?read(responsePath):undefined,failure=fs.existsSync(failurePath)?read(failurePath):undefined;
 assert.equal((response??failure).callNumber,start.callNumber);
 return {start,response,failure,startSha256:fileHash(`${journalDirectory}/${name}`),outcomeSha256:fileHash(response?responsePath:failurePath)};
});
const replays=[];
for(const run of state.runs){
 assert.deepEqual(run.input,inputs[run.input.area]);
 const acceptedCalls=[];
 for(const stage of run.stages){
  const journal=calls.filter(c=>c.start.step.runId===run.id&&c.start.step.stageId===stage.id);
  const raw=journal.flatMap(c=>c.response?[c.response.response.text]:[]);
  const saved=[...(stage.failures??[]).flatMap(f=>f.modelResponses??[]),...(stage.result?stage.modelResponses??[]:[])];
  assert.deepEqual(raw,saved,`Raw call journal differs from persisted stage ${stage.id}`);
  if(stage.result) acceptedCalls.push(...journal.filter(c=>c.response).slice(-(stage.modelResponses?.length??0)));
 }
 let replayCall=0;
 class JournalCheckingPlanner extends JsonDesignPlanner {
  constructor(client){super({complete:async request=>{
   const recorded=acceptedCalls[replayCall++]?.start.request;assert.ok(recorded,'No matching journal request');
   assert.equal(recorded.user,request.user,'Saved request differs from reconstructed stage sources');
   assert.equal(recorded.maxOutputTokens,request.maxOutputTokens);assert.equal(recorded.role,request.role??'reviewing');
   assert.ok(recorded.system.startsWith(request.system));assert.ok(recorded.system.endsWith(sourceNavigationGuidance));
   assert.equal(hash(recorded.system.slice(request.system.length,-sourceNavigationGuidance.length)),baseline.suffixSha256);
   return client.complete(request);
  }});}
 }
 const audited=await replayDesignReviewRecord(run,inputs[run.input.area],state.reports.find(r=>r.id===run.reportId),{...runtime,JsonDesignPlanner:JournalCheckingPlanner});
 assert.equal(replayCall,acceptedCalls.length);
 replays.push({area:run.input.area,runId:run.id,...audited});
}
assert.ok(calls.every(c=>state.runs.some(r=>r.id===c.start.step.runId && r.stages.some(s=>s.id===c.start.step.stageId))));
const snapshotDirectory=fs.mkdtempSync(path.resolve(control,`verify-segment-${state.segment}-`)),dbPath=path.join(snapshotDirectory,'production.db');
execFileSync('python3',['-c',"import sqlite3,sys; src=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); dst=sqlite3.connect(sys.argv[2]); src.backup(dst); dst.close(); src.close()",path.resolve('data/novel-studio.db'),dbPath]);
const prisma=new PrismaClient({datasources:{db:{url:'file:'+dbPath}}}),repo=new PrismaWorkRepository(prisma);let work;
try{work=await repo.get(baseline.workId);}finally{await repo.disconnect();await prisma.$disconnect();}
assert.ok(work);
const protectedHash=hash({world:work.worldPack,bible:work.storyBible,plans:[...work.plans],activePlanId:work.activePlanId,designHistory:[...work.designHistory],versions:[...work.versions],events:[...work.events],manuscripts:[...work.manuscripts],candidates:[...work.candidates]});
assert.equal(protectedHash,baseline.protectedHash);
for(const[id,h]of baseline.oldRuns)assert.equal(hash(work.designReviewRuns.get(id)),h);
for(const[id,h]of baseline.oldReports)assert.equal(hash(work.designContentReviews.get(id)),h);
for(const run of state.runs)assert.deepEqual(work.designReviewRuns.get(run.id),run);
for(const report of state.reports)assert.deepEqual(work.designContentReviews.get(report.id),report);
assert.equal(work.designReviewRuns.size,baseline.oldRuns.length+state.runs.length);assert.equal(work.designContentReviews.size,baseline.oldReports.length+state.reports.length);
assert.equal(work.worldPack.revision,40);assert.equal(work.storyBible.revision,72);assert.equal(work.plans.get(baseline.planId).revision,76);assert.equal(work.plans.get(baseline.planId).status,'proposed');assert.equal(work.plans.get(work.activePlanId).revision,10);
if(state.status==='completed'){assert.deepEqual(state.runs.map(r=>r.input.area).sort(),['characters','power','story','world']);assert.equal(state.reports.length,4);assert.ok(state.runs.every(r=>r.status==='completed'));}
assert.equal(fileHash(checkpointPath),checkpointHash);
const terminalPath=`${control}/terminal-segment-${state.segment}.json`;
if(fs.existsSync(terminalPath))assert.equal(fileHash(terminalPath),checkpointHash);else fs.copyFileSync(checkpointPath,terminalPath,fs.constants.COPYFILE_EXCL);
const proof={observedAt:new Date().toISOString(),status:state.status,segment:state.segment,checkpointPath:terminalPath,checkpointSha256:checkpointHash,workerAbsent:true,sourceCommit:binding.sourceCommit,runnerSha256:baseline.runnerSha256,inputsSha256:baseline.inputsSha256,model:state.model,fallback:state.fallback,totalCallAttempts:starts.length,successfulResponses:calls.filter(c=>c.response).length,failedAttempts:calls.filter(c=>c.failure).length,unsettledCalls:0,journal:calls.map(c=>({callNumber:c.start.callNumber,step:c.start.step,responseSha256:c.response?hash(c.response.response.text):undefined,startSha256:c.startSha256,outcomeSha256:c.outcomeSha256,usage:(c.response??c.failure).usage})),replays,preserved:{protectedHash,oldRuns:baseline.oldRuns.length,oldReports:baseline.oldReports.length},productionVerification:'read_only_sqlite_backup',databaseSnapshotPath:dbPath,modelCalls:0,productionWrites:0,formalAcceptance:false,proseGenerated:false,limitation:state.status==='completed'?'Evidence integrity verification; content verdicts, unresolved blockers and approval remain separate.':'Verified incomplete prefix only; pending stages and formal quality acceptance remain unproven.'};
const out=`docs/audits/2026-10-18-design76-review-segment-${state.segment}.json`;assert.ok(!fs.existsSync(out));fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx',flush:true});
console.log(JSON.stringify({verified:true,status:state.status,segment:state.segment,calls:starts.length,areas:replays.map(r=>({area:r.area,completed:r.completedStages,total:r.totalStages})),oldRunsPreserved:baseline.oldRuns.length,oldReportsPreserved:baseline.oldReports.length,formalAcceptance:false}));
