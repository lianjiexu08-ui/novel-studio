// Reassess the same first story batch under the expanded source-ID contract.
// Detached evidence only: never rewrites the original result or production DB.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {JsonDesignPlanner} from '../packages/planner/src/index.ts';
import {loadModelStore,activeChannel,connectionOf} from '../apps/api/src/model-settings.ts';
import {UsageLedger,ModelGateway,OpenAICompatibleAdapter,redactSecrets} from '../packages/model-gateway/src/index.ts';
const read=p=>JSON.parse(fs.readFileSync(p));
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const proof=read('docs/audits/2026-10-18-design75-review-segment-0.json');
assert.equal(fileHash(proof.checkpointPath),proof.checkpointSha256);
const checkpoint=read(proof.checkpointPath);
try{process.kill(checkpoint.pid,0);assert.fail('Wait for the formal worker');}catch(e){assert.equal(e.code,'ESRCH');}
const binding=read('data/audit-runtimes/design75-runtime-bound.json');
for(const [p,h]of Object.entries(binding.sourceHashes))assert.equal(fileHash(`${binding.runtimePath}/${p}`),h);
const {designReviewStageInput}=await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const {JsonDesignPlanner:FrozenPlanner}=await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const run=checkpoint.runs.find(r=>r.input.area==='story'),stage=run.stages[0];
const input=designReviewStageInput(run,stage);
const recorded=read('data/audit-runtimes/design75-review/model-calls/00004.started.json').request;
const original=read('data/audit-runtimes/design75-review/model-calls/00004.response.json').response.text;
let oldRequest;
const replay=await new FrozenPlanner({complete:async req=>{oldRequest=req;return original;}}).reviewDesignContent(input);
assert.deepEqual(replay.modelResponses,[original]);
assert.equal(recorded.user,oldRequest.user);assert.ok(recorded.system.startsWith(oldRequest.system));
const suffix=recorded.system.slice(oldRequest.system.length);
const requested=run.input.sources.filter(s=>/^plan\/(chapters|milestones)\//.test(s.id));
assert.equal(requested.length,68);
const control='data/audit-runtimes/design75-source-limit-probe';
fs.mkdirSync(control,{recursive:true});
fs.writeFileSync(`${control}/input.json`,JSON.stringify(input,null,2)+'\n',{flag:'wx'});
const state={status:'running',startedAt:new Date().toISOString(),inputHash:hash(input),originalResultSha256:hash(stage.result),
 originalCheckpointSha256:proof.checkpointSha256,sourceCount:requested.length,sourceCharacters:JSON.stringify(requested).length,
 model:'gpt-5.6-luna',fallback:false,productionWrites:0,formalAcceptance:false,requests:[],rawResponses:[]};
const save=()=>fs.writeFileSync(`${control}/result.json`,JSON.stringify(state,null,2)+'\n',{flush:true});
assert.ok(!fs.existsSync(`${control}/result.json`));save();
const store=loadModelStore('data/model-settings.json'),conn=connectionOf(activeChannel(store),store.source);
assert.equal(conn.planningModel,state.model);assert.ok(store.channels.every(c=>!c.fallback));
const ledger=new UsageLedger(Infinity,undefined,{maxCalls:2});
const gateway=new ModelGateway(new Map([['openai-compatible',new OpenAICompatibleAdapter(fetch,conn.timeoutMs,true)]]),ledger);
const planner=new JsonDesignPlanner({complete:async req=>{
 if(!state.requests.length){assert.equal(req.user,oldRequest.user);assert.equal(req.system,oldRequest.system.replace('最多64项','最多96项'));}
 const request={role:req.role??'reviewing',model:conn.planningModel,system:req.system+suffix,user:req.user,maxOutputTokens:req.maxOutputTokens,responseFormat:'json',temperature:0.2};
 state.requests.push(request);save();
 try{const response=await gateway.complete(request,'openai-compatible',{endpoint:conn.endpoint.replace(/\/$/,'').replace(/(?:\/v1)?$/,'/v1'),apiKey:conn.apiKey});
 state.rawResponses.push(response.text);state.usage=ledger.summary();save();return response.text;
 }catch(error){state.usage=ledger.summary();state.error=String(redactSecrets(error.message));save();throw error;}
}});
try{state.result=await planner.reviewDesignContent(input);state.status='completed';}
catch(error){state.status='failed';state.error=String(redactSecrets(error.message));process.exitCode=1;}
state.finishedAt=new Date().toISOString();state.usage=ledger.summary();save();
assert.equal(fileHash(proof.checkpointPath),proof.checkpointSha256);
const output={...state,requests:undefined,rawResponses:undefined,result:state.result?{summary:state.result.summary,checks:state.result.checks}:undefined,
 controlPath:control,limitation:'Independent local recheck with only the source-ID limit changed; not a replacement formal result or design acceptance. Full followup feasibility remains to be checked.'};
fs.writeFileSync('docs/audits/2026-10-18-design75-source-limit-probe.json',JSON.stringify(output,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:state.status,calls:state.usage.calls,checks:state.result?.checks.map(c=>({criterion:c.criterion,verdict:c.verdict,awaiting:c.awaitingSources?.length,reason:c.insufficiencyReason})),error:state.error}));
