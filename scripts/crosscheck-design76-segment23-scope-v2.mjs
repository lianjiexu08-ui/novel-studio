// Independently bind selected semantic checks to the exact segment23 requests.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const control='data/audit-runtimes/design76-notes22-review';
const verificationPath='docs/audits/2026-10-18-design76-notes22-review-segment-23.json',verification=read(verificationPath),state=read(verification.checkpointPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);assert.equal(state.segment,23);
try{process.kill(state.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
function call(number){
 const base=`${control}/model-calls/${String(number).padStart(5,'0')}`,requestPath=base+'.started.json',responsePath=base+'.response.json';
 const started=read(requestPath),response=read(responsePath),payload=JSON.parse(started.request.user),request=payload.originalRequest??payload;
 const raw=JSON.parse(response.response.text),run=state.runs.find(r=>r.id===started.step.runId),stage=run.stages.find(s=>s.id===started.step.stageId);
 assert.ok(stage.result);assert.ok(stage.modelResponses.includes(response.response.text));
 return {number,requestPath,responsePath,requestSha256:sha(requestPath),responseSha256:sha(responsePath),payload,request,raw,run,stage};
}
const calls=Array.from({length:state.totalCalls-143},(_,i)=>call(i+144)),get=n=>calls.find(c=>c.number===n);
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
 supportEmbedded(151,'story/arcBeats/message-dispatch','林贺随巡查进附棚'),
 supportEmbedded(151,'plan/chapters/33','知识边界修复：本章侧门视角只属于读者与独立角色'),
 support(152,'plan/chapters/18','顾核定本次已稳定掌握的导刃距离为两丈内'),
 support(152,'plan/chapters/25','本式结束即停止灌注、收起热剑，之后拨插销用的是御物，不再以发热剑体施术。'),
 support(152,'plan/chapters/25','御动一息拨销，预付半成真元；小销只锁空载拨片'),
 support(152,'plan/chapters/25','真光结束顾即停术，墨仍有至少三成玄府元罡，不因属性受克自动失去行动。'),
 support(144,'plan/chapters/24','林苏坚持未见手势不动手。'),
 support(145,'plan/chapters/23','车身与散料共四百八十斤，低于墨开篇前已实际测过的五百斤'),
 support(145,'plan/chapters/24','不能把07:00出发视作即时抵达。'),
 support(145,'plan/chapters/25','墨仍有至少三成玄府元罡，不因属性受克自动失去行动。'),
 supportEmbedded(147,'plan/chapters/33','林尚不知道这次返宗。'),
 supportEmbedded(147,'plan/chapters/24','林苏坚持未见手势不动手。'),
 supportEmbedded(147,'plan/chapters/50','五名雇工至此全部脱控；被谁雇用、为谁作证，仍由他们自己回答。'),
 support(148,'plan/chapters/16','第一枚逐步消耗至空，第二枚未使用即折粮；没有新增收入，也不把余石按整枚重复花费。'),
 support(148,'plan/milestones/ms_v3_training','六个有效周期60日，加失败4日，实耗七枚'),
 support(148,'plan/milestones/ms_v3_advancement','六个有效周期完成→静置观察→白榆诊察→顾峤复核→十元载扣除'),
 support(149,'plan/chapters/18','只确认守门工作，不知道投毒过程。'),
 support(149,'plan/chapters/37','陆沉川不计入贺那5名被扣雇工。'),
 support(149,'plan/chapters/39','本箱24=12回收+6火毁+6售用'),
 support(150,'world/techniques/tech_15','开始布纹即永久燃耗百元载未耗寿储'),
 support(150,'world/techniques/tech_16','每式固定先燃三百元载未耗寿储，另付当境法力五成与神识三成。'),
];
assert.match(get(146).payload.problems,/缺少来源：plan\/chapters\/23/);assert.equal(get(146).raw.repairMode,'citation_edits');
assert.deepEqual(get(146).payload.originalRequest,get(145).request);
for(let n=18;n<=50;n++)assert.ok(get(144).request.sources.some(s=>s.origin?.sourceId===`plan/chapters/${n}`));
assert.ok(!get(144).request.sources.some(s=>s.origin?.sourceId==='world/locations/loc_21'));
const artifactScope=Object.fromEntries(['art_04','art_06','art_08'].map(id=>[id,get(145).request.sources.some(s=>s.origin?.sourceId===`world/artifacts/${id}`)]));assert.deepEqual(Object.values(artifactScope),[false,false,false]);
const synthesisParents=get(147).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id);assert.deepEqual(synthesisParents,['review-result/cross-1-3','review-result/cross-1-4']);
const synthesis5Parents=get(151).request.sources.filter(s=>s.id.startsWith('review-result/')).map(s=>s.id);
assert.deepEqual(synthesis5Parents,['review-result/cross-1-5','review-result/cross-2-3']);
const synthesis5Text=JSON.stringify(get(151).request.sources);
assert.ok(!synthesis5Text.includes('林确认严身份'));assert.ok(!synthesis5Text.includes('也不确认林贺曾进入棚内'));
for(const id of ['plan/chapters/18','world/techniques/tech_04','world/techniques/tech_06','story/characters/char_10'])assert.ok(get(152).request.sources.some(s=>s.origin?.sourceId===id));
assert.equal(12+6+6,24);
const techniqueScope=Object.fromEntries(['tech_15','tech_16','tech_19'].map(id=>{
 const sourceId=`world/techniques/${id}`;assert.ok(get(150).request.sources.some(s=>s.origin?.sourceId===sourceId));
 const source=JSON.parse(get(150).run.input.sources.find(s=>s.id===sourceId).text);return [id,{name:source.name,allowedRealmIds:source.allowedRealmIds}];
}));
assert.deepEqual(Object.values(techniqueScope).map(t=>t.allowedRealmIds),[['realm_07'],['realm_07','realm_08'],['realm_02']]);
const proof={kind:'design76_segment23_source_scope_crosscheck',verified:true,runnerSha256:sha(process.argv[1]),verificationPath,verificationSha256:sha(verificationPath),checkpointSha256:verification.checkpointSha256,
 calls:calls.map(c=>({number:c.number,requestPath:c.requestPath,requestSha256:c.requestSha256,responsePath:c.responsePath,responseSha256:c.responseSha256,stageId:c.stage.id,acceptedStageSha256:hash(c.stage)})),evidence,
 geographyScope:{call:144,detailedChapters18Through50Sent:true,loc21ActuallySent:false,limitation:'The loc_21 original was not sent in this request; no direct reread is claimed. The all-port wording again omits the independent Qingxuan return subplot; a separately bound clarification preserves both locations and knowledge boundaries.'},
 counterScope:{initialCall:145,repairCall:146,chapter23CitationRepaired:true,artifactScope,limitation:'The three known artifact defects remain outside this request. The blade/telekinesis conflation in the accepted explanation is independently clarified, not treated as a new half-cost blade ability.'},
 synthesisScope:{call:147,parents:synthesisParents,limitation:'Partial synthesis only; embedded quotations distinguish independent return, awaited signal and worker autonomy. No global character acceptance or closure of known message/identity defects.'},
 growthScope:{call:148,limitation:'Chapter16 stones have separate, exhausted uses. Later teaching and seven training stones are a different contract and proposed chain; future lifespan resources are not already acquired.'},
 historyScope:{call:149,limitation:'Chapter18 really does establish the father’s guard participation through signed records, but not the poisoning mechanism or culprit. Lu Chenchuan remains separate from the five workers; one box’s medicine accounting does not prove the whole transport network.'},
 techniqueScope,tiersScope:{call:150,limitation:'High-grade techniques retain their realm gates and irreversible costs. The accepted explanation incorrectly labels the failed stone as seventh; a separate clarification binds the actual third-stone failure and completion of later cycles before observation/advancement.'},
 synthesis5Scope:{call:151,parents:synthesis5Parents,limitation:'Partial synthesis. The stale entering-shed quotation and knowledge-boundary correction were embedded, but the contrary exterior-only quotation and bad identity endstate were absent. This cannot close the known message or identity defects.'},
 causalityScope:{call:152,requiredSourcesSent:true,limitation:'The four requested prerequisites were actually sent. Training, two-zhang range, blade and separate telekinesis costs, three-breath timing and injury limits support this local planned sequence, not a global acceptance or prose outcome.'},
 contentLimit:'Selected semantic checks only; local passes do not close blockers, approve global design or validate prose.',annotationsAdded:0,modelCalls:0,productionWrites:0,formalAcceptance:false};
const out='docs/audits/2026-10-18-design76-segment23-source-scope.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,calls:calls.length,sourceClaims:evidence.length,productionWrites:0}));
