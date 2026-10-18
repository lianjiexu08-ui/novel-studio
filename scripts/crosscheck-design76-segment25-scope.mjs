// Bind selected semantic checks to this segment's actual requests and immutable inputs.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const control='data/audit-runtimes/design76-notes24-review';
const verificationPath='docs/audits/2026-10-18-design76-notes24-review-segment-25.json',verification=read(verificationPath),state=read(verification.checkpointPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);assert.equal(state.segment,25);
try{process.kill(state.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
function call(number){
 const base=`${control}/model-calls/${String(number).padStart(5,'0')}`,requestPath=base+'.started.json',responsePath=base+'.response.json';
 const started=read(requestPath),response=read(responsePath),payload=JSON.parse(started.request.user),request=payload.originalRequest??payload;
 const raw=JSON.parse(response.response.text),run=state.runs.find(r=>r.id===started.step.runId),stage=run.stages.find(s=>s.id===started.step.stageId);
 assert.ok(stage.result);assert.ok(stage.modelResponses.includes(response.response.text));
 return {number,requestPath,responsePath,requestSha256:sha(requestPath),responseSha256:sha(responsePath),payload,request,raw,run,stage};
}
const calls=Array.from({length:state.totalCalls-160},(_,i)=>call(i+161)),get=n=>calls.find(c=>c.number===n);
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
 support(168,'plan/chapters/44','原账随陆逃走，半页来源仍须核对'),
 support(168,'plan/chapters/50','五名雇工至此全部脱控；被谁雇用、为谁作证，仍由他们自己回答。'),
 support(168,'plan/chapters/50','协助不换免罪。'),

 supportEmbedded(167,'story/secrets/sec_01','父亲曾参与守门工作的证据来自署名图纸和撤离记录；尚不知父案全貌。'),
 supportEmbedded(167,'story/chapterPlans/chapter-plan-8','林辰同意保留这项不利证词，也承认梁九有权自行陈述。'),

 support(166,'plan/chapters/25','拨废料斗空载轻销另付半成，不御物托斗搬矿料。'),
 support(166,'plan/chapters/26','不能把备用额度写成十二小时持续禁锢。'),
 support(166,'plan/chapters/43','后续拖力由船行、普通索具和艉桩承担，不收持续施术费，也不能持续遥控钩索转向。'),
 support(166,'plan/chapters/43','试挂失败便停术，不靠凝元身份自动获得技巧。'),
 support(165,'world/historicalEvents/event_14','本书开篇前三年订立，旧框架延续至百章阶段；各批订单仍须另行实送、点交与结算'),
 support(165,'world/historicalEvents/event_14','历史约页不是当前库存或已付船票。'),
 support(165,'story/relationships/rel_06','未给炎煞新增送达节点，不写炎煞已接令、同意涨价或承诺赔付。'),
 support(164,'plan/milestones/ms_v2_voyage','276日暮离港、281日暮抵葬骨外港，五昼夜完整航程。'),
 support(164,'plan/milestones/ms_v3_return','315日主角返乡结算时，第二段仍在途中'),
 support(164,'plan/milestones/ms_v3_return','第304日暮出航、第310日暮沧溟古港抵达，六昼夜。'),
 support(164,'plan/chapters/33','217日晚，林确认严身份'),
 support(164,'plan/milestones/ms_v3_payoff','98章439程按普通驿路到乾都面报逃前所见'),
 supportEmbedded(163,'story/relationships/rel_22','脱控后仍须各谈生计，不因同伴或救命关系承诺永久同行。'),
 supportEmbedded(163,'story/relationships/rel_13','陆的协助已从指路变为阻止旧同伙继续扣人，却同时暴露自己的押送责任，林不以协助换免罪。'),
 supportEmbedded(163,'story/relationships/rel_21','各人实际同意并落实住食后才生效，作证不换工食。'),
 support(162,'world/artifacts/art_20','每次启动前须在两座独立槽座各装一枚完整res_01下品青灵石，共两枚'),
 support(162,'world/artifacts/art_20','受害者血液不是免费的启动能源。'),
 support(162,'world/techniques/tech_19','本卷一次失败加六个有效周期实际共耗七枚'),
 support(162,'plan/milestones/ms_v3_training','第三枚报废不退、该周期不计有效'),
 support(162,'plan/milestones/ms_v3_training','现金24枚与课程是同一合同的两个报酬项'),
 support(162,'plan/milestones/ms_v3_advancement','六个有效周期完成→静置观察→白榆诊察→顾峤复核→十元载扣除'),
 support(161,'world/locations/loc_02','港务可先登记为获救待核人员，安排港卫陪同移至同一泊区监管界内的救济候查暖房'),
 support(161,'plan/milestones/ms_v2_boundary','核定使用泊区内原救济所候查暖房至300日。'),
 support(161,'plan/milestones/ms_v2_boundary','七人未取得引渡令或独立具名担保时，不得随林贺离港。'),
 support(161,'world/locations/loc_21','同一天地内的虚海航网，不穿越太古界门'),
 support(161,'world/locations/loc_21','商业信物不能豁免扣船、搜舱或追缴。'),
 support(161,'world/locations/loc_26','外部患者须按loc_21普通航程实际到港，未到港不开始远程疗程。'),
 support(161,'world/locations/loc_27','按无尽虚海商路 loc_21 对应航段验籍，支付或记录代付责任；战时封锁另行处理。'),
];
for(const id of ['world/locations/loc_21','world/locations/loc_26','world/locations/loc_27'])assert.ok(get(161).request.sources.some(s=>s.origin?.sourceId===id));
for(const id of ['world/artifacts/art_04','world/artifacts/art_06','world/artifacts/art_08'])assert.ok(!get(166).request.sources.some(s=>s.origin?.sourceId===id));
for(const n of [164,168])for(let chapter=1;chapter<=50;chapter++)assert.ok(get(n).request.sources.some(s=>s.origin?.sourceId===`plan/chapters/${chapter}`));
for(const [number,parents]of [[163,['cross-4-5','followup-cross-2-4/relationships']],[167,['followup-cross-2-4/knowledge','followup-cross-2-5/relationships']]])assert.deepEqual(get(number).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id.slice('review-result/'.length)),parents);
const proof={kind:'design76_segment25_source_scope_crosscheck',verified:true,runnerSha256:sha(process.argv[1]),verificationPath,verificationSha256:sha(verificationPath),checkpointSha256:verification.checkpointSha256,
 calls:calls.map(c=>({number:c.number,requestPath:c.requestPath,requestSha256:c.requestSha256,responsePath:c.responsePath,responseSha256:c.responseSha256,stageId:c.stage.id,acceptedStageSha256:hash(c.stage)})),evidence,
 geographyScope:{call:161,requiredSourcesSent:true,limitation:'The three original location rules were actually sent. A suspected shelter mismatch was disproven: loc_02 and the boundary milestone explicitly place the rescue facility’s waiting shelter inside the same supervised harbor zone; the seven rescued people do not receive permission to leave with the protagonists. Passage remains physical, paid and subject to local checks; these sources do not turn proposed voyages into completed events or close unrelated design defects.'},
 characterSynthesis:{call:163,parents:['cross-4-5','followup-cross-2-4/relationships'],limitation:'Partial parent synthesis. The embedded resolution still contains the previously annotated Zhao/Lin recipient conflation; the generic knowledge pass does not erase that annotation or establish a fresh full-source check.'},
 timelineScope:{call:164,limitation:'Full first-50 chapter input plus two volumes and ten milestones was actually sent. Separate clarification corrects the 271–281 five-day-voyage claim. Existing identity timing and Cheng arrival/report wording remain unresolved; a timeline pass does not supersede the offline v4 candidate.'},
 contentLimit:'Selected semantic checks only; local passes do not close blockers, approve global design or validate prose.',annotationsAdded:0,annotationDrafts:2,modelCalls:0,productionWrites:0,formalAcceptance:false};
const out='docs/audits/2026-10-18-design76-segment25-source-scope.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,calls:calls.length,sourceClaims:evidence.length,productionWrites:0}));
