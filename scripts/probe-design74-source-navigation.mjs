// Reassess the exact earlier raw request in isolation; old reports stay intact.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {designReviewStageInput} from '../novel-service-core/src/design-review-run.ts';
import {JsonDesignPlanner} from '../packages/planner/src/index.ts';
import {loadModelStore,activeChannel,connectionOf} from '../apps/api/src/model-settings.ts';
import {UsageLedger,ModelGateway,OpenAICompatibleAdapter,redactSecrets} from '../packages/model-gateway/src/index.ts';
import {sourceNavigationGuidance} from './design-review-source-navigation.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
const path='data/audit-runtimes/design73-review/terminal-segment-15.json',bytes=fs.readFileSync(path),checkpoint=JSON.parse(bytes);
const run=checkpoint.runs.find(r=>r.input.area==='world'),stage=run.stages.find(s=>s.id==='cross-1-3');
assert.equal(run.scheduleVersion,34);
const oldCheck=stage.result.checks.find(c=>c.criterion==='geography');
assert.equal(oldCheck.insufficiencyReason,'unlocatable_sources');assert.equal(oldCheck.awaitingSources,undefined);
const input=designReviewStageInput(run,stage);
const requiredChapterIds=[19,20,21,22,...Array.from({length:21},(_,i)=>i+30)].map(n=>`plan/chapters/${n}`);
assert.ok(requiredChapterIds.every(id=>Object.hasOwn(input.stage.coverage.sourceLengths,id)));
assert.ok(requiredChapterIds.every(id=>!input.stage.sourceMap.some(u=>u.sourceId===id)));
const control='data/audit-runtimes/design74-source-navigation-probe';fs.mkdirSync(control,{recursive:true});
fs.writeFileSync(`${control}/input.json`,JSON.stringify(input,null,2)+'\n',{flag:'wx'});
const state={startedAt:new Date().toISOString(),status:'running',sourcePath:path,sourceSha256:sha(bytes),inputHash:sha(JSON.stringify(input)),guidanceSha256:sha(sourceNavigationGuidance),oldCheck,knownButUnreadSourceIds:requiredChapterIds,rawResponses:[],productionWrites:0,oldFindingChanged:false,formalAcceptance:false};
const out=`${control}/result.json`;fs.writeFileSync(out,JSON.stringify(state,null,2)+'\n',{flag:'wx'});const save=()=>fs.writeFileSync(out,JSON.stringify(state,null,2)+'\n');
const settings=loadModelStore('data/model-settings.json'),conn=connectionOf(activeChannel(settings),settings.source);assert.equal(conn.planningModel,'gpt-5.6-luna');assert.ok(settings.channels.every(c=>!c.fallback));
const ledger=new UsageLedger(Infinity,undefined,{maxCalls:2});const gateway=new ModelGateway(new Map([['openai-compatible',new OpenAICompatibleAdapter(fetch,conn.timeoutMs,true)]]),ledger);
const planner=new JsonDesignPlanner({complete:async req=>{const response=await gateway.complete({role:req.role??'reviewing',model:conn.planningModel,system:req.system+sourceNavigationGuidance,user:req.user,maxOutputTokens:req.maxOutputTokens,responseFormat:'json',temperature:0.2},'openai-compatible',{endpoint:conn.endpoint.replace(/\/$/,'').replace(/(?:\/v1)?$/,'/v1'),apiKey:conn.apiKey});state.rawResponses.push(response.text);state.usage=ledger.summary();save();return response.text;}});
try{state.result=await planner.reviewDesignContent(input);state.status='completed';}catch(e){state.status='failed';state.failure=String(redactSecrets(e.message));process.exitCode=1;}
state.finishedAt=new Date().toISOString();state.usage=ledger.summary();assert.equal(sha(fs.readFileSync(path)),state.sourceSha256);save();
const proof={...state,oldCheck:{criterion:oldCheck.criterion,verdict:oldCheck.verdict,explanation:oldCheck.explanation,insufficiencyReason:oldCheck.insufficiencyReason},rawResponses:undefined,result:state.result?{summary:state.result.summary,checks:state.result.checks.map(({criterion,verdict,explanation,awaitingSources,insufficiencyReason})=>({criterion,verdict,explanation,awaitingSources,insufficiencyReason}))}:undefined,model:conn.planningModel,fallback:false,limitation:'独立重试只验证来源定位；不能改动旧报告、解除阻塞或证明新设计已通过。'};
fs.writeFileSync('docs/audits/2026-10-18-design74-source-navigation-probe.json',JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:state.status,checks:proof.result?.checks,calls:state.usage.calls,failure:state.failure}));
