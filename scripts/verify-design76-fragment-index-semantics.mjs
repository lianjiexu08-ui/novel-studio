// Inspect the actual citation change, without certifying unchanged global claims.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const control='data/audit-runtimes/design76-fragment-index-repair';
const proofPath='docs/audits/2026-10-18-design76-fragment-index-repair.json',proof=read(proofPath);
assert.equal(proof.verified,true);assert.equal(proof.productionWrites,0);assert.equal(proof.originalModelCalls,1);
for(const[name,key]of [['request','requestSha256'],['response','responseSha256'],['result','stateSha256']])assert.equal(sha(`${control}/${name}.json`),proof[key]);
const request=JSON.parse(read(control+'/request.json').user),before=JSON.parse(request.previousOutput),after=JSON.parse(read(control+'/response.json').text);
const fragments=new Map(request.originalRequest.sources.flatMap(s=>s.fragments.map(f=>[f.id,{...f,sourceId:s.origin?.sourceId??s.id}])));
assert.equal(after.requestId,before.requestId);assert.equal(after.summary,before.summary);assert.equal(after.checks.length,before.checks.length);
const changes=[];
for(let i=0;i<after.checks.length;i++){
 const {evidence:oldEvidence,...oldFields}=before.checks[i],{evidence:newEvidence,...newFields}=after.checks[i];
 assert.deepEqual(newFields,oldFields,'Do not silently narrow conclusions or alter resolutions');
 assert.ok(newEvidence.every(e=>fragments.has(e.fragmentId)));
 const oldValid=oldEvidence.filter(e=>fragments.has(e.fragmentId));
 assert.ok(oldValid.every(e=>newEvidence.some(n=>n.fragmentId===e.fragmentId)),'All previously valid selected evidence is retained');
 changes.push({criterion:after.checks[i].criterion,removed:oldEvidence.filter(e=>!newEvidence.some(n=>n.fragmentId===e.fragmentId)).map(e=>e.fragmentId),added:newEvidence.filter(e=>!oldEvidence.some(n=>n.fragmentId===e.fragmentId)).map(e=>e.fragmentId)});
}
assert.deepEqual(changes,[{criterion:'geography',removed:[],added:[]},{criterion:'history',removed:[],added:[]},{criterion:'capacity',removed:['e350','e351','e352'],added:['e235']}]);
const added=fragments.get('e235');assert.equal(added.sourceId,'plan/volumes/vol_01');
assert.ok(added.text.includes('取得有限泉液并付出分离代价南渡'));
assert.ok(added.text.includes('以玄府同阶力量和一次付费太乙真光压制墨'));
const selected=new Set(after.checks.find(c=>c.criterion==='capacity').evidence.map(e=>e.fragmentId));
const support=[['e73','终点复诊合格才一次入账八元载'],['e77','每八年一次'],['e83','外部患者至少神海且神识稳固'],['e241','百章阶段胜果不等于全书完成']].map(([id,text])=>{
 assert.ok(selected.has(id));const f=fragments.get(id);assert.ok(f.text.includes(text));return f;
});
const output={kind:'design76_fragment_index_citation_change_inspection',verified:true,isolatedProofSha256:sha(proofPath),changes,addedEvidence:added,retainedSupport:support,
 assessment:'新增e235含有限获取、同阶交锋、真实费用与分离代价，属于实质分卷设计，不是仅有标题或状态。原资源疗程、八年周期、境界准入及百章阶段边界引文保留。仅删除3个不存在的编号，没有凭空编号、删掉有效引用、改变解释或新增解除声明。',
 modelCalls:0,productionWrites:0,formalAcceptance:false,
 limitation:'Verifies the changed citation and retention of substantive support only. It does not certify every unchanged geography/history/capacity claim, every resource transport/control detail, whole-book capacity, or implementation in future prose. Formal review, prior deferrals and 41 blockers remain unchanged.'};
const out='docs/audits/2026-10-18-design76-fragment-index-semantics.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),output);else fs.writeFileSync(out,JSON.stringify(output,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,scope:'citation_change_only',productionWrites:0,formalAcceptance:false}));
