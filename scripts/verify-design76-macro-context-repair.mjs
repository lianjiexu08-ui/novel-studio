// Independent offline verification. Preserve the executed runner and its mistaken
// insufficient-only expectation; evaluate this recorded answer against sent text.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const control='data/audit-runtimes/design76-macro-context-repair';
const manifest=read(control+'/manifest.json'),state=read(control+'/result.json');
const bindingPath='data/audit-runtimes/design76-macro-context-runtime-bound.json',binding=read(bindingPath);
const checkpointPath='data/audit-runtimes/design76-advice-review/terminal-segment-12.json';
assert.equal(sha('scripts/review-design76-macro-context-repair.mjs'),manifest.runnerSha256);
assert.equal(sha(bindingPath),manifest.bindingSha256);
assert.equal(sha(checkpointPath),manifest.checkpointSha256);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(`${binding.runtimePath}/${p}`),h);
for(const[p,h]of Object.entries(binding.dependencyHashes))assert.equal(sha(p),h);
for(const label of ['seedRequest','seedResponse'])assert.equal(sha(manifest[label+'Path']),manifest[label+'Sha256']);
assert.equal(state.status,'completed');assert.equal(state.productionWrites,0);assert.equal(state.modelCalls,1);assert.equal(state.replayedCalls,1);assert.equal(state.fallback,false);assert.equal(state.model,'gpt-5.6-luna');
try{process.kill(state.pid,0);assert.fail('Repair worker remains alive');}catch(e){assert.equal(e.code,'ESRCH');}
const formal=read(checkpointPath),run=formal.runs.find(r=>r.input.area==='story'),stage=run.stages.find(s=>s.id==='cross-2-5');
assert.equal(stage.result,undefined);
const runtime=await import(binding.runtimePath+'/novel-service-core/src/design-review-run.ts');
const {JsonDesignPlanner}=await import(binding.runtimePath+'/packages/planner/src/index.ts');
const input=runtime.designReviewStageInput(run,stage);
assert.equal(hash(input),manifest.inputSha256);assert.deepEqual(input,read(control+'/input.json'));
const seed=read(manifest.seedRequestPath).request,seedText=read(manifest.seedResponsePath).response.text;
const actual=read(control+'/request.json'),response=read(control+'/response.json');
const request=JSON.parse(actual.user),original=JSON.parse(seed.user),answer=JSON.parse(response.text);
assert.deepEqual(request.originalRequest,original);
const macroCoverage=[];
for(const id of ['plan/volumes/vol_02','plan/milestones/ms_v2_fire']){
 const candidate=request.macroSourceCandidates.find(s=>s.sourceId===id);assert.ok(candidate);
 const units=original.sources.filter(s=>s.origin?.sourceId===id);assert.equal(units.length,1);
 const unit=units[0],source=input.sources.find(s=>s.id===unit.id);assert.ok(source);
 assert.deepEqual(candidate.unitsInThisRequest,[unit.id]);
 assert.equal(unit.origin.start,0);assert.equal(unit.origin.end,source.text.length);
 assert.equal(unit.fragments.map(f=>f.text).join(''),source.text,'All original macro text must be sent');
 assert.doesNotThrow(()=>JSON.parse(source.text),'Macro is a full object, not a clipped excerpt');
 macroCoverage.push({sourceId:id,unitId:unit.id,characters:source.text.length,textSha256:hash(source.text),alreadyPresentInSeed:true});
}
const payoff=answer.checks.find(c=>c.criterion==='payoff');assert.equal(payoff.verdict,'pass');assert.equal(payoff.awaitingSources,undefined);assert.equal(payoff.insufficiencyReason,undefined);
const fragments=new Map(original.sources.flatMap(s=>s.fragments.map(f=>[f.id,{...f,unitId:s.id,origin:s.origin}])));
const cited=new Set(payoff.evidence.map(e=>e.fragmentId));
const obligations=[
 ['e283','吴卢自己推开门走进外院','第50章脱控已完成，工人去留由本人决定'],
 ['e341','停接新单也未解除','船修好不等于恢复经营或工人自动归队'],
 ['e342','陆须自己署名','第53章新写自述，弟只为亲见担保'],
 ['e343','254–256三日基本住食','救助期限、承担账户和原48枚修船工单明确'],
 ['e345','270期满不自动续为终身雇佣','吴卢短工自愿、有期限，逐人饭食与床位有对价'],
 ['e346','不超过六小时','贺自身岸工与补工有上限，林食宿由实际付款与轻工承担'],
 ['e347','内容仍须独立物证核验','签认副本不冒充原条原账，也不预支后日专项款'],
 ['e348','须在对应章落实才成为事实','宏观承诺仍是未来设计，不是已完成正文事实'],
].map(([fragmentId,needle,assessment])=>{
 assert.ok(cited.has(fragmentId));const fragment=fragments.get(fragmentId);assert.ok(fragment.text.includes(needle));
 return {fragmentId,sourceId:fragment.origin.sourceId,quote:fragment.text,assessment};
});
assert.match(payoff.explanation,/提案实现义务/);assert.match(payoff.explanation,/独立核验/);
let calls=0,suffix='';
const normalized=request=>({role:request.role??'reviewing',model:'gpt-5.6-luna',system:request.system+suffix,user:request.user,maxOutputTokens:request.maxOutputTokens,responseFormat:'json',temperature:0.2});
const planner=new JsonDesignPlanner({complete:async request=>{
 if(++calls===1){assert.ok(seed.system.startsWith(request.system));suffix=seed.system.slice(request.system.length);assert.deepEqual(normalized(request),seed);return seedText;}
 assert.equal(calls,2);assert.deepEqual(normalized(request),actual);return response.text;
}});
const result=await planner.reviewDesignContent(input);assert.equal(calls,2);assert.deepEqual(result,state.result);
assert.deepEqual(result.checks.flatMap(c=>c.resolves??[]).sort(),JSON.parse(seedText).checks.flatMap(c=>c.resolves??[]).sort());
const clone=structuredClone(run),target=clone.stages.find(s=>s.id===stage.id),{modelResponses,...content}=result;
runtime.acceptDesignReviewStage(clone,target,content);target.modelResponses=modelResponses;
assert.deepEqual(target.failures,stage.failures);assert.equal(hash(clone),state.rehearsedRunSha256);
const proof={kind:'design76_detached_macro_context_repair',verified:true,...manifest,
 verifierSha256:sha(process.argv[1]),stateSha256:sha(control+'/result.json'),requestSha256:sha(control+'/request.json'),responseSha256:sha(control+'/response.json'),
 sourceCommit:binding.sourceCommit,model:state.model,replayedSeedCall:75,originalModelCalls:1,modelCalls:0,productionWrites:0,formalAcceptance:false,
 rehearsedRunSha256:hash(clone),macroCoverage,semanticEvidence:obligations,payoff,
 verificationCorrection:'The executed runner expected insufficient and awaitingSources, but both complete macro sources were already sent in call75. This independent verifier preserves that runner and raw answers, verifies exact offline replay, and accepts the supported local macro-consistency conclusion. e291 is workflow status only, not substantive plot evidence.',
 limitation:'Only this detached local repair and cloned acceptance are verified. Other six checks were structurally replayed, not newly certified as full content acceptance. Future detailed chapters and prose must realize these obligations. No production review, blocker or design approval was changed.'};
const out='docs/audits/2026-10-18-design76-macro-context-repair.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,macroAlreadySent:true,originalModelCalls:1,productionWrites:0,formalAcceptance:false}));
