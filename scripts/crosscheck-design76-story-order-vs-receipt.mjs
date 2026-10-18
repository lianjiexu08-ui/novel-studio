// Distinguish an outgoing order from the receipt returned to its sender.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-notes20-review-segment-21.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath);assert.equal(terminal.segment,21);
try{process.kill(terminal.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const run=terminal.runs.find(r=>r.input.area==='story'),stage=run.stages.find(s=>s.id==='followup-batch-2/payoff');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const requestPath='data/audit-runtimes/design76-notes20-review/model-calls/00134.started.json',responsePath='data/audit-runtimes/design76-notes20-review/model-calls/00134.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.equal(raw.requestId,request.requestId);assert.deepEqual(stage.modelResponses,[read(responsePath).response.text]);
const check=stage.result.checks.find(c=>c.criterion==='payoff');assert.equal(check.verdict,'pass');assert.ok(check.resolves.includes('batch-2/payoff'));
const claimQuote='赵玄极收到的是程砚转述和后续实体回令';assert.ok(check.explanation.includes(claimQuote));
const evidence=[
 {sourceId:'story/arcBeats/message-first-read',quote:'第53章第262日。赵府收发房据程报一号签收、交赵亲阅。赵只信为程的利己自述'},
 {sourceId:'story/arcBeats/message-first-order',quote:'第53章第263日。赵签赵回一号，令程保封存物、毁自己手中直指军需的散账，不擅启封'},
 {sourceId:'story/arcBeats/message-first-delivery',quote:'第53章第268日。骑使在程本人停留的天宝落脚处交赵回一号，程留原令，骑使收268具名签收联'},
 {sourceId:'story/arcBeats/message-first-ack',quote:'第54章第273日。骑使带268程签收联经269–271海程及271–273陆驿回到乾都，当面交赵。赵只确认旧令已送达，不确认毁账是否执行'},
 {sourceId:'plan/milestones/ms_v2_fire',quote:'回令原件归程；骑使只带程268日签收联，于269日启程、271日云梦转陆驿、273日交赵，签收联只证送达，不证执行。'},
];
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===e.sourceId).text.includes(e.quote));
 const sent=request.sources.filter(s=>s.origin?.sourceId===e.sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>f.id));assert.equal(sent.length,1);return {...e,sent};
});
assert.deepEqual(actualSupport.map(e=>e.sent[0]),['e253','e254','e255','e256','e363']);
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-story-order-vs-receipt',runId:run.id,stageId:stage.id,criterion:'payoff',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
 explanation:'赵收到的是程报及后来返回的签收回执，不是“后续实体回令”。262日赵实际阅程报；263日赵本人签发赵回一号，268日骑使当面交程验封签收，原令留程。骑使只带程268日具名签收联，经269—271海程和271—273陆驿，于273日交赵。签收联只能证明回令送达，不能证明毁账执行，也不能包含291日北境未来事件；林苏没有因此同步知情。回令和回执是不同实物、方向及生效节点，不能因统称“收到”而倒置发令人、收令人或文件保管。原兑现局部pass和补读解决声明保留，本说明不新增文书、不改邮程或角色知情，也不证明整条消息链的其他已知问题已修复。',evidence});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design76_story_order_vs_receipt',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Independent clarification draft; no annotation append, verdict change or design mutation.'};
const out='docs/audits/2026-10-18-design76-story-order-vs-receipt.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,orderRecipient:'程砚',receiptRecipient:'赵玄极',productionWrites:0}));
