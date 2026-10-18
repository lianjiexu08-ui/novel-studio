// Bounded detached review of the follow-up draft, serial with the formal worker.
// Preparation is offline. Execution requires a stopped, independently verified
// formal segment. This never applies a candidate or closes a production blocker.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const prepare = process.argv.includes('--prepare'), execute = process.argv.includes('--execute');
assert.notEqual(prepare, execute, 'Choose --prepare or --execute');
const proofPath = 'docs/audits/2026-10-18-design76-followup-controls-v1.json';
const proof = read(proofPath), candidate = read(proof.candidatePath);
assert.equal(hash(candidate), proof.candidateSha256);
const control = 'data/audit-runtimes/design76-followup-v1-review';
const bindingPath = 'data/audit-runtimes/design76-recovery-runtime-bound.json';
const binding = read(bindingPath);
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(`${binding.runtimePath}/${p}`), h);
for (const [p, h] of Object.entries(binding.dependencyHashes)) assert.equal(fileHash(p), h);
const source = (id, value) => { assert.notEqual(value, undefined, id); return {id, text: JSON.stringify(value, null, 2)}; };
const scope = {worldPackRevision:40, storyBibleRevision:72, planRevisionId:proof.basePlanId, planRevision:76};
const context = source('candidate/context', {
  stage:'unapplied_followup_draft', formalAcceptance:false,
  note:'只审本次候选规则与局部事实修正。prior-design76为旧版对照，不与候选同时生效。候选尚未写入生产，角色没有因新增规则自动取得器物或熟练度。保持原有41项阻塞；本次不验收全书，也不以正文尚未生成否定合理的设计提案。请找真实矛盾或执行缺口，不脑补补平；材料不足须明确具体缺失来源。',
});
const powerSources = [context,
  ...candidate.worldPack.axioms.map(x=>source(`world/axioms/${x.id}`,x)),
  ...candidate.worldPack.realms.filter(x=>['realm_02','realm_03','realm_04'].includes(x.id)).map(x=>source(`world/realms/${x.id}`,x)),
  ...candidate.worldPack.techniques.filter(x=>x.id==='tech_07').map(x=>source(`world/techniques/${x.id}`,x)),
  ...candidate.worldPack.resources.filter(x=>x.id==='res_01').map(x=>source(`world/resources/${x.id}`,x)),
  ...proof.corrections.map(x=>source(`prior-design76/artifacts/${x.id}`,{name:x.name,...x.before})),
  ...candidate.worldPack.artifacts.filter(x=>['art_04','art_06','art_08'].includes(x.id)).map(x=>source(`world/artifacts/${x.id}`,x)),
];
const characterSources = [context,
  ...proof.inheritedKnowledgeCorrections.map((x,i)=>source(`prior-design76/knowledge/${i+1}`,{sourceId:x.sourceId,field:x.fieldPath,before:x.before})),
  ...candidate.storyBible.arcBeats.filter(x=>x.id.startsWith('message-')).map(x=>source(`story/arcBeats/${x.id}`,x)),
  ...candidate.storyBible.relationships.filter(x=>['rel_02','rel_14'].includes(x.id)).map(x=>source(`story/relationships/${x.id}`,x)),
  ...candidate.storyBible.secrets.filter(x=>x.id==='sec_02').map(x=>source(`story/secrets/${x.id}`,x)),
  ...candidate.storyBible.characters.filter(x=>['char_01','char_03','char_14','char_15','char_16','char_24','char_25'].includes(x.id)).map(x=>source(`story/characters/${x.id}`,x)),
  source('plan/chapters/50',candidate.plan.chapters.find(x=>x.chapterNumber===50)),
  source('story/chapterPlans/bible-chapter-50',candidate.storyBible.chapterPlans.find(x=>x.chapterNumber===50)),
  ...candidate.plan.milestones.filter(x=>['ms_v2_fire','ms_v3_payoff'].includes(x.id)).map(x=>source(`plan/milestones/${x.id}`,x)),
];
const specs = {
  power: {sources:powerSources,rubric:{
    tiers:'只核三件修订法宝art_04、art_06、art_08在玄府及以上的操控资格是否自洽：握持、可见定向、本境训练与实测范围是否足以执行，是否仍偷用未定义玄府神识。分清器物品级和使用者境界，不把规则新增写成角色已学会。',
    costs:'核修订的元罡/高阶当境法力、灵石、分阶段预付、注意力与伤损是否分清，是否出现免费持续、失败退款漏洞、低境账户重复支出，或在既有费用之外偷加未定义储备。比较旧版费用，指出实质变化及是否有明确可执行解释。',
    counters:'逐件推演看不见目标、器物脱手、操作者受击和持续供能中断：烟罩遮蔽本人视线后如何保持接触控制，凝晶环落水及结冰后是否仍可观察，拂尘失供后实体银丝如何处理。核范围、时长、再次发动、残冰/残丝与既有反制是否互相矛盾；不得为了通过替作者增加新能力或流程。',
  }},
  characters: {sources:characterSources,rubric:{
    knowledge:'只核第50章现场、52章脚夫转述、53章赵实际阅报，以及98章程抵达和面报的四处候选修正。比对人物线锚点、秘密知情阶段、关系档与两项宏观里程碑：外院/棚内、两工自行离开/被带出、脚夫未听门前对话、程不在现场、438抵达/439获见、各人的有限证据是否一致。修正不能扩大脚夫视角或让赵提前知情，不能将转述当独立核实；未修改的宏观行动不视作已写正文。',
  }},
};
const inputs = Object.fromEntries(Object.entries(specs).map(([area,{sources,rubric}])=> {
  assert.ok(JSON.stringify(sources).length<=240000);
  return [area,{area,scope,inputHash:hash({area,scope,rubric,sources}),rubric,sources}];
}));
const manifestPath = `${control}/manifest.json`;
if (prepare) {
  assert.ok(!fs.existsSync(manifestPath));
  fs.mkdirSync(control,{recursive:true});
  for (const [area,input] of Object.entries(inputs)) fs.writeFileSync(`${control}/${area}-input.json`,JSON.stringify(input,null,2)+'\n',{flag:'wx'});
  fs.writeFileSync(manifestPath,JSON.stringify({candidateSha256:proof.candidateSha256,proofSha256:fileHash(proofPath),bindingSha256:fileHash(bindingPath),runnerSha256:fileHash(process.argv[1]),inputs:Object.fromEntries(Object.entries(inputs).map(([a,i])=>[a,hash(i)])),productionWrites:0,modelCalls:0},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({prepared:true,areas:Object.keys(inputs),sourceCharacters:Object.fromEntries(Object.entries(inputs).map(([a,i])=>[a,JSON.stringify(i.sources).length])),modelCalls:0,productionWrites:0}));
} else {
  const manifest = read(manifestPath);
  assert.equal(fileHash(process.argv[1]),manifest.runnerSha256);
  assert.equal(fileHash(proofPath),manifest.proofSha256);
  assert.equal(fileHash(bindingPath),manifest.bindingSha256);
  for (const [area,input] of Object.entries(inputs)) { assert.equal(hash(input),manifest.inputs[area]); assert.deepEqual(read(`${control}/${area}-input.json`),input); }
  const checkpointPath='data/audit-runtimes/design76-recovery/result.json',checkpoint=read(checkpointPath);
  assert.equal(checkpoint.status,'stopped_after_stage_limit','Wait for the formal segment to stop normally');
  try { process.kill(checkpoint.pid,0); assert.fail('Formal review worker still live'); } catch(e) { assert.equal(e.code,'ESRCH'); }
  const verification = read(`docs/audits/2026-10-18-design76-recovery-segment-${checkpoint.segment}.json`);
  assert.equal(fileHash(checkpointPath),verification.checkpointSha256);
  assert.equal(verification.workerAbsent,true);
  assert.equal(verification.unsettledCalls,0);
  const {JsonDesignPlanner}=await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
  const {loadModelStore,activeChannel,connectionOf}=await import(`${binding.runtimePath}/apps/api/src/model-settings.ts`);
  const {UsageLedger,ModelGateway,OpenAICompatibleAdapter,redactSecrets}=await import(`${binding.runtimePath}/packages/model-gateway/src/index.ts`);
  const settings=loadModelStore('data/model-settings.json'),conn=connectionOf(activeChannel(settings),settings.source);
  assert.equal(conn.planningModel,'gpt-5.6-luna');assert.ok(settings.channels.every(x=>!x.fallback));
  const outputPath=`${control}/result.json`;
  assert.ok(!fs.existsSync(outputPath),'Inspect existing results rather than repeat calls');
  const state={status:'running',pid:process.pid,startedAt:new Date().toISOString(),candidateSha256:proof.candidateSha256,formalCheckpointSha256:verification.checkpointSha256,model:conn.planningModel,fallback:false,productionWrites:0,formalAcceptance:false,areas:[],calls:0};
  const save=()=>{fs.writeFileSync(outputPath+'.pending',JSON.stringify(state,null,2)+'\n');fs.renameSync(outputPath+'.pending',outputPath);};
  save();
  const ledger=new UsageLedger(Infinity,undefined,{maxCalls:4}),gateway=new ModelGateway(new Map([['openai-compatible',new OpenAICompatibleAdapter(fetch,conn.timeoutMs,true)]]),ledger);
  const journal=`${control}/model-calls`;fs.mkdirSync(journal,{recursive:true});
  const durable=(p,x)=>fs.writeFileSync(p,JSON.stringify(x,null,2)+'\n',{flag:'wx',flush:true});
  for (const [area,input] of Object.entries(inputs)) {
    const record={area,status:'running',rawResponses:[],requests:[]};state.areas.push(record);save();
    const planner=new JsonDesignPlanner({complete:async req=>{
      const number=++state.calls,prefix=`${journal}/${String(number).padStart(5,'0')}`;
      const request={role:req.role??'reviewing',model:conn.planningModel,system:req.system,user:req.user,maxOutputTokens:req.maxOutputTokens,responseFormat:'json',temperature:0.2};
      durable(prefix+'.started.json',{number,area,startedAt:new Date().toISOString(),request});save();
      let response;
      try { response=await gateway.complete(request,'openai-compatible',{endpoint:conn.endpoint.replace(/\/$/,'').replace(/(?:\/v1)?$/,'/v1'),apiKey:conn.apiKey}); }
      catch(e) { durable(prefix+'.failure.json',{number,area,finishedAt:new Date().toISOString(),error:String(redactSecrets(e.message))});throw e; }
      durable(prefix+'.response.json',{number,area,finishedAt:new Date().toISOString(),response});
      record.requests.push(req);record.rawResponses.push(response.text);save();return response.text;
    }});
    try {
      record.result=await planner.reviewDesignContent(input);
      let replayed=0;
      const replay=new JsonDesignPlanner({complete:async req=>{assert.deepEqual(req,record.requests[replayed]);return record.rawResponses[replayed++];}});
      assert.deepEqual(await replay.reviewDesignContent(input),record.result);
      assert.equal(replayed,record.rawResponses.length);
      record.status='completed';record.responseReplay='verified';
    } catch(e) { record.status='failed';record.error=String(redactSecrets(e.message));state.status='failed';process.exitCode=1; }
    record.finishedAt=new Date().toISOString();state.usage=ledger.summary();save();
    console.log(JSON.stringify({area,status:record.status,checks:record.result?.checks.map(({criterion,verdict,explanation,revisionAdvice})=>({criterion,verdict,explanation,revisionAdvice})),calls:state.calls,error:record.error}));
    if(record.status==='failed')break;
  }
  if(state.status==='running')state.status='completed';state.finishedAt=new Date().toISOString();save();
}
