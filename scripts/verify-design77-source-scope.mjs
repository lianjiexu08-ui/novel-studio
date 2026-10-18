// Local passes validate the repairs, not every sentence of the model response.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = p => JSON.parse(fs.readFileSync(p));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const reviewPath = 'docs/audits/2026-10-18-design76-followup-v7-targeted-review.json', review = read(reviewPath);
assert.equal(sha(review.statePath), review.stateSha256);
const requestPath = 'data/audit-runtimes/design76-followup-v7-targeted/model-calls/00002.started.json';
const request = JSON.parse(read(requestPath).request.user);
const source = request.sources.find(s => s.id === 'plan/milestones/ms_v3_convoy');
const quote = '88章431赵阅祁429具名接押报告';
const fragment = source.fragments.find(f => f.text.includes(quote)); assert.ok(fragment);
const claim = '433日赵读取429日祁的具名报告并发撤押令';
const check = review.results.find(r => r.area === 'world').result.checks.find(c => c.criterion === 'history');
assert.ok(check.explanation.includes(claim)); assert.equal(check.verdict,'pass');
const correction = { requestPath, requestSha256:sha(requestPath), sourceId:source.id, fragmentId:fragment.id, quote,
  originalClaim:claim, correction:'429签接押报告、431赵实际阅报、433签发撤押令、435骑使送达，不能把阅报并到433。此为评语日期压缩错误，候选原文已正确，无需改设计；原pass和原答保留。' };
const candidatePath = 'data/design-candidates/design76-followup-controls-v7.json';
const candidate = read(candidatePath);
assert.ok(candidate.plan.milestones.find(m=>m.id==='ms_v3_convoy').setup.some(s=>s.includes(quote)));
const result = { verified:true,reviewPath,reviewSha256:sha(reviewPath),candidatePath,candidateFileSha256:sha(candidatePath),correction,
  formalAcceptance:false,productionWrites:0,modelCalls:0,
  boundary:'This detached review establishes local repair evidence only. Its pass is not an assertion that every explanatory date, the entire 100-chapter design, or any prose has been accepted.' };
fs.writeFileSync('docs/audits/2026-10-18-design77-review-source-scope.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:true,originalVerdictPreserved:true,sourceDates:[429,431,433,435],productionWrites:0}));
