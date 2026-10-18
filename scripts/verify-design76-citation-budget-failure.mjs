// Reproduce the real citation-repair capacity failure without changing or
// retrying the model answer. Both answers remain rejected and preserved.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read = p => JSON.parse(fs.readFileSync(p));
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const control = 'data/audit-runtimes/design76-coalesced-review';
const verificationPath = 'docs/audits/2026-10-18-design76-coalesced-review-segment-9.json', verified = read(verificationPath);
const checkpoint = read(verified.checkpointPath);
assert.equal(fileHash(verified.checkpointPath), verified.checkpointSha256);
assert.equal(checkpoint.status, 'stopped_after_failure'); assert.equal(checkpoint.totalCalls, 62);
const bindingPath = 'data/audit-runtimes/design76-coalesced-api-runtime-bound.json', binding = read(bindingPath);
for (const [p,h] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(`${binding.runtimePath}/${p}`), h);
const {designReviewStageInput} = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const {designReviewReportEnvelopeSize} = await import(`${binding.runtimePath}/novel-service-core/src/design-review-report.ts`);
const {designReviewResultSchema} = await import(`${binding.runtimePath}/packages/contracts/src/index.ts`);
const {prepareDesignReviewEvidence, applyDesignReviewCitationEdits} = await import(`${binding.runtimePath}/packages/planner/src/design-review-evidence.ts`);
const run = checkpoint.runs.find(r=>r.input.area==='world'), stage = run.stages.find(s=>s.id==='cross-1-7');
assert.ok(!stage.result);
const input = designReviewStageInput(run, stage), prepared = prepareDesignReviewEvidence(input);
const paths = [61,62].flatMap(n=>['started','response'].map(kind=>`${control}/model-calls/${String(n).padStart(5,'0')}.${kind}.json`));
const first = JSON.parse(read(paths[1]).response.text), edits = JSON.parse(read(paths[3]).response.text);
const request = JSON.parse(read(paths[0]).request.user), repair = JSON.parse(read(paths[2]).request.user);
assert.equal(prepared.requestId, request.requestId); assert.deepEqual(prepared.sources, request.sources);
assert.deepEqual(repair.originalRequest, request);
assert.match(repair.problems, /ms_v2_boundary/);
assert.ok(!repair.problems.includes('90000'), 'The first repair was not given a measured capacity error');
const reconstructed = applyDesignReviewCitationEdits(edits, first);
assert.throws(()=>prepared.resolve(first), /ms_v2_boundary/);
assert.throws(()=>prepared.resolve(reconstructed), /91471 字符，上限 90000/);
const lookup = new Map(prepared.sources.flatMap(s=>s.fragments.map(f=>[f.id,{sourceId:s.id,quote:f.text}])));
const expand = value => designReviewResultSchema.parse({...value,checks:value.checks.map(c=>({...c,evidence:c.evidence.map(e=>lookup.get(e.fragmentId))}))});
const budget = input.stage.reportBudget;
const sizes = [first,reconstructed].map(v=>designReviewReportEnvelopeSize(input,expand(v),budget.sourceId));
assert.ok(sizes[0] <= budget.maxCharacters); assert.equal(sizes[1],91471);
const counts = value => value.checks.map(c=>({criterion:c.criterion,citations:c.evidence.length,resolves:c.resolves??[]}));
const proof = {kind:'reproduced_citation_repair_capacity_failure',verificationPath,verificationSha256:fileHash(verificationPath),
  checkpointSha256:verified.checkpointSha256,runtimeBindingPath:bindingPath,runtimeBindingSha256:fileHash(bindingPath),
  calls:paths.map(path=>({path,sha256:fileHash(path)})),requestId:prepared.requestId,stageId:stage.id,
  maxCharacters:budget.maxCharacters,firstExpandedCharacters:sizes[0],firstRemainingCharacters:budget.maxCharacters-sizes[0],
  repairedExpandedCharacters:sizes[1],overBudgetCharacters:sizes[1]-budget.maxCharacters,
  originalCounts:counts(first),repairedCounts:counts(reconstructed),
  addedEvidence:edits.updates.flatMap(u=>u.addEvidence.map(e=>({criterion:u.criterion,fragmentId:e.fragmentId,quoteCharacters:lookup.get(e.fragmentId).quote.length}))),
  firstFailure:repair.problems,originalAndRepairRejected:true,acceptedStepsAdded:0,
  nextAction:'为引文修正提供当前完整报告大小、剩余容量及片段展开开销，要求模型明确选择必要新增/删除引用；保留必要来源、判定、全部原文和90,000上限。先用这对真实回答离线回归，再做有界隔离修正，不能直接重试正式运行。',
  modelCalls:0,productionWrites:0,formalAcceptance:false};
const output='docs/audits/2026-10-18-design76-citation-budget-failure.json';
if(process.argv.includes('--check'))assert.deepEqual(read(output),proof);
else fs.writeFileSync(output,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,firstSize:sizes[0],repairedSize:sizes[1],limit:budget.maxCharacters,modelCalls:0,productionWrites:0}));
