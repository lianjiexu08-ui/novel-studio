import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root='/Users/lianjie/Documents/ChatGPT/novel';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const execute=process.argv.includes('--execute'),rehearsal=process.argv.includes('--rehearse-failure');
assert.ok(!rehearsal, 'This recovery is bound to the preceding recovery checkpoint; use the original script for rehearsals');
const recovery=Number(process.argv.find(a=>a.startsWith('--recovery='))?.split('=')[1]);
assert.ok(Number.isSafeInteger(recovery)&&recovery>=2,'Pass --recovery=N, N >= 2');
const binding=read(root+'/data/audit-runtimes/design64-runtime-bound.json');
const baseline=read(root+'/data/audit-runtimes/design64-control/baseline.json');
const priorPath=root+'/data/audit-runtimes/design64-control/'+(rehearsal?'resume-rehearsal-baseline.json':`resume-${recovery-1}-result.json`);
const priorBytes=fs.readFileSync(priorPath,'utf8'),prior=JSON.parse(priorBytes);
const expectedSha=process.argv.find(a=>a.startsWith('--prior-sha256='))?.split('=')[1];
assert.match(expectedSha??'',/^[a-f0-9]{64}$/,'Exact prior checkpoint hash required');
assert.equal(hash(priorBytes),expectedSha,'Prior checkpoint changed');
assert.deepEqual(prior.areas.map(a=>a.area),['world','power','characters','story']);
const {auditReviewRecoveryChain}=await import(root+'/scripts/audit-review-recovery-chain.mjs');
const chainPaths=[root+'/data/audit-runtimes/design64-control/result.json',...Array.from({length:recovery-1},(_,i)=>root+`/data/audit-runtimes/design64-control/resume-${i+1}-result.json`)];
auditReviewRecoveryChain(chainPaths.map(p=>fs.readFileSync(p)));
for(const p of chainPaths){let live=false;try{process.kill(read(p).pid,0);live=true}catch(e){if(e.code!=='ESRCH')throw e}assert.equal(live,false,'Prior worker is still live');}
if(rehearsal)assert.equal(prior.rehearsalOnly,true);
else {
 assert.equal(prior.status,'stopped_after_failure','The current worker must finish; do not overlap or restart a live worker');
 let alive=false;try{process.kill(prior.pid,0);alive=true}catch(error){if(error.code!=='ESRCH')throw error}
 assert.equal(alive,false,'Original worker still live; wait for its exit');
}
assert.equal(prior.runtimeCommit,binding.commit);assert.equal(prior.scheduleVersion,25);assert.equal(binding.scheduleVersion,25);
assert.equal(prior.rubricVersion,binding.rubricVersion);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(hash(fs.readFileSync(binding.root+'/'+p,'utf8')),h,p);
const runner=fs.readFileSync(root+'/data/audit-runtimes/design64-control/run.mjs','utf8');
assert.equal(hash(runner),binding.runnerSha256);
const suffixLiteral=runner.match(/const suffix='((?:\\.|[^'\\])*)';/)?.[1];assert.ok(suffixLiteral);
const suffix=JSON.parse('"'+suffixLiteral.replace(/"/g,'\\"')+'"');
assert.equal(hash(suffix),prior.suffixSha256,'Recovery prompt changed');
if(rehearsal){
 assert.ok(process.env.DATABASE_URL?.startsWith('file:/'));
 const db=process.env.DATABASE_URL.slice(5),prod=root+'/data/novel-studio.db';
 assert.notEqual(fs.realpathSync(db),fs.realpathSync(prod));assert.notEqual(fs.statSync(db).ino,fs.statSync(prod).ino);
}else assert.equal(process.env.DATABASE_URL,'file:'+root+'/data/novel-studio.db');
const {PrismaWorkRepository}=await import(binding.root+'/packages/persistence/src/prisma-repository.ts');
const {ChapterWorkflow}=await import(binding.root+'/packages/application/src/index.ts');
const {designReviewHash}=await import(binding.root+'/novel-service-core/src/design-review.ts');
const repo=new PrismaWorkRepository(),workId=prior.scope.workId;
const protectedHash=w=>hash({world:w.worldPack,bible:w.storyBible,plans:[...w.plans],versions:[...w.versions],events:[...w.events],manuscripts:[...w.manuscripts],candidates:[...w.candidates]});
function verify(w,exact=false){
 assert.equal(protectedHash(w),baseline.protectedHash);
 for(const[id,h]of baseline.oldRuns)assert.equal(hash(w.designReviewRuns.get(id)),h);
 for(const[id,h]of baseline.oldReports)assert.equal(hash(w.designContentReviews.get(id)),h);
 for(const report of prior.reports??[])assert.equal(hash(w.designContentReviews.get(report.id)),hash(report));
 for(const old of prior.runs){
  const run=w.designReviewRuns.get(old.id);assert.ok(run);assert.equal(hash(run.input),hash(old.input));
  assert.equal(run.scheduleVersion,old.scheduleVersion);assert.equal(designReviewHash(w,run.input.scope.planRevisionId),run.input.inputHash);
  if(exact)assert.equal(hash(run),hash(old),'Checkpoint stale: inspect persisted state before recovery');
  for(const stage of old.stages){
   const current=run.stages.find(s=>s.id===stage.id);assert.ok(current);
   if(stage.result)assert.equal(hash(current),hash(stage),'Completed stage changed');
   assert.equal(hash((current.failures??[]).slice(0,(stage.failures??[]).length)),hash(stage.failures??[]));
  }
 }
}
try{
 const w=await repo.get(workId);verify(w,true);
 const leaseRuns=rehearsal?prior.areas.map(a=>w.designReviewRuns.get(a.runId)):[...w.designReviewRuns.values()];
 assert.ok(!leaseRuns.some(r=>r.leaseToken&&Date.parse(r.leaseExpiresAt??'')>Date.now()),'Review lease still active');
 const targets=prior.areas.filter(a=>w.designReviewRuns.get(a.runId).status!=='completed');
 assert.ok(targets.length,'No failed review requires recovery');assert.ok(targets.every(a=>w.designReviewRuns.get(a.runId).status==='failed'),'Only failed runs may resume');
 assert.equal(prior.totalCalls,prior.priorUsage.calls+prior.resumeUsage.calls);const remainingCalls=prior.maxCalls-prior.totalCalls;assert.ok(remainingCalls>0);
 if(!execute&&!rehearsal){console.log(JSON.stringify({status:'preflight_passed',priorCheckpointSha256:hash(priorBytes),targets,remainingCalls,modelCalls:0,databaseWrites:false}));}
 else{
  const out=root+'/data/audit-runtimes/design64-control/'+(rehearsal?'resume-rehearsal-result.json':`resume-${recovery}-result.json`);
  assert.ok(!fs.existsSync(out),'Output exists; inspect it rather than restart');
  let provider,ledger,redact=v=>String(v);
  if(execute){
   const {UsageLedger,redactSecrets,ModelGateway,OpenAICompatibleAdapter}=await import(binding.root+'/packages/model-gateway/src/index.ts');
   const {loadModelStore,activeChannel,connectionOf}=await import(binding.root+'/apps/api/src/model-settings.ts');
   const {JsonDesignPlanner}=await import(binding.root+'/packages/planner/src/index.ts');
   const store=loadModelStore(root+'/data/model-settings.json'),conn=connectionOf(activeChannel(store),store.source);
   assert.equal(conn.planningModel,'gpt-5.6-luna');assert.equal(conn.timeoutMs,600000);assert.ok(store.channels.every(c=>!c.fallback));
   ledger=new UsageLedger(Infinity,undefined,{maxCalls:remainingCalls});redact=redactSecrets;
   const gateway=new ModelGateway(new Map([['openai-compatible',new OpenAICompatibleAdapter(fetch,conn.timeoutMs,true)]]),ledger);
   const endpoint=conn.endpoint.replace(/\/$/,'').replace(/(?:\/v1)?$/,'/v1');
   provider=new JsonDesignPlanner({complete:async req=>(await gateway.complete({role:req.role??'reviewing',model:conn.planningModel,system:req.system+suffix,user:req.user,maxOutputTokens:req.maxOutputTokens,responseFormat:'json',temperature:0.2},'openai-compatible',{endpoint,apiKey:conn.apiKey})).text});
  }else provider={reviewDesignContent:async()=>{throw new Error('REHEARSAL: simulated provider failure; zero network calls')}};
  const workflow=new ChapterWorkflow(repo,{generateChapter:()=>{throw new Error('Recovery must not generate prose')}},provider);
  const state={model:prior.model,fallback:false,runtimeRoot:binding.root,candidateFileSha256:prior.candidateFileSha256,status:'running',pid:process.pid,startedAt:new Date().toISOString(),rehearsal,runtimeCommit:binding.commit,rubricVersion:binding.rubricVersion,scheduleVersion:25,priorCheckpointSha256:hash(priorBytes),scope:prior.scope,areas:prior.areas,priorUsage:{calls:prior.totalCalls,segments:[prior.priorUsage,prior.resumeUsage]},maxCalls:prior.maxCalls,concurrency:1,errors:[],stepsStarted:[],suffixSha256:hash(suffix)};
  fs.writeFileSync(out,JSON.stringify(state,null,2)+'\n',{flag:'wx'});
  async function checkpoint(){const current=await repo.get(workId);verify(current);state.protectedHistoryUnchanged=true;state.runs=prior.areas.map(a=>current.designReviewRuns.get(a.runId));state.reports=state.runs.filter(r=>r.reportId).map(r=>current.designContentReviews.get(r.reportId));state.resumeUsage=ledger?.summary()??{calls:0};state.totalCalls=prior.totalCalls+state.resumeUsage.calls;fs.writeFileSync(out+'.pending',JSON.stringify(state,null,2)+'\n');fs.renameSync(out+'.pending',out)}
  for(const target of targets){
   try{
    let run=(await repo.get(workId)).designReviewRuns.get(target.runId);
    while(run.status!=='completed'){
     const stage=run.stages.find(s=>!s.result);assert.ok(stage);
     state.activeStep={area:target.area,runId:run.id,stageId:stage.id,startedAt:new Date().toISOString()};state.stepsStarted.push(state.activeStep);await checkpoint();
     console.log(JSON.stringify({starting:state.activeStep}));
     run=await workflow.stepDesignReview(workId,run.id);await checkpoint();
     console.log(JSON.stringify({area:target.area,finished:stage.id,complete:run.stages.filter(s=>s.result).length,total:run.stages.length,totalCalls:state.totalCalls}));
    }
   }catch(error){state.errors.push({area:target.area,error:String(redact(error.message))});await checkpoint();break}
  }
  state.status=state.errors.length?'stopped_after_failure':'completed';state.finishedAt=new Date().toISOString();await checkpoint();
  if(rehearsal){assert.equal(state.stepsStarted.length,1);assert.equal(state.resumeUsage.calls,0);assert.equal(state.errors.length,1);assert.match(state.errors[0].error,/REHEARSAL/)}
  console.log(JSON.stringify({status:state.status,rehearsal,modelCalls:state.resumeUsage.calls,protectedHistoryUnchanged:state.protectedHistoryUnchanged}));
 }
}finally{await repo.disconnect()}
