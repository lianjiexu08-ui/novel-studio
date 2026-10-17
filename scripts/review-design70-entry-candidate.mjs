// One isolated, bounded content review; never save a formal report or change a work.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p));
const sha=x=>createHash('sha256').update(x).digest('hex');
const fileHash=p=>sha(fs.readFileSync(p));
const mode=process.argv[2];
assert.ok(['--check','--execute','--verify'].includes(mode));
const requestProofPath='docs/audits/2026-10-17-design70-entry-content-request.json';
const prepared=read(requestProofPath);
assert.equal(fileHash(prepared.candidatePath),prepared.candidateSha256);
assert.equal(fileHash(prepared.inputPath),prepared.inputSha256);
assert.equal(fileHash(prepared.fullInputPath),prepared.fullInputSha256);
assert.equal(fileHash(prepared.runtimeBindingPath),prepared.runtimeBindingSha256);
const binding=read(prepared.runtimeBindingPath);
assert.equal(binding.runtimePath,prepared.runtimePath);
for(const [p,h] of Object.entries(binding.sourceHashes))assert.equal(fileHash(`${binding.runtimePath}/${p}`),h,p);
const input=read(prepared.inputPath),full=read(prepared.fullInputPath);
assert.equal(input.inputHash,prepared.inputHash);
for(const source of input.sources)assert.deepEqual(source,full.sources.find(s=>s.id===source.id));
const checkpointPath='data/audit-runtimes/design70-review/result.json';
const checkpoint=read(checkpointPath);
let workerLive=false;
try{process.kill(checkpoint.pid,0);workerLive=true;}catch(error){assert.equal(error.code,'ESRCH');}
const terminalProofPath='docs/audits/2026-10-17-design70-review-result.json';
const terminalProofExists=fs.existsSync(terminalProofPath);
const ready=!workerLive&&checkpoint.status==='completed'&&terminalProofExists;
if(mode==='--check'){
 console.log(JSON.stringify({ready,workerLive,originalReviewStatus:checkpoint.status,terminalProofExists,requestSources:input.sources.length,modelCalls:0,productionWrites:0}));
 process.exit(0);
}
assert.ok(ready,'Wait for the original worker to exit and its final record verification; never restart or overlap it');
const terminal=read(terminalProofPath);
assert.equal(terminal.status,'completed');assert.equal(terminal.workerAbsent,true);
assert.equal(fileHash(terminal.checkpointPath),terminal.checkpointSha256);
assert.equal(fileHash(checkpointPath),terminal.checkpointSha256);
const directory=path.dirname(prepared.inputPath),outputPath=path.join(directory,'result.json');
const {JsonDesignPlanner}=await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
if(mode==='--execute'){
 assert.ok(!fs.existsSync(outputPath),'Preserve the previous attempt; inspect it or use --verify, never resubmit blindly');
 const {loadModelStore,activeChannel,connectionOf}=await import(`${binding.runtimePath}/apps/api/src/model-settings.ts`);
 const {UsageLedger,redactSecrets,ModelGateway,OpenAICompatibleAdapter}=await import(`${binding.runtimePath}/packages/model-gateway/src/index.ts`);
 const settings=loadModelStore('data/model-settings.json');
 const connection=connectionOf(activeChannel(settings),settings.source);
 assert.equal(connection.planningModel,'gpt-5.6-luna');
 assert.ok(settings.channels.every(channel=>!channel.fallback));
 const endpoint=connection.endpoint.replace(/\/$/,'').replace(/(?:\/v1)?$/,'/v1');
 const ledger=new UsageLedger(Infinity,undefined,{maxCalls:2});
 const gateway=new ModelGateway(new Map([['openai-compatible',new OpenAICompatibleAdapter(fetch,connection.timeoutMs,true)]]),ledger);
 const state={status:'running',startedAt:new Date().toISOString(),pid:process.pid,
   requestProofSha256:fileHash(requestProofPath),inputSha256:prepared.inputSha256,candidateSha256:prepared.candidateSha256,
   terminalProofSha256:fileHash(terminalProofPath),model:connection.planningModel,fallback:false,maxCalls:2,
   rawResponses:[],modelCalls:0,productionWrites:0,formalAcceptance:false};
 fs.writeFileSync(outputPath,JSON.stringify(state,null,2)+'\n',{flag:'wx'});
 const save=()=>{
   fs.writeFileSync(`${outputPath}.pending`,JSON.stringify(state,null,2)+'\n');
   fs.renameSync(`${outputPath}.pending`,outputPath);
 };
 const planner=new JsonDesignPlanner({complete:async call=>{
   const response=await gateway.complete({role:call.role??'reviewing',model:connection.planningModel,
     system:call.system,user:call.user,maxOutputTokens:call.maxOutputTokens,responseFormat:'json',temperature:0.2},
     'openai-compatible',{endpoint,apiKey:connection.apiKey});
   state.rawResponses.push(response.text);state.usage=ledger.summary();save();
   return response.text;
 }});
 try{state.result=await planner.reviewDesignContent(input);state.status='completed';}
 catch(error){state.status='failed';state.failure={error:String(redactSecrets(error.message)),modelResponses:error.modelResponses??[]};}
 state.finishedAt=new Date().toISOString();state.usage=ledger.summary();state.modelCalls=state.usage.calls;save();
 console.log(JSON.stringify({status:state.status,modelCalls:state.modelCalls,checks:state.result?.checks.map(({criterion,verdict,explanation})=>({criterion,verdict,explanation})),error:state.failure?.error}));
 assert.equal(state.status,'completed','Inspect the saved failed attempt before any additional model calls');
}else{
 const state=read(outputPath);
 assert.equal(state.status,'completed');
 assert.equal(state.requestProofSha256,fileHash(requestProofPath));
 assert.equal(state.terminalProofSha256,fileHash(terminalProofPath));
 assert.equal(state.inputSha256,prepared.inputSha256);
 assert.equal(state.candidateSha256,prepared.candidateSha256);
 assert.deepEqual(state.rawResponses,state.result.modelResponses);
 let cursor=0;
 const planner=new JsonDesignPlanner({complete:async()=>{assert.ok(cursor<state.rawResponses.length);return state.rawResponses[cursor++];}});
 assert.deepEqual(await planner.reviewDesignContent(input),state.result);
 assert.equal(cursor,state.rawResponses.length);
 const proof={...prepared,verifiedAt:new Date().toISOString(),requestProofPath,requestProofSha256:fileHash(requestProofPath),
   outputPath,outputSha256:fileHash(outputPath),terminalProofPath,terminalProofSha256:fileHash(terminalProofPath),
   model:state.model,fallback:state.fallback,modelCalls:state.usage.calls,responsesReplayed:cursor,result:state.result,
   replayModelCalls:0,productionWrites:0,formalAcceptance:false,
   limitation:'One bounded content review of the isolated location candidate. Does not apply it, approve a plan, resolve production questions or replace complete design review.'};
 const proofPath='docs/audits/2026-10-17-design70-entry-content-review.json';
 assert.ok(!fs.existsSync(proofPath),'Preserve prior verification');
 fs.writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({verified:true,responsesReplayed:cursor,modelCalls:state.usage.calls,checks:state.result.checks.map(({criterion,verdict})=>({criterion,verdict})),formalAcceptance:false}));
}
