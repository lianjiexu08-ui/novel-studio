// Bind semantic observations to the actual requests, responses and frozen input.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const control='data/audit-runtimes/design76-notes26-review',verificationPath='docs/audits/2026-10-18-design76-notes26-review-segment-28.json';
const verification=read(verificationPath),state=read(verification.checkpointPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);assert.equal(state.segment,28);
try{process.kill(state.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
function call(number){
 const base=`${control}/model-calls/${String(number).padStart(5,'0')}`,requestPath=base+'.started.json',responsePath=base+'.response.json';
 const started=read(requestPath),response=read(responsePath),payload=JSON.parse(started.request.user),request=payload.originalRequest??payload;
 const raw=JSON.parse(response.response.text),run=state.runs.find(r=>r.id===started.step.runId),stage=run.stages.find(s=>s.id===started.step.stageId);
 assert.ok(stage.result);assert.ok(stage.modelResponses.includes(response.response.text));
 return {number,requestPath,responsePath,requestSha256:sha(requestPath),responseSha256:sha(responsePath),payload,request,raw,run,stage};
}
const calls=Array.from({length:state.totalCalls-187},(_,i)=>call(i+188)),get=n=>calls.find(c=>c.number===n);
function support(number,sourceId,quote){
 const c=get(number);assert.ok(c.run.input.sources.find(s=>s.id===sourceId)?.text.includes(quote),`Absent original: ${number} ${sourceId}`);
 const fragments=c.request.sources.filter(s=>s.origin?.sourceId===sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(quote)).map(f=>f.id));
 assert.ok(fragments.length,`Source not actually sent: ${number} ${sourceId}`);return {number,sourceId,quote,fragments};
}
function supportEmbedded(number,sourceId,quote){
 const c=get(number);assert.ok(c.run.input.sources.find(s=>s.id===sourceId)?.text.includes(quote));
 const embedded=c.request.sources.filter(s=>s.id.startsWith('review-result/')).flatMap(s=>s.fragments.filter(f=>f.text.includes(quote)).map(f=>({parent:s.id,fragment:f.id})));
 assert.ok(embedded.length,`Absent embedded quotation: ${number} ${sourceId}`);return {number,sourceId,quote,embedded,scope:'Independent original excerpt inside a parent report; not a full original-source reread.'};
}
const evidence=[
 support(188,'world/factions/fac_02','边驿不授予商盟免检或跨境通行权。'),
 support(188,'world/factions/fac_08','商盟引荐只证明承运关系'),
 support(188,'world/factions/fac_12','宁可拒绝高价订单也不得空掉原巡界岗。'),
 support(188,'world/historicalEvents/event_13','历史成功疗程不证明某人当前持有旧库存或已知本书后续日期。'),
 support(188,'world/historicalEvents/event_14','旧约只交换有限物流与资金'),
 support(188,'world/historicalEvents/event_14','炎煞真身在实际获报前不会自动知港火、北境失货或赵单方重整。'),
 supportEmbedded(189,'world/artifacts/art_04','无元罡、灵石库存或神识控雾能力任一项不足时不得展开。'),
 supportEmbedded(189,'world/artifacts/art_06','仅至少玄府境且能以神识确认落点者可催动'),
 supportEmbedded(189,'world/artifacts/art_06','控制中断仍扣已开始阶段费用'),
 supportEmbedded(189,'world/axioms/ax_07','任一项不足即停术，不能用另一账补齐。'),
 supportEmbedded(190,'plan/chapters/50','贺在门外喊名，两人却要求出去。'),
 supportEmbedded(190,'plan/chapters/50','要求当面问他们是否愿留。'),
 supportEmbedded(190,'plan/chapters/50','吴却说回不回船要由他们自己定，卢也不愿立即上船。'),
 supportEmbedded(190,'story/secrets/sec_02','林贺留外院、两工自行出门及两看守被控'),
 supportEmbedded(190,'story/secrets/sec_02','也不确认林贺曾进入棚内。'),
 support(191,'world/artifacts/art_20','全程共用从首次起流算起的三十息限时，换档或间断不重置'),
 support(191,'world/artifacts/art_20','须在车被沙挡停稳后逐个解下、压住针孔再搬人。'),
 support(191,'world/artifacts/art_20','脱接后冷光持续至已付三十息周期结束，代表残能排散'),
 support(191,'plan/chapters/11','两路回阀闭合，随后沙挡将车停住。'),
 support(191,'plan/chapters/18','第120日突破，第180日核验'),
 support(191,'plan/chapters/19','第181日至第183日；第183日晚完成入境交接'),
 support(192,'world/axioms/ax_03','普通跨海飞舟、沿岸定位阵与大陆内部传送不经过太古界门'),
 support(192,'plan/milestones/ms_v3_return','第304日暮出航、第310日暮沧溟古港抵达，六昼夜。'),
 support(192,'plan/milestones/ms_v3_return','实际核验放行后，第311–314日才沿大乾普通驿路返外山'),
 support(192,'plan/milestones/ms_v3_return','315日两人当面交换材料'),
 supportEmbedded(193,'world/axioms/ax_06','晋阶不等于预付后续法术。'),
 supportEmbedded(193,'world/realms/realm_03','每个开封失败周期另损一枚，实际库存不足则延期'),
 supportEmbedded(193,'plan/chapters/25','并非推劲付费就必能击倒同阶。'),
 supportEmbedded(193,'plan/chapters/43','没有人在持续御物拖船。'),
 supportEmbedded(194,'story/relationships/rel_12','贺接受救回雇工不等于由自己决定其去处'),
 supportEmbedded(194,'story/relationships/rel_12','仅当相应住食和工时实际落实才进入该阶段'),
 supportEmbedded(194,'plan/chapters/33','值门水手未拆验；林不在场。'),
 supportEmbedded(194,'story/arcBeats/message-dispatch','公共巷口亲见林贺随巡查进附棚'),
 supportEmbedded(194,'story/secrets/sec_01','三份原始记录支持父亲守门参与与外山掩案责任；投毒与十年前完整因果仍未证实。'),
 support(195,'world/techniques/tech_02','淬体阶段只能低负荷导引，不形成可供外放施术的真元储备'),
 support(195,'world/techniques/tech_04','凝元式须分别练成起式、定向和主动停式并由教习实测，晋阶或持剑不能替代。'),
 support(195,'world/artifacts/art_03','无法承载玄府罡气强行灌注'),
 support(195,'world/artifacts/art_03','低流量试注只供已在授业中练成凝元注剑、收注与冷却检查者执行'),
 support(195,'plan/chapters/17','林辰失去五日训练与部分劳务收入，第120日能否突破仍待复测'),
 support(195,'plan/chapters/18','两丈是这次实际训练达到的范围，不把功法百丈上限当作本人已具备百丈感知或熟练度。'),
];
assert.deepEqual(get(189).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id),['review-result/batch-1','review-result/batch-2']);
assert.deepEqual(get(189).stage.result.checks.map(c=>[c.criterion,c.verdict]),[['tiers','revise'],['costs','revise'],['counters','revise']]);
assert.deepEqual(get(190).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id),['review-result/synthesis-3','review-result/synthesis-4']);
assert.deepEqual(get(193).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id),['review-result/batch-3','review-result/batch-4']);
assert.deepEqual(get(194).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id),['review-result/synthesis-5','review-result/synthesis-6']);
const proof={kind:'design76_segment28_source_scope_crosscheck',verified:true,runnerSha256:sha(process.argv[1]),verificationPath,verificationSha256:sha(verificationPath),checkpointSha256:verification.checkpointSha256,
 calls:calls.map(c=>({number:c.number,requestPath:c.requestPath,requestSha256:c.requestSha256,responsePath:c.responsePath,responseSha256:c.responseSha256,stageId:c.stage.id,acceptedStageSha256:hash(c.stage)})),evidence,
 scopeLimits:[
  {call:189,limit:'Intermediate synthesis of batch-1/2 retains the known art_04/art_06 control qualification defects. Offline v6 is not applied and was not reviewed here.'},
  {call:190,limit:'Chapter 50 transmits the spoken requests to leave and each worker deciding whether to return to the ship. It does not establish that the entire private chapter-48 conversation was repeated or became known to Lin/He.'},
  {call:192,limit:'The resolved cross-4-6 question concerns the named ancient-site and port routes. Its local pass does not close the separate cross-3-7/geography loc_29 visitor-admission revision.'},
  {call:193,limit:'Intermediate synthesis of batch-3/4 and embedded excerpts, not a reread of every original source. Its local pass cannot override synthesis-1 revision findings.'},
  {call:194,limit:'Intermediate synthesis of synthesis-5/6. Nested excerpts still contain the known message-dispatch inside-shed error and a historical Lin/Zhao recipient error. The plan-33 quotation is the side-door scene, not the conflicting identity endState; existing repairs remain necessary.'},
 ],
 contentLimit:'Selected semantic checks only. Existing artifact and admission revision findings remain open. Local and intermediate passes do not approve the whole design, repair known dispatch/identity conflicts, or validate prose.',annotationsAdded:0,modelCalls:0,productionWrites:0,formalAcceptance:false};
const out='docs/audits/2026-10-18-design76-segment28-source-scope.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,calls:calls.length,sourceClaims:evidence.length,productionWrites:0}));
