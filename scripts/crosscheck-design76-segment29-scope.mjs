// Bind semantic observations to the actual requests, responses and frozen input.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const control='data/audit-runtimes/design76-notes26-review',verificationPath='docs/audits/2026-10-18-design76-notes26-review-segment-29.json';
const verification=read(verificationPath),state=read(verification.checkpointPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);assert.equal(state.segment,29);
try{process.kill(state.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
function call(number){
 const base=`${control}/model-calls/${String(number).padStart(5,'0')}`,requestPath=base+'.started.json',responsePath=base+'.response.json';
 const started=read(requestPath),response=read(responsePath),payload=JSON.parse(started.request.user),request=payload.originalRequest??payload;
 const raw=JSON.parse(response.response.text),run=state.runs.find(r=>r.id===started.step.runId),stage=run.stages.find(s=>s.id===started.step.stageId);
 assert.ok(stage.result);assert.ok(stage.modelResponses.includes(response.response.text));
 return {number,requestPath,responsePath,requestSha256:sha(requestPath),responseSha256:sha(responsePath),payload,request,raw,run,stage};
}
const calls=Array.from({length:state.totalCalls-195},(_,i)=>call(i+196)),get=n=>calls.find(c=>c.number===n);
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
 support(196,'plan/chapters/33','loc_23天宝外港原船卸货区与侧门；插叙为loc_05入口外营至loc_29太清外门院'),
 support(196,'plan/chapters/33','213–216返宗以白天慢车行路、夜间停营执行，不连夜赶车'),
 support(196,'plan/chapters/33','林41章收到信前不得知道其返宗结果。'),
 supportEmbedded(198,'world/artifacts/art_04','无元罡、灵石库存或神识控雾能力任一项不足时不得展开。'),
 supportEmbedded(198,'world/artifacts/art_04','神海境以上修士可凭神念穿透遮蔽'),
 supportEmbedded(198,'world/axioms/ax_06','境界名称不能绕过这些条件。'),
 supportEmbedded(198,'world/axioms/ax_04','诊断校正不是寿元收入，未明部分不许花。'),
 supportEmbedded(198,'world/axioms/ax_05','两种恢复不能在同一时段叠加'),
 supportEmbedded(199,'story/chapterPlans/bible-chapter-48','林贺、陆及唐均未听见本章内线谈话，50须重新当面听两人回答。'),
 supportEmbedded(199,'story/relationships/rel_13','陆不能替工人选择去处。'),
 supportEmbedded(199,'story/relationships/rel_21','唐仍在原工铺，待51由贺告知后再当面见两人，不凭空知情。'),
 supportEmbedded(199,'story/relationships/rel_21','各人实际同意并落实住食后才生效，作证不换工食。'),
 support(200,'plan/chapters/18','第180日，顾逐一实测二人的凝元三重'),
 support(200,'plan/chapters/19','入口执事核对两人的凝元三重实测、联名符牌和本次路线。'),
 support(200,'plan/chapters/20','执行核算：10−2−0.5+1.5=9成'),
 support(200,'plan/chapters/21','本章只扣一次：9−0.5=8.5成'),
 support(200,'plan/chapters/29','213–216日返外门是苏随押解队的慢车行程，林辰不随该队回宗。'),
 support(201,'world/historicalEvents/event_14','旧约只交换有限物流与资金，不是共享全部功法、界门知识或九鼎真相。'),
 support(201,'world/factions/fac_08','搜集通界古玉与虚空神晶研究尚未开放的界门贸易，此野心不代表已经能够开门通航。'),
 support(201,'story/openThreads/th_01','全书后续追取投毒、施术与指挥链的独立证据，必须最终交代父案全貌。'),
 support(201,'story/openThreads/th_03','门外交易仍未证实，后续按实际发现收束而不是默认存在。'),
 support(201,'plan/overview','百章只切断已实证的一条三地运输链'),
 supportEmbedded(202,'world/axioms/ax_07','任一项不足即停术，不能用另一账补齐。'),
 supportEmbedded(202,'world/artifacts/art_04','无元罡、灵石库存或神识控雾能力任一项不足时不得展开。'),
 supportEmbedded(202,'world/artifacts/art_06','仅至少玄府境且能以神识确认落点者可催动'),
 supportEmbedded(202,'world/artifacts/art_06','控制中断仍扣已开始阶段费用'),
 supportEmbedded(202,'world/artifacts/art_06','在落环与控环期间击飞凝晶环或打断持有者神识'),
 supportEmbedded(203,'story/chapterPlans/chapter-plan-15','她明确这只是一扇复核门，不是对其修为、伤势或古境准入的保证。'),
 supportEmbedded(203,'story/chapterPlans/chapter-plan-17','苏只为公开调令、伤势记录和图纸交接程序担保，不为残玉作证。'),
 supportEmbedded(203,'story/chapterPlans/chapter-plan-21','秦禾当面说明主营方向与已走路线，只答应有限带路、送信，不承诺陪战。'),
 support(203,'plan/overview','1–100是450章的阶段验收'),
 supportEmbedded(204,'story/arcBeats/beat_v23_11','救伤者而放过程，不再把同伴当复仇代价。'),
 supportEmbedded(204,'story/arcBeats/message-formal-inquiry','来件只证明本次命令，不能包办父案与九鼎。'),
 supportEmbedded(204,'world/techniques/tech_19','本卷一次失败加六个有效周期实际共耗七枚'),
 supportEmbedded(204,'story/arcBeats/beat_v23_7','丹府未稳主动延期突破，失去护运遴选机会'),
 supportEmbedded(204,'story/secrets/sec_02','新写自述不是220夜原签条或原账'),
];
assert.deepEqual(get(198).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id),['review-result/batch-5','review-result/cross-1-2']);
assert.equal(get(198).stage.result.checks.find(c=>c.criterion==='tiers').verdict,'revise');
assert.deepEqual(get(199).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id),['review-result/synthesis-7','review-result/synthesis-8']);
assert.equal(get(197).payload.task,'repair_previous_output');
assert.deepEqual(get(197).payload.originalRequest,get(196).request);
assert.equal(get(197).raw.checks[0].explanation,get(196).raw.checks[0].explanation);
assert.deepEqual(get(202).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id),['review-result/cross-1-3','review-result/cross-1-4']);
assert.deepEqual(get(202).stage.result.checks.map(c=>[c.criterion,c.verdict]),[['tiers','revise'],['costs','revise'],['counters','revise']]);
assert.deepEqual(get(203).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id),['review-result/synthesis-9','review-result/synthesis-10']);
assert.deepEqual(get(204).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id),['review-result/batch-1','review-result/batch-2']);
const proof={kind:'design76_segment29_source_scope_crosscheck',verified:true,runnerSha256:sha(process.argv[1]),verificationPath,verificationSha256:sha(verificationPath),checkpointSha256:verification.checkpointSha256,
 calls:calls.map(c=>({number:c.number,requestPath:c.requestPath,requestSha256:c.requestSha256,responsePath:c.responsePath,responseSha256:c.responseSha256,stageId:c.stage.id,acceptedStageSha256:hash(c.stage)})),evidence,
 scopeLimits:[
 {call:196,limit:'The all-in-port description misses the chapter-33 independent Qingxuan return subplot; a separate five-quote clarification is prepared. Call 197 repairs citation structure only, retaining this wording.'},
 {call:198,limit:'Only batch-5 and cross-1-2 reports are synthesized. The art_04 tier/control revision remains open; costs/counters passes do not override synthesis-1 revision findings.'},
 {call:199,limit:'Only synthesis-7/8 and nested quotations are read. Historical parent resolutions still contain the known Lin/Zhao recipient mistake; the local pass does not close prior corrections or the plan-33 identity conflict.'},
 {call:200,limit:'Chapter 18 performs the day-180 three-level measurement; chapter 19 checks the existing measurement and permit at entry. Do not infer an extra test, ability or payment from the compressed review wording.'},
 {call:203,limit:'Only synthesis-9/10 and their excerpts are summarized; not a complete original-source reread. Existing source conflicts and historical recipient corrections remain open.'},
 {call:204,limit:'Only batch-1/2 report subtrees and plan overview are synthesized. Local seven-criterion passes do not approve remaining branches, unwritten chapters or prose.'},
 ],
 contentLimit:'Selected semantic checks only. Existing artifact and admission revision findings remain open. Local and intermediate passes do not approve the whole design, repair known dispatch/identity conflicts, or validate prose.',annotationsAdded:0,annotationDrafts:1,modelCalls:0,productionWrites:0,formalAcceptance:false};
const out='docs/audits/2026-10-18-design76-segment29-source-scope.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,calls:calls.length,sourceClaims:evidence.length,productionWrites:0}));
