// Bind selected semantic checks to this segment's actual requests and immutable inputs.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const control='data/audit-runtimes/design76-notes23-review';
const verificationPath='docs/audits/2026-10-18-design76-notes23-review-segment-24.json',verification=read(verificationPath),state=read(verification.checkpointPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);assert.equal(state.segment,24);
try{process.kill(state.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
function call(number){
 const base=`${control}/model-calls/${String(number).padStart(5,'0')}`,requestPath=base+'.started.json',responsePath=base+'.response.json';
 const started=read(requestPath),response=read(responsePath),payload=JSON.parse(started.request.user),request=payload.originalRequest??payload;
 const raw=JSON.parse(response.response.text),run=state.runs.find(r=>r.id===started.step.runId),stage=run.stages.find(s=>s.id===started.step.stageId);
 assert.ok(stage.result);assert.ok(stage.modelResponses.includes(response.response.text));
 return {number,requestPath,responsePath,requestSha256:sha(requestPath),responseSha256:sha(responsePath),payload,request,raw,run,stage};
}
const calls=Array.from({length:state.totalCalls-152},(_,i)=>call(i+153)),get=n=>calls.find(c=>c.number===n);
function support(number,sourceId,quote){
 const c=get(number);assert.ok(c.run.input.sources.find(s=>s.id===sourceId)?.text.includes(quote));
 const fragments=c.request.sources.filter(s=>s.origin?.sourceId===sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(quote)).map(f=>f.id));
 assert.ok(fragments.length,`Source not actually sent: ${number} ${sourceId}`);return {number,sourceId,quote,fragments};
}
function supportEmbedded(number,sourceId,quote){
 const c=get(number);assert.ok(c.run.input.sources.find(s=>s.id===sourceId)?.text.includes(quote));
 const embedded=c.request.sources.filter(s=>s.id.startsWith('review-result/')).flatMap(s=>s.fragments.filter(f=>f.text.includes(quote)).map(f=>({parent:s.id,fragment:f.id})));
 assert.ok(embedded.length);return {number,sourceId,quote,embedded,scope:'Original quotation embedded in a partial parent report, not a complete original-source reading.'};
}
const evidence=[
 support(160,'plan/milestones/ms_v2_voyage','276日暮离港、281日暮抵葬骨外港，五昼夜完整航程。'),
 support(160,'plan/milestones/ms_v3_return','不重扣10000，也不把封存3000再记成收入。'),
 support(160,'plan/milestones/ms_v3_payoff','第466日回访距436日高潮三十日'),
 support(160,'plan/chapters/33','217日晚，林确认严身份、程拒接且要求全赔'),
 support(160,'plan/chapters/33','知识边界修复：本章侧门视角只属于读者与独立角色，不能回写林辰的endHook或当晚认知'),
 supportEmbedded(159,'story/chapterPlans/bible-chapter-50','陆改为外拉木闩，协助控制旧手下，承认本次点交押送并接受继续看护。'),
 supportEmbedded(159,'story/chapterPlans/bible-chapter-33','他尚不知道严涛身份、常钧搬箱或陆沉川接走重箱，也没有从侧门独立视角获得这些信息。'),
 support(158,'world/artifacts/art_20','这套器具不抽寿储、不生成命度、龙气或灵泉，不给操作者恢复体力、延寿或晋阶。'),
 support(158,'world/artifacts/art_20','凡人机械转阀不另借操作者法力，不能用一枚供两路'),
 support(158,'plan/milestones/ms_v3_training','借阅只在顾在场时进行、当次课后原本收回，不赠原本、不向林另赠寿储或灵石。'),
 support(158,'plan/milestones/ms_v3_advancement','原赤霞斩铁剑不得灌玄府罡气，归还领用库并核对损耗'),
 support(157,'world/historicalEvents/event_14','炎煞外围代理若实际收到货损或查验通知，可扣留尚未交付的自家货、拒绝新增仓位或要求先清欠款'),
 support(157,'plan/volumes/vol_02','炎煞港口代理催货；赵的实体回令与商盟内部自保。'),
 support(157,'story/overview','百章只切断已实证的一条三地运输链；九鼎全貌、三残片与最终界门危机仍是约450章全书必须收束的主线。'),
 support(156,'plan/chapters/18','顾在原训练场复测其可见目标导刃、停式及剑冷后再用，确认凝元式稳定，未教成玄府式。'),
 support(156,'story/characters/char_10','这是既有修习背景，不代表后续伤情、余量或冷却自动满足'),
 support(156,'plan/chapters/27','199日复诊确认完整药程有效后才新增5元载，有效剂数0到1、原液6到3。'),
 support(156,'plan/chapters/28','累计10元载不等于本章再增10，延寿不治腿伤或补真元。'),
 supportEmbedded(155,'plan/chapters/45','贺付尽修船款，仍不要求工人用口供补偿自己。'),
 supportEmbedded(155,'plan/chapters/50','贺接受二人不立刻回船的回答，先安排安全落脚，不以救命索取服从。'),
 supportEmbedded(155,'story/secrets/sec_03','相信夜根据守界经历说出的界壁外寂灭风险，没有亲眼看死海。'),
 support(153,'world/historicalEvents/event_14','历史约页不是当前库存或已付船票。'),
 support(153,'story/relationships/rel_06','53章第一报和回令均由程与赵府经手；没有给炎煞真身的送达或阅览节点。'),
 support(154,'plan/chapters/25','8.5−2−0.5=6成'),
 support(154,'plan/chapters/25','顾的0.25元载属于顾本人，林本场没有发动燃寿术。'),
 support(154,'plan/chapters/25','真光结束顾即停术，墨仍有至少三成玄府元罡，不因属性受克自动失去行动。'),
 support(154,'world/techniques/tech_19','不能把静修时长或灵石投入当作寿储收入。'),
 support(154,'plan/milestones/ms_v3_advancement','六个有效周期完成→静置观察→白榆诊察→顾峤复核→十元载扣除'),
 support(154,'world/techniques/tech_15','本源基准不随余量下降，布纹中断或提前收印均不退已付成本。'),
 support(154,'world/techniques/tech_16','对应本源基准不随余额递减；这类损伤永久保留，不能由普通静息、功德或胜利抵销。'),
];
for(const id of ['plan/chapters/25','world/techniques/tech_15','world/techniques/tech_16','world/techniques/tech_19'])assert.ok(get(154).request.sources.some(s=>s.origin?.sourceId===id));
for(const id of ['plan/chapters/18','world/techniques/tech_04','world/techniques/tech_06','story/characters/char_10'])assert.ok(get(156).request.sources.some(s=>s.origin?.sourceId===id));
for(const id of ['world/artifacts/art_20','world/techniques/tech_19','plan/milestones/ms_v3_training','plan/milestones/ms_v3_advancement'])assert.ok(get(158).request.sources.some(s=>s.origin?.sourceId===id));
const synthesis6Parents=get(155).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id);assert.deepEqual(synthesis6Parents,['review-result/cross-2-4','review-result/cross-2-5']);
const synthesis7Parents=get(159).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id);assert.deepEqual(synthesis7Parents,['review-result/cross-3-4','review-result/cross-3-5']);
const synthesis7Text=JSON.stringify(get(159).request.sources);assert.ok(synthesis7Text.includes('陆沉川主动交条并承认本次押送'));assert.ok(!synthesis7Text.includes('林确认严身份'));assert.ok(get(159).raw.checks.find(c=>c.criterion==='relationships').explanation.includes('陆沉舟停止协助扣人但仍受看护'));
const causalRequired=get(160).run.stages.find(s=>s.id==='cross-1-2').result.checks.find(c=>c.criterion==='causality').awaitingSources;
for(const id of causalRequired)assert.ok(get(160).request.sources.some(s=>s.origin?.sourceId===id),`Causality source absent: ${id}`);
for(let n=1;n<=50;n++)assert.ok(get(160).request.sources.some(s=>s.origin?.sourceId===`plan/chapters/${n}`));
const artifactScope=Object.fromEntries(['art_04','art_06','art_08'].map(id=>[id,get(154).request.sources.some(s=>s.origin?.sourceId===`world/artifacts/${id}`)]));assert.deepEqual(Object.values(artifactScope),[false,false,false]);
assert.equal(8.5-2-0.5,6);assert.equal(10-2-3-2,3);assert.equal(5-1-1,3);
const proof={kind:'design76_segment24_source_scope_crosscheck',verified:true,runnerSha256:sha(process.argv[1]),verificationPath,verificationSha256:sha(verificationPath),checkpointSha256:verification.checkpointSha256,
 calls:calls.map(c=>({number:c.number,requestPath:c.requestPath,requestSha256:c.requestSha256,responsePath:c.responsePath,responseSha256:c.responseSha256,stageId:c.stage.id,acceptedStageSha256:hash(c.stage)})),evidence,
 historyScope:{call:153,limitation:'The old agreement and relationship stages were actually sent. Local proxy commercial authority and the distant principal’s knowledge are distinct; a separately bound clarification preserves those actors and delivery conditions.'},
 costsScope:{call:154,artifactScope,limitation:'Separate character accounts, training materials, advancement payment and high-tier irreversible costs support this local planned sequence. The three known artifact defects were not sent and remain open.'},
 synthesis6Scope:{call:155,parents:synthesis6Parents,limitation:'Partial synthesis. The actual embedded quotations preserve repair expenditure, worker autonomy and the difference between believing limited testimony and directly witnessing the outside world. They do not establish global character acceptance or remove known identity/message defects.'},
 growthScope:{call:156,requiredSourcesSent:true,limitation:'Training and actual range tests precede use. Gu’s prior qualification does not satisfy later injury/cooldown limits automatically. The two ten-day courses credit five lifespan units each only after review, without healing injuries or restoring mana; these remain proposed events.'},
 historySecondScope:{call:157,limitation:'This response keeps the local proxy as the actor and supports the limited three-region transport-chain objective. The author’s historical event was read as design source; investigators have not thereby acquired the original contract or learned all secrets. The 450-chapter final obligations remain open.'},
 tiersScope:{call:158,requiredSourcesSent:true,limitation:'The two-stone contact apparatus does not drain lifespan or confer cultivation. Authorized instruction, bounded borrowing and actual training precede advancement; the old sword cannot take the new realm’s energy. These are proposed prerequisites, not completed prose events.'},
 synthesis7Scope:{call:159,parents:synthesis7Parents,oldParentMisattributionActuallyPresent:true,badIdentityEndStateActuallyPresent:false,limitation:'The new relationship explanation correctly names Lu Chenzhou. Its parent still contains the previously annotated Lu Chenchuan misattribution; a general compatibility statement cannot erase that record. The corrected bible hook is embedded, but the conflicting plan endstate is absent, so the known identity-timing candidate remains required.'},
 causalityScope:{call:160,requiredSourcesSent:causalRequired,detailedChapters1Through50Sent:true,knownIdentityConflictActuallySent:true,limitation:'All requested chapters and second/third-volume milestones were sent. Five-day northbound travel, separately paid return passage and the thirty-day follow-up remain bounded proposed actions. The request also contains both the known bad chapter33 identity endstate and its contrary knowledge-boundary instruction; the local causal pass cannot clear this unresolved defect or approve continuation before the full quality gate.'},
 contentLimit:'Selected semantic checks only; local passes do not close blockers, approve global design or validate prose.',annotationsAdded:0,modelCalls:0,productionWrites:0,formalAcceptance:false};
const out='docs/audits/2026-10-18-design76-segment24-source-scope.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,calls:calls.length,sourceClaims:evidence.length,productionWrites:0}));
