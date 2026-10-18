// Separate the local proxy’s conditional commercial actions from the distant principal’s knowledge.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-notes23-review-segment-24.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath);assert.equal(terminal.segment,24);
try{process.kill(terminal.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const run=terminal.runs.find(r=>r.input.area==='world'),stage=run.stages.find(s=>s.id==='followup-cross-2-5/history');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const base='data/audit-runtimes/design76-notes23-review/model-calls/';
const requestPath=base+'00153.started.json',responsePath=base+'00153.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.equal(raw.requestId,request.requestId);assert.deepEqual(stage.modelResponses,[read(responsePath).response.text]);
const check=stage.result.checks.find(c=>c.criterion==='history');assert.equal(check.verdict,'pass');assert.ok(check.resolves.includes('cross-2-5/history'));
const claimQuote='炎煞真身须实际获报才能扣货或拒新增仓位';assert.ok(check.explanation.includes(claimQuote));
const evidence=[
  {
    "sourceId": "world/historicalEvents/event_14",
    "quote": "炎煞外围代理若实际收到货损或查验通知，可扣留尚未交付的自家货、拒绝新增仓位或要求先清欠款"
  },
  {
    "sourceId": "world/historicalEvents/event_14",
    "quote": "炎煞真身在实际获报前不会自动知港火、北境失货或赵单方重整。"
  },
  {
    "sourceId": "world/historicalEvents/event_14",
    "quote": "旧约不允许他跨越地理、封港和消息时限即时调人救程，也未在百章中预写双方达成新协议。"
  },
  {
    "sourceId": "story/relationships/rel_06",
    "quote": "53章第一报和回令均由程与赵府经手；没有给炎煞真身的送达或阅览节点。"
  },
  {
    "sourceId": "world/historicalEvents/event_14",
    "quote": "他不控制天宝港务、万象商盟或全部船舶，不能保证免检、免税、封港或压掉他人报案。"
  }
];
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===e.sourceId).text.includes(e.quote));
 const sent=request.sources.filter(s=>s.origin?.sourceId===e.sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>f.id));assert.equal(sent.length,1);return {...e,sent};
});
assert.deepEqual(actualSupport.map(e=>e.sent[0]),["e94", "e94", "e94", "e215", "e93"]);
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-world-proxy-authority',runId:run.id,stageId:stage.id,criterion:'history',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
 explanation:"原文分别规定两个主体：外围代理在实际收到货损或查验通知后，只能扣留尚未交付的自家货、拒绝新增自家仓位或要求先清欠款；炎煞真身则在实际获报前不知港火、北境失货或赵单方重整。这句评语把代理的条件性商业措施与炎煞真身的消息边界合到了同一主语下，不能据此改成必须先报到真身代理才可行动，也不能推出真身已经接报、亲自扣货或获得港务调度权。53章程—赵第一报和回令没有送达炎煞真身的节点；旧约不允许即时调人救程，也不赋予免检、封港或压案权限。本说明保留原局部pass及cross-2-5/history补读解决声明，只分清执行主体、可处置对象与各自获报条件，不新增命令或通信节点，不将作者前史变成角色即时全知或全局设计验收。",evidence});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design76_world_proxy_authority',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Independent clarification draft; does not append an annotation, change a verdict or mutate the design.'};
const out='docs/audits/2026-10-18-design76-world-proxy-authority.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,sourceQuotes:evidence.length,productionWrites:0}));
