// Correct the recipient of messages in a saved character-knowledge explanation.
// Bind to original sent evidence; never rewrite the review or character knowledge.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verificationPath='docs/audits/2026-10-18-design76-notes20-review-segment-21.json',verification=read(verificationPath);
assert.equal(verification.workerAbsent,true);assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const terminal=read(verification.checkpointPath);assert.equal(terminal.segment,21);
try{process.kill(terminal.pid,0);assert.fail('Worker still live');}catch(e){assert.equal(e.code,'ESRCH');}
const run=terminal.runs.find(r=>r.input.area==='characters'),stage=run.stages.find(s=>s.id==='followup-cross-4-5/knowledge');assert.ok(stage.result);
const bindingPath='data/audit-runtimes/design76-fragment-index-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {annotationSources,designReviewCheckHash}=await import(binding.runtimePath+'/novel-service-core/src/design-review-annotations.ts');
const {addDesignReviewAnnotationSchema}=await import(binding.runtimePath+'/packages/contracts/src/design-review.ts');
const requestPath='data/audit-runtimes/design76-notes20-review/model-calls/00129.started.json',responsePath='data/audit-runtimes/design76-notes20-review/model-calls/00129.response.json';
const request=JSON.parse(read(requestPath).request.user),raw=JSON.parse(read(responsePath).response.text);
assert.equal(raw.requestId,request.requestId);assert.deepEqual(stage.modelResponses,[read(responsePath).response.text]);
const check=stage.result.checks.find(c=>c.criterion==='knowledge');assert.equal(check.verdict,'pass');assert.ok(check.resolves.includes('cross-4-5/knowledge'));
const claimQuote='林辰在第50—52章只知道附棚现场行为，53章才通过程报形成受限认知，54章只确认回令送达，73章才收到程当面交来的封匣与自述';assert.ok(check.explanation.includes(claimQuote));
const evidence=[
 {sourceId:'story/arcBeats/message-first-read',quote:'第53章第262日。赵府收发房据程报一号签收、交赵亲阅。赵只信为程的利己自述，不鉴定匣内物，不知道陆53交页或291北境未来结果。'},
 {sourceId:'story/arcBeats/message-first-ack',quote:'第54章第273日。骑使带268程签收联经269–271海程及271–273陆驿回到乾都，当面交赵。赵只确认旧令已送达，不确认毁账是否执行；回执不能含291北境未来事件。林苏仍不知道此番交接。'},
 {sourceId:'story/arcBeats/message-north-report',quote:'第73章第318日。程301离葬骨、306极焱、310天宝、312–314海程到云梦、318乾都，当面交封匣原物并自述北境货损与有人获救。赵封存登记不启动；报述非全貌，林苏未在场。'},
 {sourceId:'story/secrets/sec_02',quote:'53章拟陆在巡员、贺见证下书写签认；原件由赤霄巡查保存，林当面核对并取得陆与见证者签认的副本。'},
 {sourceId:'plan/milestones/ms_v3_training',quote:'程往返交通食宿出自身商号经费，报述不让林苏同步知情；318赵府只封存第二片原物，不启用。'},
 {sourceId:'story/secrets/sec_02',quote:'95章苏保住实际交到护卫手里的命令并与林核看。'},
 {sourceId:'story/secrets/sec_02',quote:'质询材料没有证明十年前投毒全貌；林苏不因赵答询就同步读到他的回答。'},
];
const actualSupport=evidence.map(e=>{
 assert.ok(run.input.sources.find(s=>s.id===e.sourceId).text.includes(e.quote));
 const sent=request.sources.filter(s=>s.origin?.sourceId===e.sourceId).flatMap(s=>s.fragments.filter(f=>f.text.includes(e.quote)).map(f=>f.id));assert.equal(sent.length,1);return {...e,sent};
});
assert.deepEqual(actualSupport.map(e=>e.sent[0]),['e73','e76','e77','e102','e291','e103','e133']);
const annotationInput=addDesignReviewAnnotationSchema.parse({requestKey:'design76-character-report-recipient',runId:run.id,stageId:stage.id,criterion:'knowledge',expectedInputHash:run.input.inputHash,expectedCheckHash:designReviewCheckHash(check),claimQuote,
 explanation:'这句评语从“林辰”连续叙述到了本属赵玄极的消息，接收者混淆。第50—52章的现场见闻属于林辰；53章林辰拟取得的是陆沉舟新写自述的签认副本，不是程砚给赵的报告。同在53章，262日实际阅程第一报者是赵玄极；54章273日收回268签收联、只确认旧令送达者仍是赵，林苏不知道交接。73章318日由程面交封匣原物并报告北境货损、由赵府登记封存，林苏未在场，也未因此得到第二片或该报告。后续消息须继续逐人区分：95章苏收存原令后与林当面核看，99章赵收到质询、答询不使林苏同步读到其回答。原局部pass和原补读解决声明保留，本说明只纠正评语主语，不新增消息渠道、不提前角色知情、不更改持物或关闭已知消息链与身份时点问题。',evidence});
annotationSources({designReviewRuns:new Map([[run.id,run]])},annotationInput);
const proof={kind:'design76_character_report_recipient',verificationPath,verificationSha256:sha(verificationPath),bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),runId:run.id,stageId:stage.id,acceptedStageSha256:hash(stage),originalCheckHash:designReviewCheckHash(check),originalCheck:check,actualSupport,annotationInput,modelCalls:0,productionWrites:0,formalAcceptance:false,limitation:'Independent clarification draft; no annotation append, verdict change or design mutation.'};
const out='docs/audits/2026-10-18-design76-character-report-recipient.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,sourceQuotes:evidence.length,productionWrites:0}));
