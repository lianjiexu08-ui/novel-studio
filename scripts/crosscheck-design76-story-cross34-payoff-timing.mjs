// Separate rescue, handover, completed treatments and later travel clearance.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-clarified-review-segment-16.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);
assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath),run=terminal.runs.find(r=>r.input.area==='story');
const stage=run.stages.find(s=>s.id==='cross-3-4');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const control='data/audit-runtimes/design76-clarified-review';
const requestPath=control+'/model-calls/00088.started.json',responsePath=control+'/model-calls/00088.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.equal(raw.requestId,request.requestId);assert.deepEqual(stage.modelResponses,[read(responsePath).response.text]);
const check=stage.result.checks.find(c=>c.criterion==='payoff');assert.equal(check.verdict,'pass');
const claimQuote='第26章完成实际解囚、交押、泉液来源核验、追回12滴并区分9滴洁净与3滴污染；林只获配6滴，且第27、29章分别完成两剂十日疗程和复诊后入账';
assert.ok(check.explanation.includes(claimQuote));
const evidence=[
  {sourceId:'plan/chapters/25',quote:'被掳者离开笼车，两名随顾到场的普通护卫协助撤人时一死一伤；林辰腿被落石割伤，仍护住已取走的样箱与封瓶。墨被顾同阶制伏并持续看守，尚未完成外营交押或泉液验证'},
  {sourceId:'plan/chapters/26',quote:'伤者队伍用75分钟，到12:00抵外营，由已休足的乔当面接墨，杜仍守入口。'},
  {sourceId:'plan/chapters/27',quote:'第199日复诊确认药程有效后，才将新增5元载记入可用寿储'},
  {sourceId:'plan/chapters/28',quote:'第209日，第二剂完整完成并复诊有效，新增5元载，六滴全部用尽。'},
  {sourceId:'plan/chapters/29',quote:'第210日白榆复诊，允许林辰短距步行、坐车旅行和轻物点数，禁止搬药箱、疾跑与持剑久战。灵泉两剂均已生效，腿伤仍未痊愈。'},
];
const actualSupport=evidence.map(e=>{
  assert.ok(run.input.sources.find(s=>s.id===e.sourceId).text.includes(e.quote));
  const sent=request.sources.filter(s=>s.origin?.sourceId===e.sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>f.id));
  assert.equal(sent.length,1);return {...e,sent};
});
const annotationInput=addDesignReviewAnnotationSchema.parse({
  requestKey:'design76-story-cross34-payoff-timing',runId:run.id,stageId:stage.id,criterion:'payoff',
  expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
  explanation:'本项对救援和疗程的章号定位不准确。第25章已使被掳者离开笼车并取得样箱、封瓶；第26章承接188日撤离、12:00外营交押及189日来源、洁净度和分配核验，不是到26章才解囚。第一剂在27章190—199日完成，199日复诊后入账5元载；第二剂在28章200—209日完成，209日复诊后再入账5元载。29章210日的复诊确认两剂均已生效，决定有限旅行许可与分路，不是第二剂完成或再次入账。保留原局部pass和解除声明，不将本说明冒充重新评审；不得为适配错误章号搬动既有事件、重复服药或重复增加寿储。',evidence,
});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design76_story_cross34_payoff_timing',verificationPath,verificationSha256:sha(verificationPath),
  bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),
  runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,
  actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,
  limitation:'Independent clarification draft only. Original verdict and resolution claims are preserved; no annotation is appended by this script.'};
const out='docs/audits/2026-10-18-design76-story-cross34-payoff-timing.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);
else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,sources:actualSupport.length,productionWrites:0}));
