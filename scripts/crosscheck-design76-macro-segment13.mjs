// Independent narrow source checks; does not accept formal reviews or change design.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const root='data/audit-runtimes/design76-macro-review/model-calls';
const evidence=[];
for(const number of [77,78]){
 const base=`${root}/${String(number).padStart(5,'0')}`,request=read(base+'.started.json'),response=read(base+'.response.json');
 const input=JSON.parse(request.request.user),answer=JSON.parse(response.response.text);
 const waiting=answer.checks.filter(c=>c.awaitingSources).map(c=>({criterion:c.criterion,sources:c.awaitingSources.map(id=>{
  const length=input.stage.coverage.sourceLengths[id];assert.ok(length>0);
  const sent=input.sources.filter(s=>s.origin?.sourceId===id).map(s=>s.origin);assert.equal(sent.length,0);
  return {sourceId:id,length,sentRanges:sent};
 })}));
 assert.ok(waiting.length>0);
 evidence.push({callNumber:number,requestSha256:sha(base+'.started.json'),responseSha256:sha(base+'.response.json'),waiting});
 if(number===78){
  const f=input.sources.find(s=>s.origin?.sourceId==='plan/chapters/44').fragments.find(f=>f.id==='e378');assert.ok(f);
  assert.ok(f.text.includes('保守余量五成，一式二成后余三成'));
  assert.ok(f.text.includes('送钩伙计承接43章四成半真元，44章没有再施术'));
  const cost=answer.checks.find(c=>c.criterion==='costs');assert.ok(cost.evidence.some(e=>e.fragmentId==='e378'));
  assert.ok(cost.revisionAdvice.includes('五成→三成'));
  evidence.at(-1).localAccountCheck={sourceId:'plan/chapters/44',fragmentId:f.id,quote:f.text,calculation:{start:5,cost:2,end:5-2},
   assessment:'第44章林辰5−2=3与实际引文一致；送钩伙计4.5是另一账户。这里只核第44章局部账，不证明239日至244日前置收支；第40—43章补读保留。'};
 }
}
const proof={kind:'design76_segment13_targeted_crosscheck',verified:true,evidence,modelCalls:0,productionWrites:0,formalAcceptance:false,
 limitation:'Only verifies that requested sources exist and were not sent in calls77/78, plus chapter44 local arithmetic and account separation. It does not certify all explanations, design quality, completed persistence or the terminal segment.'};
const out='docs/audits/2026-10-18-design76-macro-segment13-crosscheck.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,calls:[77,78],productionWrites:0,formalAcceptance:false}));
