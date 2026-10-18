// Bind the patrol rescue's actual day to the saved timeline explanation.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-notes20-review-segment-21.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath);assert.equal(terminal.segment,21);
try{process.kill(terminal.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const run=terminal.runs.find(r=>r.input.area==='story'),stage=run.stages.find(s=>s.id==='followup-batch-2/timeline');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const requestPath='data/audit-runtimes/design76-notes20-review/model-calls/00130.started.json',responsePath='data/audit-runtimes/design76-notes20-review/model-calls/00130.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.equal(raw.requestId,request.requestId);assert.deepEqual(stage.modelResponses,[read(responsePath).response.text]);
const check=stage.result.checks.find(c=>c.criterion==='timeline');assert.equal(check.verdict,'pass');assert.ok(check.resolves.includes('batch-2/timeline'));
const claimQuote='第43—45章承接244日戌初报警、切索、接板与次日巡艇分趟接人';assert.ok(check.explanation.includes(claimQuote));
const evidence=[
 {sourceId:'plan/chapters/44',quote:'第244日戌初至入夜；承接43章已报警登船和钩索拖偏，直接从切索开始'},
 {sourceId:'plan/chapters/45',quote:'244夜巡艇分趟接人，贺最后离开自己的裂底船。'},
 {sourceId:'plan/chapters/45',quote:'第244日入夜的接应至第247日暮'},
 {sourceId:'plan/chapters/45',quote:'巡艇在244夜接到岸钟报信后绕外弯赶来，大艇吃水不能上滩，巡员用随艇小划舟靠近并分趟接人。'},
 {sourceId:'plan/chapters/45',quote:'245晨医棚分诊：三工脱水擦伤，落水伙计呛水'},
];
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===e.sourceId).text.includes(e.quote));
 const sent=request.sources.filter(s=>s.origin?.sourceId===e.sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>f.id));assert.equal(sent.length,1);return {...e,sent};
});
assert.deepEqual(actualSupport.map(e=>e.sent[0]),['e393','e397','e399','e399','e399']);
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-story-patrol-rescue-day',runId:run.id,stageId:stage.id,criterion:'timeline',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
 explanation:'“次日巡艇分趟接人”应为当晚244日入夜的接应。第43—44章是244日戌初报警、切索及过板；第45章开场继续同一夜，巡艇绕外弯到场，巡员用小划舟分趟接人，贺最后离开裂底船。245日清晨才是医棚分诊、清点名单和工人交夹，不能把医疗次日误当成救援次日，也不能在章节交界额外插入一夜等待。原时间线局部pass与补读解决声明保留，本说明只纠正评语相对日期，不移动真实章纲事件、不重复接救、不据此批准后续正文。',evidence});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design76_story_patrol_rescue_day',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Independent clarification draft; no annotation append, verdict change or design mutation.'};
const out='docs/audits/2026-10-18-design76-story-patrol-rescue-day.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,rescueDay:244,medicalMorning:245,productionWrites:0}));
