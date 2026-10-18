// The isolated answer parsed, but demanded unwritten details before reading existing macro sources.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const control='data/audit-runtimes/design76-source-context-repair',state=read(control+'/result.json');
assert.equal(state.status,'completed');assert.equal(state.productionWrites,0);assert.equal(state.modelCalls,1);
const request=JSON.parse(read(control+'/request.json').user),response=JSON.parse(read(control+'/response.json').text),check=response.checks.find(c=>c.criterion==='payoff');
assert.equal(check.verdict,'insufficient');assert.equal(check.insufficiencyReason,'missing_design');assert.equal(check.awaitingSources,undefined);
assert.ok(check.explanation.includes('只有后续宏观提案'));assert.ok(check.revisionAdvice.includes('补充并核对51—53章的实际细纲'));
assert.equal(request.originalRequest.planningHorizon.detailedThroughChapter,50);
const macroRanges=request.originalRequest.stage.coverage.planRanges.filter(p=>p.startChapter<=51&&p.endChapter>=53);
assert.ok(macroRanges.some(p=>p.sourceId==='plan/milestones/ms_v2_fire'));
const proof={kind:'design76_source_context_isolated_semantic_gap',observedStatus:state.status,structurallyAccepted:true,semanticVerificationPassed:false,
 stateSha256:sha(control+'/result.json'),requestSha256:sha(control+'/request.json'),responseSha256:sha(control+'/response.json'),
 check,planningHorizon:request.originalRequest.planningHorizon,macroRanges,
 modelCalls:0,originalModelCalls:1,productionWrites:0,formalAcceptance:false,
 nextAction:'将已有且相关的分卷/里程碑候选直接列入修正导航。模型须按实际原文核对或请求补读，不能仅因未展开细纲改判缺设计；不自动补章节或改判。保留此次结构接收但语义未达标的隔离回答，不用于正式续审预检。'};
const out='docs/audits/2026-10-18-design76-source-context-semantic-gap.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verifiedGap:true,structurallyAccepted:true,semanticVerificationPassed:false,productionWrites:0}));
