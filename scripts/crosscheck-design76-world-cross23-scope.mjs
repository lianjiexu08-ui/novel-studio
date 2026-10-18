// Check what the reviewer actually read. This is source/capacity accounting,
// not a semantic approval and not a replacement for the requested follow-ups.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const control='data/audit-runtimes/design76-capacity-review';
const bindingPath='data/audit-runtimes/design76-citation-capacity-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(`${binding.runtimePath}/${p}`),h);
const {designReviewStageInput,designReviewCapacity}=await import(binding.runtimePath+'/novel-service-core/src/design-review-run.ts');
const {prepareDesignReviewEvidence}=await import(binding.runtimePath+'/packages/planner/src/design-review-evidence.ts');
const checkpointPath='data/audit-runtimes/design76-capacity-review/terminal-segment-10.json';
const verificationPath='docs/audits/2026-10-18-design76-capacity-review-segment-10.json',verification=read(verificationPath);
assert.equal(sha(checkpointPath),verification.checkpointSha256);
const state=read(checkpointPath),run=state.runs.find(r=>r.input.area==='world'),stage=run.stages.find(s=>s.id==='cross-2-3');
assert.equal(stage.result,undefined);
const input=designReviewStageInput(run,stage),prepared=prepareDesignReviewEvidence(input);
const requestPath=control+'/model-calls/00065.started.json',responsePath=control+'/model-calls/00065.response.json';
const request=JSON.parse(read(requestPath).request.user),answer=JSON.parse(read(responsePath).response.text);
assert.deepEqual(request.sources,prepared.sources);assert.equal(request.requestId,prepared.requestId);
const result=prepared.resolve(answer);
const sources=new Map(run.input.sources.map(s=>[s.id,s]));
const coverage=id=>{
 const source=sources.get(id);assert.ok(source);
 const ranges=input.stage.sourceMap.filter(u=>u.sourceId===id).map(u=>({start:u.start,end:u.end})).sort((a,b)=>a.start-b.start);
 let end=0;for(const r of ranges){if(r.start>end)break;end=Math.max(end,r.end);}
 return {sourceId:id,sourceCharacters:source.text.length,readRanges:ranges,fullyRead:end>=source.text.length};
};
const findings=result.checks.filter(c=>c.awaitingSources?.length).map(check=>{
 const requested=check.awaitingSources.map(coverage);assert.ok(requested.every(s=>!s.fullyRead));
 const required=check.awaitingSources.map(id=>sources.get(id));
 const envelopeCharacters=JSON.stringify(required).length;
 return {criterion:check.criterion,verdict:check.verdict,requestedSources:requested.length,
   requestedChapterNumbers:check.awaitingSources.filter(id=>id.startsWith('plan/chapters/')).map(id=>Number(id.split('/').at(-1))),
   requestedEnvelopeCharacters:envelopeCharacters,inputLimit:designReviewCapacity,requestedSourcesAloneFit:envelopeCharacters<=designReviewCapacity,sourceCoverage:requested,
   limitation:'Only requested-source envelope size. Original question, original sources, optional context and metadata still require the normal scheduler budget check; no follow-up is accepted here.'};
});
assert.deepEqual(findings.map(f=>[f.criterion,f.verdict,f.requestedSources,f.requestedEnvelopeCharacters]),[['geography','insufficient',53,94749],['history','insufficient',57,122570]]);
assert.equal(result.checks.find(c=>c.criterion==='capacity').verdict,'pass');
const proof={kind:'world_cross23_unread_source_scope',verified:true,verificationPath,verificationSha256:sha(verificationPath),checkpointPath,checkpointSha256:sha(checkpointPath),
 bindingPath,bindingSha256:sha(bindingPath),requestPath,requestSha256:sha(requestPath),responsePath,responseSha256:sha(responsePath),requestId:prepared.requestId,
 findings,conclusion:'Both deferrals name existing sources that were not completely supplied in this request. Do not rewrite existing design merely because these local checks are insufficient. Capacity pass remains local and does not settle geography/history or whole-book acceptance.',
 modelCalls:0,productionWrites:0,formalAcceptance:false};
const out='docs/audits/2026-10-18-design76-world-cross23-scope.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,findings:findings.map(({criterion,requestedSources,requestedEnvelopeCharacters})=>({criterion,requestedSources,requestedEnvelopeCharacters})),modelCalls:0,productionWrites:0}));
