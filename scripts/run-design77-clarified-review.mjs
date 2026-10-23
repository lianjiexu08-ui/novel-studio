// Bounded real-model review after the 45th editorial note. Prepare immutable
// bindings before execution; keep all old checkpoints and raw calls intact.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {startSharedReviewHost} from './shared-review-host.mjs';
import {sourceNavigationGuidance} from './design-review-source-navigation.mjs';
const read=p=>JSON.parse(fs.readFileSync(p));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash=v=>createHash('sha256').update(JSON.stringify(v,(_,x)=>x instanceof Map?[...x]:x)).digest('hex');
const control='data/audit-runtimes/design77-clarified-review';
const bindingPath='data/audit-runtimes/design77-navigation-runtime-bound.json',binding=read(bindingPath);
const predecessorPath='data/audit-runtimes/design77-navigation-continuation/result.json';
const verificationPath='docs/audits/2026-10-20-design77-navigation-continuation-segment-3.json';
const notePath='docs/audits/2026-10-20-design77-payoff-clarification.json';
const prior=read(predecessorPath),proof=read(verificationPath),notes=read(notePath);
assert.equal(sha(predecessorPath),proof.checkpointSha256);assert.equal(notes.checkpointSha256,proof.checkpointSha256);
assert.equal(sha(verificationPath),notes.verificationSha256);assert.equal(proof.verified,true);assert.equal(notes.verified,true);
try{process.kill(prior.pid,0);assert.fail('Predecessor worker is live');}catch(e){assert.equal(e.code,'ESRCH');}
for(const [file,digest]of Object.entries(binding.sourceHashes))assert.equal(sha(`${binding.runtimePath}/${file}`),digest);
for(const [file,digest]of Object.entries(binding.dependencyHashes))assert.equal(sha(file),digest);
const {PrismaClient}=createRequire(`${binding.runtimePath}/package.json`)('@prisma/client');
const {PrismaWorkRepository}=await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const {ChapterWorkflow}=await import(`${binding.runtimePath}/packages/application/src/index.ts`);
const {designReviewStageInput}=await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const fields=w=>Object.fromEntries(Object.keys(w).sort().map(k=>[k,hash(w[k])]));
const save=(name,value)=>fs.writeFileSync(`${control}/${name}`,JSON.stringify(value,null,2)+'\n',{flag:'wx',flush:true});
const copy=(a,b)=>fs.copyFileSync(a,b,fs.constants.COPYFILE_EXCL);
const snapshot=name=>{
 const file=path.resolve(control,name);
 execFileSync('python3',['-c',"import sqlite3,sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()",path.resolve('data/novel-studio.db'),file]);return file;
};
const {loadModelStore,activeChannel,connectionOf}=await import(`${binding.runtimePath}/apps/api/src/model-settings.ts`);
const store=loadModelStore('data/model-settings.json'),conn=connectionOf(activeChannel(store),store.source);
assert.equal(conn.planningModel,'gpt-5.6-luna');assert.ok(store.channels.every(c=>!c.fallback));
const mode=process.argv[2];assert.ok(['--prepare','--execute'].includes(mode));
if(mode==='--prepare'){
 assert.ok(!fs.existsSync(control),'Never overwrite an earlier segment');fs.mkdirSync(`${control}/model-calls`,{recursive:true});
 copy(process.argv[1],`${control}/runner.mjs`);copy(predecessorPath,`${control}/predecessor.json`);
 const db=snapshot('baseline.db'),client=new PrismaClient({datasources:{db:{url:`file:${db}`}}}),repo=new PrismaWorkRepository(client);
 try{
  const work=await repo.get(prior.scope.workId);assert.ok(work);assert.deepEqual(fields(work),notes.afterFields);
  assert.equal(work.designReviewAnnotations.size,45);assert.equal(work.designReviewRuns.size,103);assert.equal(work.designContentReviews.size,92);
  for(const run of prior.runs)assert.deepEqual(work.designReviewRuns.get(run.id),run);
  assert.ok([...work.designReviewRuns.values()].every(r=>!r.leaseToken));
  const mutable=new Set(prior.runs.map(r=>r.id));
  const prefix=[];
  const add=(key,startPath,outcomePath,expectedStart,expectedOutcome,formal=false,runId)=>{
   assert.equal(sha(startPath),expectedStart);assert.equal(sha(outcomePath),expectedOutcome);
   prefix.push({key,startPath,outcomePath,startSha256:expectedStart,outcomeSha256:expectedOutcome,formal,runId});
  };
  for(const j of read('docs/audits/2026-10-18-design77-formal-continuation-segment-3.json').journal){
   const p=`data/audit-runtimes/design77-formal-continuation/model-calls/${String(j.callNumber).padStart(5,'0')}`;
   add(`original/${j.callNumber}`,p+'.started.json',p+(j.responseSha256?'.response.json':'.failure.json'),j.startSha256,j.outcomeSha256,j.callNumber===22);
  }
  for(const j of read('docs/audits/2026-10-20-design77-navigation-rechecks-verified.json').newJournal){
   const p=`data/audit-runtimes/design77-navigation-execution/${String(j.key.split('/')[1]).padStart(3,'0')}`;
   add(j.key,p+'.started.json',p+(fs.existsSync(p+'.response.json')?'.response.json':'.failure.json'),j.startSha256,j.outcomeSha256,true,j.runId);
  }
  for(const j of proof.journal){
   const p=`data/audit-runtimes/design77-navigation-continuation/model-calls/${String(j.key.split('/')[1]).padStart(5,'0')}`;
   add(j.key,p+'.started.json',p+(j.hasResponse?'.response.json':'.failure.json'),j.startSha256,j.outcomeSha256);
  }
  assert.equal(prefix.length,43);save('prefix-journal.json',prefix);
  const baseline={workId:work.id,planId:prior.scope.planId,inputHash:prior.inputHash,fields:fields(work),
   oldRuns:[...work.designReviewRuns].filter(([id])=>!mutable.has(id)).map(([id,r])=>[id,hash(r)]),
   oldReports:[...work.designContentReviews].map(([id,r])=>[id,hash(r)]),oldAnnotations:[...work.designReviewAnnotations].map(([id,n])=>[id,hash(n)]),
   bindingSha256:sha(bindingPath),runnerSha256:sha(process.argv[1]),hostSha256:sha('scripts/shared-review-host.mjs'),guidanceSha256:sha('scripts/design-review-source-navigation.mjs'),
   settingsSha256:sha('data/model-settings.json'),predecessorSha256:sha(predecessorPath),verificationSha256:sha(verificationPath),noteSha256:sha(notePath),
   prefixSha256:sha(`${control}/prefix-journal.json`),stageLimit:8,maxCalls:16,callsPerStage:2,createdAt:new Date().toISOString(),databaseSnapshotPath:db};
  save('baseline.json',baseline);
  const receipt={verified:true,prepared:true,baselineSha256:sha(`${control}/baseline.json`),sourceCommit:binding.sourceCommit,
   originalStages:33,prefixCalls:43,annotations:45,stageLimit:8,maxCalls:16,modelCalls:0,productionWrites:0,
   nextStages:prior.runs.map(r=>({area:r.input.area,stageId:r.stages.find(s=>!s.result).id})),formalAcceptance:false};
  fs.writeFileSync('docs/audits/2026-10-20-design77-clarified-review-preflight.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(receipt));
 }finally{await repo.disconnect();await client.$disconnect();}
 process.exit(0);
}
const baseline=read(`${control}/baseline.json`),preflight=read('docs/audits/2026-10-20-design77-clarified-review-preflight.json');
assert.equal(sha(`${control}/baseline.json`),preflight.baselineSha256);
for(const [file,digest]of [[process.argv[1],baseline.runnerSha256],[bindingPath,baseline.bindingSha256],['scripts/shared-review-host.mjs',baseline.hostSha256],
 ['scripts/design-review-source-navigation.mjs',baseline.guidanceSha256],['data/model-settings.json',baseline.settingsSha256],[predecessorPath,baseline.predecessorSha256],
 [verificationPath,baseline.verificationSha256],[notePath,baseline.noteSha256],[`${control}/prefix-journal.json`,baseline.prefixSha256]])assert.equal(sha(file),digest);
assert.equal(process.env.DATABASE_URL,'file:'+path.resolve('data/novel-studio.db'));
assert.equal(process.env.API_CORS_ORIGIN,'http://127.0.0.1:5180');assert.equal(process.env.NOVEL_ENABLE_BATCH_RUNS,'false');
assert.ok(!fs.existsSync(`${control}/result.json`),'Existing execution: inspect it instead of resubmitting');
const {JsonDesignPlanner}=await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const {ModelGateway,OpenAICompatibleAdapter,UsageLedger,redactSecrets}=await import(`${binding.runtimePath}/packages/model-gateway/src/index.ts`);
const ledger=new UsageLedger(Infinity,undefined,{maxCalls:baseline.maxCalls});
const gateway=new ModelGateway(new Map([['openai-compatible',new OpenAICompatibleAdapter(fetch,conn.timeoutMs,true)]]),ledger);
const repo=new PrismaWorkRepository();let host,calls=0,stop=false;
const state={status:'running',pid:process.pid,scope:prior.scope,inputHash:prior.inputHash,runs:prior.runs,reports:prior.reports,
 model:conn.planningModel,fallback:false,sourceCommit:binding.sourceCommit,baselineSha256:sha(`${control}/baseline.json`),
 startedAt:new Date().toISOString(),calls:0,completed:[],errors:[],formalAcceptance:false,proseGenerated:false};
save('result.json',state);
const check=w=>{
 const now=fields(w);for(const [key,digest]of Object.entries(baseline.fields))if(!['designReviewRuns','designContentReviews','constraintRevision'].includes(key))assert.equal(now[key],digest,key);
 for(const [id,digest]of baseline.oldRuns)assert.equal(hash(w.designReviewRuns.get(id)),digest);
 for(const [id,digest]of baseline.oldReports)assert.equal(hash(w.designContentReviews.get(id)),digest);
 for(const old of prior.runs){const run=w.designReviewRuns.get(old.id);assert.deepEqual(run.input,old.input);for(const s of old.stages.filter(s=>s.result))assert.deepEqual(run.stages.find(x=>x.id===s.id),s);}
 assert.equal(w.designReviewRuns.size,103);assert.equal(w.designReviewAnnotations.size,45);
};
async function checkpoint(){
 const w=await repo.get(baseline.workId);check(w);state.runs=prior.runs.map(r=>w.designReviewRuns.get(r.id));
 state.reports=state.runs.filter(r=>r.reportId).map(r=>w.designContentReviews.get(r.reportId));state.calls=calls;state.usage=ledger.summary();
 state.workFields=fields(w);state.updatedAt=new Date().toISOString();
 fs.writeFileSync(`${control}/result.pending.json`,JSON.stringify(state,null,2)+'\n',{flush:true});fs.renameSync(`${control}/result.pending.json`,`${control}/result.json`);
}
const signal=()=>{stop=true;};process.once('SIGTERM',signal);process.once('SIGINT',signal);
try{
 const work=await repo.get(baseline.workId);assert.deepEqual(fields(work),baseline.fields);
 const {createApiServer}=await import(`${binding.runtimePath}/apps/api/src/server.ts`);
 host=await startSharedReviewHost({createApiServer,repository:repo,modelSettingsPath:path.resolve('data/model-settings.json'),port:8787,
  status:()=>({status:state.status,workId:baseline.workId,active:state.active,calls}),onResponse:e=>fs.appendFileSync(`${control}/http.jsonl`,JSON.stringify({at:new Date().toISOString(),...e})+'\n')});
 console.log(JSON.stringify({apiReady:true,pid:process.pid,readOnly:true,stageLimit:baseline.stageLimit}));
 const planner=new JsonDesignPlanner({complete:async raw=>{
  assert.ok(calls<baseline.maxCalls,'Bounded budget exhausted');
  const number=++calls,prefix=`model-calls/${String(number).padStart(5,'0')}`;
  const request={...raw,role:raw.role??'reviewing',system:raw.system+sourceNavigationGuidance,model:conn.planningModel,responseFormat:'json',temperature:0.2};
  save(`${prefix}.started.json`,{number,step:state.active,request,at:new Date().toISOString()});
  try{const response=await gateway.complete(request,'openai-compatible',{endpoint:conn.endpoint.replace(/\/$/,'').replace(/(?:\/v1)?$/,'/v1'),apiKey:conn.apiKey});
   save(`${prefix}.response.json`,{number,response,usage:ledger.summary(),at:new Date().toISOString()});return response.text;
  }catch(e){save(`${prefix}.failure.json`,{number,error:redactSecrets(String(e)),usage:ledger.summary(),at:new Date().toISOString()});throw e;}
 }});
 const workflow=new ChapterWorkflow(repo,{generateChapter(){throw Error('No prose generation');}},planner);
 while(!stop&&state.completed.length<baseline.stageLimit){
  let pending=false;
  for(const original of prior.runs){
   if(stop||state.completed.length>=baseline.stageLimit)break;
   const run=state.runs.find(r=>r.id===original.id);if(run.status==='completed')continue;pending=true;
   if(baseline.maxCalls-calls<baseline.callsPerStage){state.status='stopped_after_budget';stop=true;break;}
   const stage=run.stages.find(s=>!s.result);assert.ok(stage);
   state.active={area:run.input.area,runId:run.id,stageId:stage.id,startedAt:new Date().toISOString()};
   save(`input-${state.completed.length+1}.json`,designReviewStageInput(run,stage));await checkpoint();console.log(JSON.stringify({starting:state.active}));
   const updated=await workflow.stepDesignReview(baseline.workId,run.id),result=updated.stages.find(s=>s.id===stage.id).result;assert.ok(result);
   state.completed.push({...state.active,result});await checkpoint();
   console.log(JSON.stringify({completed:state.active,checks:result.checks.map(c=>({criterion:c.criterion,verdict:c.verdict,awaitingSources:c.awaitingSources,resolves:c.resolves})),calls}));
   if(result.checks.some(c=>c.verdict==='revise'||c.verdict==='insufficient'&&!c.awaitingSources?.length)){state.status='stopped_for_content_inspection';stop=true;break;}
  }
  if(!pending){state.status='completed';break;}
 }
 if(state.status==='running')state.status=stop?'stopped_by_signal':'stopped_after_stage_limit';
}catch(e){state.status='failed';state.errors.push(redactSecrets(String(e)));process.exitCode=1;}
finally{
 state.finishedAt=new Date().toISOString();await checkpoint();await host?.close();await repo.disconnect();
 process.removeListener('SIGTERM',signal);process.removeListener('SIGINT',signal);
 console.log(JSON.stringify({status:state.status,calls,completed:state.completed.length,errors:state.errors,formalAcceptance:false}));
}
