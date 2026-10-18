// Replay the two rejected power answers without merging ambiguous duplicate judgments.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const control='data/audit-runtimes/design76-capacity-review';
const verificationPath='docs/audits/2026-10-18-design76-capacity-review-segment-11.json',verification=read(verificationPath);
assert.equal(sha(verification.checkpointPath),verification.checkpointSha256);
const state=read(verification.checkpointPath);assert.equal(state.status,'stopped_after_failure');assert.equal(state.totalCalls,71);
const bindingPath='data/audit-runtimes/design76-citation-capacity-runtime-bound.json',binding=read(bindingPath);
for(const[p,h]of Object.entries(binding.sourceHashes))assert.equal(sha(binding.runtimePath+'/'+p),h);
const {designReviewStageInput}=await import(binding.runtimePath+'/novel-service-core/src/design-review-run.ts');
const {prepareDesignReviewEvidence,applyDesignReviewCitationEdits}=await import(binding.runtimePath+'/packages/planner/src/design-review-evidence.ts');
const run=state.runs.find(r=>r.input.area==='power'),stage=run.stages.find(s=>s.id==='cross-3-4');assert.ok(!stage.result);
const paths=[70,71].flatMap(n=>['started','response'].map(kind=>`${control}/model-calls/${String(n).padStart(5,'0')}.${kind}.json`));
const request=JSON.parse(read(paths[0]).request.user),first=JSON.parse(read(paths[1]).response.text);
const repair=JSON.parse(read(paths[2]).request.user),patch=JSON.parse(read(paths[3]).response.text);
const prepared=prepareDesignReviewEvidence(designReviewStageInput(run,stage));
assert.equal(prepared.requestId,request.requestId);assert.deepEqual(prepared.sources,request.sources);assert.deepEqual(repair.originalRequest,request);
assert.throws(()=>prepared.resolve(first),/新增来源 plan\/chapters\/18/);
assert.throws(()=>applyDesignReviewCitationEdits(patch,first),/检查项缺失或重复/);
assert.deepEqual(patch.updates.map(u=>u.criterion),['counters','counters']);
assert.notEqual(patch.updates[0].explanation,patch.updates[1].explanation,'Distinct judgments must not be silently merged');
const proof={kind:'design76_duplicate_citation_edit_failure',verificationPath,verificationSha256:sha(verificationPath),checkpointSha256:verification.checkpointSha256,
 bindingPath,bindingSha256:sha(bindingPath),calls:paths.map(path=>({path,sha256:sha(path)})),stageId:stage.id,
 firstFailure:repair.problems,duplicateCriteria:patch.updates.map(u=>u.criterion),originalAndRepairRejected:true,
 nextAction:'明确同一criterion的多个问题必须在一个updates项中共同核对；保留重复检查拒绝校验，不自动合并两份不同判断。先隔离验证，再恢复正式评审。',
 modelCalls:0,productionWrites:0,formalAcceptance:false};
const out='docs/audits/2026-10-18-design76-duplicate-citation-failure.json';
if(process.argv.includes('--check'))assert.deepEqual(read(out),proof);else fs.writeFileSync(out,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,calls:[70,71],bothRejected:true,productionWrites:0}));
