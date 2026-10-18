// Evidence-bound local review only. Never mutates production designs or approvals.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadModelStore,activeChannel,connectionOf} from '../apps/api/src/model-settings.ts';
import {UsageLedger,redactSecrets,ModelGateway,OpenAICompatibleAdapter} from '../packages/model-gateway/src/index.ts';
import {JsonDesignPlanner} from '../packages/planner/src/index.ts';
const version=process.argv[2]??'v1';assert.match(version,/^v\d+$/);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const proof=JSON.parse(fs.readFileSync(`docs/audits/2026-10-18-design74-repairs-${version}-candidate.json`));
const c=JSON.parse(fs.readFileSync(proof.candidatePath));assert.equal(hash(c),proof.candidateSha256);
const baseline=JSON.parse(fs.readFileSync(proof.baselinePath));assert.equal(hash(baseline.candidate),proof.baseCandidateSha256);
const control=`data/audit-runtimes/design74-repair-${version}-review`;
// An exclusive manifest locks this review run; retry must use a new candidate/run.
fs.mkdirSync(control,{recursive:true});
const source=(id,value)=>{assert.notEqual(value,undefined,id);return {id,text:JSON.stringify(value,null,2)}};
const wp=(field,ids)=>ids.map(id=>source(`world/${field}/${id}`,c.worldPack[field].find(x=>x.id===id)));
const chapters=ns=>ns.flatMap(n=>[source(`plan/chapters/${n}`,c.plan.chapters.find(x=>x.chapterNumber===n)),source(`story/chapterPlans/bible-chapter-${n}`,c.storyBible.chapterPlans.find(x=>x.chapterNumber===n))]);
const milestones=ids=>ids.map(id=>source(`plan/milestones/${id}`,c.plan.milestones.find(x=>x.id===id)));
const before=ids=>ids.map(id=>source(`prior-design73/${id}`,baseline.candidate.plan.milestones.find(x=>x.id===id)));
const common=[source('candidate/context',{evaluationStage:'design_proposal',candidateSha256:proof.candidateSha256,note:'只评价候选自身可行性。prior-design73 是对照旧版，不是候选同时成立的事实。保留41个阻塞且不批准正文。'}),source('plan/overview',c.plan)];
// Keep the overview exact in meaning while avoiding duplication of all chapter bodies.
common[1]=source('plan/overview',Object.fromEntries(Object.entries(c.plan).filter(([k])=>!['chapters','milestones'].includes(k)).concat([['chapters',c.plan.chapters.map(({id,chapterNumber,volumeId,title})=>({id,chapterNumber,volumeId,title}))]])));
const requests={
world:{sources:[...common,...wp('factions',['fac_02','fac_08']),...wp('resources',['res_01']),...wp('realms',['realm_03']),...wp('techniques',['tech_19']),...chapters([29,30,31,32,33]),...milestones(['ms_growth_v1_crossing','ms_v3_return','ms_v3_training','ms_v3_advancement'])],rubric:{geography:'核214暮离港、216暮抵港、217晨卸货；出港许可效期、目的港核验、六箱申报与五箱实到、借符72小时、逾期停验是否闭合。不要只审31章而忽略32–33。',history:'核训练七枚实际来源与药舍费用，既有劳务、拖欠工钱及贺220旅资不可混算；新增短工约定是否是可行提案，有无免费恢复、重复支出或失效分支。',pacing:'评审候选新增资源、医修和通行安排与相邻时间、组织权限是否冲突，以及会否挤占人物选择、沦为账单堆砌。只核本次所给安排，不据局部材料断言全书缺失。'}},
power:{sources:[...common,...wp('axioms',['ax_05','ax_12']),...wp('realms',['realm_02','realm_03']),...wp('resources',['res_01']),...wp('techniques',['tech_04','tech_19']),...chapters([28,30,31,32,42,44,48]),...milestones(['ms_v3_return','ms_v3_training','ms_v3_advancement','ms_v3_convoy']),...before(['ms_v3_training'])],rubric:{tiers:'核六个有效周期、一个失败周期、逐周期复诊、失败后停训复诊再开、397完成及398静置、415诊察/承载复核后才支付十元载。失败必须真正延后进阶与参战。',costs:'核24枚实领减3欠款减14预付减7耗材等于0，七枚逐周期实际支出且失败不退；少做工、额外医药、延后等不得预支未来收入。核209/216寿储是不同日期，30章恢复、32章215御物、42章239试注及恢复、44章244出剑的分别成本与余额；不能补出无来源回复。',counters:'核436短暂牵制、前四人脱困、祁停斗交械、交原令、后四人开门、两趟转运的真实先后；护罡付费不保证成功，失败退路与伤后禁用是否一致。'}},
story:{sources:[...common,...chapters([18,19,28,30,31,32,33,42,44]),...milestones(['ms_v3_return','ms_v3_training','ms_v3_advancement','ms_v3_convoy']),...before(['ms_v3_convoy'])],rubric:{causality:'核181–183先行队与186–188换班守卫、顾在入口的岗位并非三日随队护送；核训练收入、失败、重开条件，以及救援停斗/交械/封令的先后是否可写且无循环因果。',continuity:'核改动与相邻原文时间、知情、资源一致，尤其215余额来源不等于239行动日期，209与216寿储不同。请指出具体原文冲突，不能用未写正文代替设计矛盾。',payoffs:'核增加具体账与医学门槛后人物是否仍有真实选择和失败代价；不抹去祁自保与承担责任、林失败停练及放弃追程的弧光。'}},
};
const inputs={};
for(const [area,req] of Object.entries(requests)){const scope={worldPackRevision:38,storyBibleRevision:70,planRevisionId:proof.basePlanId,planRevision:73};inputs[area]={area,scope,inputHash:hash({area,scope,...req}),...req};assert.ok(JSON.stringify(req.sources).length<=240000);}
const manifest={createdAt:new Date().toISOString(),candidateSha256:proof.candidateSha256,inputs:Object.fromEntries(Object.entries(inputs).map(([a,i])=>[a,hash(i)])),productionWrites:0,formalAcceptance:false};
fs.writeFileSync(`${control}/manifest.json`,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
for(const [area,input] of Object.entries(inputs)) fs.writeFileSync(`${control}/${area}-input.json`,JSON.stringify(input,null,2)+'\n',{flag:'wx'});
const settings=loadModelStore('data/model-settings.json');
const connection=connectionOf(activeChannel(settings),settings.source);
assert.equal(connection.planningModel,'gpt-5.6-luna');assert.ok(settings.channels.every(x=>!x.fallback));
const endpoint=connection.endpoint.replace(/\/$/,'').replace(/(?:\/v1)?$/,'/v1');
const ledger=new UsageLedger(Infinity,undefined,{maxCalls:6});
const gateway=new ModelGateway(new Map([['openai-compatible',new OpenAICompatibleAdapter(fetch,connection.timeoutMs,true)]]),ledger);
for(const [area,input] of Object.entries(inputs)){
 const path=`${control}/${area}-result.json`;
 const state={area,inputHash:input.inputHash,candidateSha256:proof.candidateSha256,model:connection.planningModel,fallback:false,status:'running',startedAt:new Date().toISOString(),rawResponses:[],productionWrites:0,formalAcceptance:false};
 fs.writeFileSync(path,JSON.stringify(state,null,2)+'\n',{flag:'wx'});
 const save=()=>fs.writeFileSync(path,JSON.stringify(state,null,2)+'\n');
 const planner=new JsonDesignPlanner({complete:async call=>{
  const response=await gateway.complete({role:call.role??'reviewing',model:connection.planningModel,system:call.system,user:call.user,maxOutputTokens:call.maxOutputTokens,responseFormat:'json',temperature:0.2},'openai-compatible',{endpoint,apiKey:connection.apiKey});
  state.rawResponses.push(response.text);state.usage=ledger.summary();save();return response.text;
 }});
 try {state.result=await planner.reviewDesignContent(input);state.status='completed';}
 catch(e){state.status='failed';state.failure=String(redactSecrets(e.message));}
 state.finishedAt=new Date().toISOString();state.usage=ledger.summary();save();
 console.log(JSON.stringify({area,status:state.status,responses:state.rawResponses.length,checks:state.result?.checks.map(({criterion,verdict,explanation})=>({criterion,verdict,explanation})),failure:state.failure}));
 if(state.status!=='completed'){process.exitCode=1;break;}
}
