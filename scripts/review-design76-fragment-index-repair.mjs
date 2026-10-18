// One detached model repair of a recorded invalid answer. Never writes a Work.
// The first planner response is explicitly replayed from call 81; only its
// corrective request reaches the model. Verification replays both offline.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const mode=process.argv[2];assert.ok(['--prepare','--execute','--verify'].includes(mode));
const control='data/audit-runtimes/design76-fragment-index-repair';
const formal='data/audit-runtimes/design76-macro-review';
const checkpointPath=formal+'/terminal-segment-14.json';
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json';
const binding=read(bindingPath),oldBinding=read('data/audit-runtimes/design76-macro-context-runtime-bound.json');
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(`${binding.runtimePath}/${p}`),h);
for(const[p,h]of Object.entries(binding.dependencyHashes))assert.equal(sha(p),h);
assert.deepEqual(Object.keys(binding.sourceHashes).filter(p=>binding.sourceHashes[p]!==oldBinding.sourceHashes[p]).sort(),[
  'packages/planner/src/design-review-evidence.ts','packages/planner/src/index.ts','packages/planner/test/design-review.test.ts',
]);
const formalState=read(checkpointPath),formalProof=read('docs/audits/2026-10-18-design76-macro-review-segment-14.json');
assert.equal(sha(checkpointPath),formalProof.checkpointSha256);assert.equal(formalProof.workerAbsent,true);assert.equal(formalProof.unsettledCalls,0);
assert.equal(formalState.status,'stopped_after_failure');assert.equal(formalState.totalCalls,82);
const seedRequestPath=formal+'/model-calls/00081.started.json',seedResponsePath=formal+'/model-calls/00081.response.json';
const seedRequest=read(seedRequestPath).request,seedText=read(seedResponsePath).response.text;
const runtime=await import(binding.runtimePath+'/novel-service-core/src/design-review-run.ts');
const {JsonDesignPlanner}=await import(binding.runtimePath+'/packages/planner/src/index.ts');
const run=formalState.runs.find(r=>r.input.area==='world'),stage=run.stages.find(s=>s.id==='cross-2-7');
assert.equal(stage.result,undefined);
const input=runtime.designReviewStageInput(run,stage);
const manifest={runnerSha256:sha(process.argv[1]),bindingSha256:sha(bindingPath),checkpointSha256:sha(checkpointPath),seedRequestPath,seedRequestSha256:sha(seedRequestPath),seedResponsePath,seedResponseSha256:sha(seedResponsePath),inputSha256:hash(input),productionWrites:0};
const manifestPath=control+'/manifest.json',resultPath=control+'/result.json';
if(mode==='--prepare'){
  assert.ok(!fs.existsSync(control));fs.mkdirSync(control,{recursive:true});
  fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  fs.writeFileSync(control+'/input.json',JSON.stringify(input,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({prepared:true,seedCall:81,maxNewModelCalls:1,productionWrites:0}));
}else{
  assert.deepEqual(read(manifestPath),manifest);assert.deepEqual(read(control+'/input.json'),input);
  const normalized=(request,suffix)=>({role:request.role??'reviewing',model:'gpt-5.6-luna',system:request.system+suffix,user:request.user,maxOutputTokens:request.maxOutputTokens,responseFormat:'json',temperature:0.2});
  const integrate=result=>{
    const prepared=structuredClone(run),target=prepared.stages.find(s=>s.id===stage.id),{modelResponses,...content}=result;
    runtime.acceptDesignReviewStage(prepared,target,content);
    target.modelResponses=modelResponses;
    assert.deepEqual(target.failures,stage.failures,'Original failed attempts must survive');
    return prepared;
  };
  if(mode==='--execute'){
    assert.ok(!fs.existsSync(resultPath),'Do not repeat an executed repair');
    const latest=read(formal+'/result.json');assert.equal(sha(formal+'/result.json'),manifest.checkpointSha256);
    try{process.kill(latest.pid,0);assert.fail('Formal worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
    const {loadModelStore,activeChannel,connectionOf}=await import(binding.runtimePath+'/apps/api/src/model-settings.ts');
    const {UsageLedger,ModelGateway,OpenAICompatibleAdapter,redactSecrets}=await import(binding.runtimePath+'/packages/model-gateway/src/index.ts');
    const settings=loadModelStore('data/model-settings.json'),conn=connectionOf(activeChannel(settings),settings.source);
    assert.equal(conn.planningModel,'gpt-5.6-luna');assert.ok(settings.channels.every(c=>!c.fallback));
    const ledger=new UsageLedger(Infinity,undefined,{maxCalls:1}),gateway=new ModelGateway(new Map([['openai-compatible',new OpenAICompatibleAdapter(fetch,conn.timeoutMs,true)]]),ledger);
    const state={status:'running',pid:process.pid,startedAt:new Date().toISOString(),model:conn.planningModel,fallback:false,seedCall:81,replayedCalls:0,modelCalls:0,productionWrites:0,formalAcceptance:false};
    const save=()=>{fs.writeFileSync(resultPath+'.pending',JSON.stringify(state,null,2)+'\n');fs.renameSync(resultPath+'.pending',resultPath);};save();
    let calls=0,suffix='';
    const planner=new JsonDesignPlanner({complete:async request=>{
      if(++calls===1){assert.equal(request.user,seedRequest.user);assert.ok(seedRequest.system.startsWith(request.system));suffix=seedRequest.system.slice(request.system.length);assert.deepEqual(normalized(request,suffix),seedRequest);state.replayedCalls++;save();return seedText;}
      assert.equal(calls,2,'Exactly one corrective model call is permitted');
      const actual=normalized(request,suffix),body=JSON.parse(actual.user),original=JSON.parse(seedRequest.user);
      assert.match(body.instruction,/不能按编号递增猜测/);
      assert.deepEqual(body.fragmentReferenceProblems.map(p=>p.invalidFragmentId),['e350','e351','e352']);
      assert.equal(body.expectedRequestId,original.requestId);
      assert.deepEqual(body.availableEvidenceSources,original.sources.map(s=>({unitId:s.id,sourceId:s.origin?.sourceId??s.id,fragmentIds:s.fragments.map(f=>f.id)})));
      fs.writeFileSync(control+'/request.json',JSON.stringify(actual,null,2)+'\n',{flag:'wx',flush:true});state.modelCalls++;save();
      const response=await gateway.complete(actual,'openai-compatible',{endpoint:conn.endpoint.replace(/\/$/,'').replace(/(?:\/v1)?$/,'/v1'),apiKey:conn.apiKey});
      fs.writeFileSync(control+'/response.json',JSON.stringify(response,null,2)+'\n',{flag:'wx',flush:true});return response.text;
    }});
    try{state.result=await planner.reviewDesignContent(input);state.rehearsedRunSha256=hash(integrate(state.result));state.status='completed';}
    catch(e){state.status='failed';state.error=String(redactSecrets(e.message));process.exitCode=1;}
    finally{state.usage=ledger.summary();state.finishedAt=new Date().toISOString();save();}
    console.log(JSON.stringify({status:state.status,replayedCalls:state.replayedCalls,modelCalls:state.modelCalls,checks:state.result?.checks.map(c=>({criterion:c.criterion,verdict:c.verdict,resolves:c.resolves})),error:state.error,productionWrites:0}));
  }else{
    const state=read(resultPath);assert.equal(state.status,'completed');
    try{process.kill(state.pid,0);assert.fail('Repair worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
    const actual=read(control+'/request.json'),response=read(control+'/response.json');
    const answer=JSON.parse(response.text);assert.ok(Array.isArray(answer.checks));
    let calls=0,suffix='';
    const planner=new JsonDesignPlanner({complete:async request=>{
      if(++calls===1){assert.equal(request.user,seedRequest.user);assert.ok(seedRequest.system.startsWith(request.system));suffix=seedRequest.system.slice(request.system.length);assert.deepEqual(normalized(request,suffix),seedRequest);return seedText;}
      assert.equal(calls,2);assert.deepEqual(normalized(request,suffix),actual);return response.text;
    }});
    const result=await planner.reviewDesignContent(input);assert.deepEqual(result,state.result);assert.deepEqual(result.checks.flatMap(c=>c.resolves??[]).sort(),JSON.parse(seedText).checks.flatMap(c=>c.resolves??[]).sort(),'Inspect any changed resolution rather than silently accepting omission');assert.equal(hash(integrate(result)),state.rehearsedRunSha256);
    assert.equal(state.replayedCalls,1);assert.equal(state.modelCalls,1);assert.equal(state.fallback,false);
    const proof={kind:'design76_detached_fragment_index_repair',verified:true,semanticVerification:'pending',observedAt:new Date().toISOString(),...manifest,stateSha256:sha(resultPath),requestSha256:sha(control+'/request.json'),responseSha256:sha(control+'/response.json'),sourceCommit:binding.sourceCommit,model:state.model,replayedSeedCall:81,originalModelCalls:1,modelCalls:0,productionWrites:0,formalAcceptance:false,rehearsedRunSha256:state.rehearsedRunSha256,checks:result.checks,limitation:'Structural replay and cloned-run acceptance only; selected citations still need independent semantic inspection. The original failed production stage remains unchanged; full review and design acceptance are still incomplete.'};
    fs.writeFileSync('docs/audits/2026-10-18-design76-fragment-index-repair.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({verified:true,replayedSeedCall:81,originalModelCalls:1,productionWrites:0,formalAcceptance:false}));
  }
}
