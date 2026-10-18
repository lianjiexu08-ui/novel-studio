// Bind semantic observations to the actual requests, responses and frozen input.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const control='data/audit-runtimes/design76-notes29-review',verificationPath='docs/audits/2026-10-18-design76-notes29-review-segment-30.json';
const verification=read(verificationPath),state=read(verification.checkpointPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);assert.equal(state.segment,30);
try{process.kill(state.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
function call(number){
 const base=`${control}/model-calls/${String(number).padStart(5,'0')}`,requestPath=base+'.started.json',responsePath=base+'.response.json';
 const started=read(requestPath),response=read(responsePath),payload=JSON.parse(started.request.user),request=payload.originalRequest??payload;
 const raw=JSON.parse(response.response.text),run=state.runs.find(r=>r.id===started.step.runId),stage=run.stages.find(s=>s.id===started.step.stageId);
 assert.ok(stage.result);assert.ok(stage.modelResponses.includes(response.response.text));
 return {number,requestPath,responsePath,requestSha256:sha(requestPath),responseSha256:sha(responsePath),payload,request,raw,run,stage};
}
const calls=Array.from({length:state.totalCalls-204},(_,i)=>call(i+205)),get=n=>calls.find(c=>c.number===n);
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
 support(205,'world/historicalEvents/event_08','垄断同一天地内穿越虚海的跨大陆飞舟商路，不穿越天地界壁'),
 support(205,'world/historicalEvents/event_13','历史成功疗程不证明某人当前持有旧库存或已知本书后续日期。'),
 support(205,'world/historicalEvents/event_14','旧约只交换有限物流与资金，不是共享全部功法、界门知识或九鼎真相。'),
 support(205,'world/historicalEvents/event_14','炎煞外围代理若实际收到货损或查验通知，可扣留尚未交付的自家货'),
 support(205,'world/historicalEvents/event_14','炎煞真身在实际获报前不会自动知港火、北境失货或赵单方重整。'),
 support(205,'world/factions/fac_12','宁可拒绝高价订单也不得空掉原巡界岗。'),
 support(206,'plan/volumes/vol_01','卷末凝元三重，不使用逆命真解。'),
 support(206,'plan/volumes/vol_02','不以进入天坑或杀神海作门槛。'),
 support(206,'plan/milestones/ms_v2_loss','林辰仅亲见一名货工试移第六箱，未亲见失箱。'),
 support(206,'plan/milestones/ms_v2_fire','程不在本次控人现场，没有纵火或携匣逃离镜头。'),
 support(206,'plan/milestones/ms_v2_boundary','这些是货运线索，不是第二片图样，不能凭同封号认定匣内物。'),
 supportEmbedded(207,'world/techniques/tech_19','六个有效周期至少六枚，每个失败或中断的开封周期另耗一枚'),
 supportEmbedded(207,'world/techniques/tech_19','须静置一日、白榆诊察和顾峤承载复核均通过，才可按realm_03支付十元载。'),
 supportEmbedded(207,'world/artifacts/art_03','玄府元罡仍不得灌入本剑。'),
 supportEmbedded(207,'world/axioms/ax_09','该收入不返还已燃寿元、已付晋阶成本、自然衰老、道伤、神魂本源或术法冷却。'),
 supportEmbedded(207,'world/techniques/tech_04','有效距离取本人同式实测稳定导刃距离与百丈总上限中较小者；百丈不是入门即有的能力。'),
 supportEmbedded(207,'world/techniques/tech_16','不能隔界抹杀未知人名、追溯过去、重建神格或复活死者。'),
 support(207,'plan/overview','1–100是450章的阶段验收'),
 supportEmbedded(208,'story/relationships/rel_12','两工自行出门后拒绝立即回船，贺接受。'),
 supportEmbedded(208,'story/relationships/rel_13','完整改签自述仍须53实际书写签认。'),
 supportEmbedded(208,'story/arcBeats/message-first-read','赵只信为程的利己自述，不鉴定匣内物，不知道陆53交页或291北境未来结果。'),
 supportEmbedded(208,'story/arcBeats/message-first-ack','林苏仍不知道此番交接。'),
 support(208,'plan/overview','百章只切断已实证的一条三地运输链'),
 supportEmbedded(209,'story/promises/prom_01','不是第29章再服一剂或重复延寿。'),
 supportEmbedded(209,'world/axioms/ax_08','不能把整个机构的载荷藏在半成御物费里。'),
 support(209,'plan/overview','第83章：数月努力与诊察后，实际付十元载晋玄府；不能再用旧法器承载元罡。'),
 support(210,'plan/chapters/32','第214日日暮至第216日日暮；实体海程两昼夜'),
 support(210,'plan/chapters/32','不能用214日旧通告代替今天核验'),
 support(210,'plan/chapters/33','213–216返宗以白天慢车行路、夜间停营执行，不连夜赶车'),
 support(210,'plan/chapters/33','新租符与此前船方借符为两张不同实物，后者已经退回'),
 support(210,'plan/chapters/43','不能把拖力压在御物上。'),
 support(210,'plan/chapters/44','受力落在船桩，林不悬提人。'),
 support(210,'plan/chapters/45','大艇吃水不能上滩，巡员用随艇小划舟靠近并分趟接人。'),
 supportEmbedded(211,'world/realms/realm_03','每个开封失败周期另损一枚，实际库存不足则延期'),
 supportEmbedded(211,'plan/milestones/ms_v3_advancement','六个有效周期完成→静置观察→白榆诊察→顾峤复核→十元载扣除'),
 supportEmbedded(211,'plan/milestones/ms_v3_training','六个有效周期60日，加失败4日，实耗七枚'),
 supportEmbedded(211,'plan/milestones/ms_v3_training','每次未通过立即停，不把上次许可无限沿用。'),
 supportEmbedded(211,'world/tierLadders/ladder_technique','高品阶不能跳过允许境界、单次消耗、冷却或反制'),
 supportEmbedded(211,'plan/chapters/25','并非推劲付费就必能击倒同阶。'),
 supportEmbedded(212,'plan/chapters/40','不替程补工。'),
 supportEmbedded(212,'plan/chapters/50','五名雇工至此全部脱控；被谁雇用、为谁作证，仍由他们自己回答。'),
 supportEmbedded(212,'story/secrets/sec_01','残片刻痕可与旧图对应，为追查收货链提供线索，未得到过去的完整影像。'),
 supportEmbedded(212,'story/arcBeats/message-custody-read','苏同日把另份案卷交本地监督点，两件文书没有共享途径。'),
 supportEmbedded(212,'story/secrets/sec_02','不知道是否已送达程，也不确认林贺曾进入棚内。'),
 supportEmbedded(213,'plan/milestones/ms_v2_voyage','第271–274日乘普通车沿每日复核开放的既有沿岸驿道从天宝外港到极焱天港'),
 supportEmbedded(213,'plan/milestones/ms_v2_voyage','276日暮离港、281日暮抵葬骨外港，五昼夜完整航程。'),
 supportEmbedded(213,'plan/milestones/ms_v3_training','六个有效周期60日，加失败4日，实耗七枚'),
 supportEmbedded(213,'plan/milestones/ms_v3_advancement','六个有效周期完成→静置观察→白榆诊察→顾峤复核→十元载扣除'),
];
assert.equal(get(206).raw.repairMode,'citation_edits');
assert.deepEqual(get(206).raw.updates[0].addEvidence.map(e=>e.fragmentId),['e198','e200','e222','e230','e245']);
assert.deepEqual(get(206).raw.updates[0].removeResolutions,[]);
const scopeLimits=[
 {number:213,limit:'Synthesis-3 covers batch-5/cross-1-2 only. Its timeline wrongly calls 271–281 five nights at sea; actual embedded milestone e38/e39 separates 271–274 land travel, 275 ticket payment and 276 dusk–281 dusk sailing. A separate annotation is prepared; original verdict is retained.'},
 {number:212,limit:'Synthesis-19 only covers 8 of 24 raw stages. Original e50 leaves Lin/He outside while e23 still repeats the known dispatch-inside conflict. At chapter 50 only actual face-to-face answers become known, not all chapter-48 private conversation. Existing fixes and annotations remain necessary.'},
 {number:211,limit:'Synthesis-6 preserves cross-2-4 tiers/costs revisions by requiredFindings. Its e47/e57 already embed original advancement/training excerpts with six valid periods, one failed period, seven stones and ordered medical checks. Thus preserved historical revise is not proof that the full design lacks these provisions; existing root-report clarifications remain relevant. No new revision is counted and no old verdict is rewritten.'},
 {number:209,limit:'Only batch-3/4 are synthesized (2 of 38 raw stages). Seven check verdicts are local; summary says six. Historical resolution e247 still abbreviates 271–281 as five days; actual sailing interval remains 276 dusk–281 dusk. No new full-original reread or global story acceptance.'},
 {number:207,limit:'Synthesis-5 is a partial report subtree. Its local pass does not replace artifact revisions retained in synthesis-1/3/4.'},
 {number:208,limit:'Synthesis-18 reads synthesis-11/12, overview and resolution context, not every original character source. Parent e42 still misattributes Zhao reports to Lin; e51 retains the known inside/outside dispatch conflict. Existing independent annotations and offline candidate remain necessary; no global character acceptance.'},
];
assert.ok(get(208).request.sources.some(s=>s.fragments.some(f=>f.id==='e42'&&f.text.includes('林辰在第50—52章只知道附棚现场行为，53章才通过程报形成受限认知'))));
assert.ok(get(208).request.sources.some(s=>s.fragments.some(f=>f.id==='e51'&&f.text.includes('亲见林贺随巡查进附棚'))));
const proof={kind:'design76_segment30_source_scope_crosscheck',verified:true,runnerSha256:sha(process.argv[1]),verificationPath,verificationSha256:sha(verificationPath),checkpointSha256:verification.checkpointSha256,
 calls:calls.map(c=>({number:c.number,requestPath:c.requestPath,requestSha256:c.requestSha256,responsePath:c.responsePath,responseSha256:c.responseSha256,stageId:c.stage.id,acceptedStageSha256:hash(c.stage)})),evidence,scopeLimits,
 contentLimit:'Selected semantic checks only. Existing artifact and admission revision findings remain open. Local and intermediate passes do not approve the whole design, repair known dispatch/identity conflicts, or validate prose.',annotationsAdded:0,modelCalls:0,productionWrites:0,formalAcceptance:false};
const out='docs/audits/2026-10-18-design76-segment30-source-scope.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,calls:calls.length,sourceClaims:evidence.length,productionWrites:0}));
