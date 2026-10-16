// Verify a false claim that the delivered synthesis request had no resolution.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => JSON.parse(fs.readFileSync(path));
const root = 'data/audit-runtimes/design68-review';
const baseline = read(`${root}/baseline.json`);
const binding = read('data/audit-runtimes/design68-runtime-bound.json');
const inputBytes = fs.readFileSync(`${root}/inputs.json`);
assert.equal(sha(inputBytes), baseline.inputsSha256);
for (const [path, expected] of Object.entries(binding.sourceHashes))
  assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
const bytes = fs.readFileSync(`${root}/result.json`), checkpoint = JSON.parse(bytes);
assert.equal(checkpoint.inputHash, baseline.inputHash);
const run = checkpoint.runs.find(run => run.input.area === 'story');
assert.deepEqual(run.input, JSON.parse(inputBytes).story);
const { designReviewStageInput, validateDesignReview } = {
  ...await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`),
  ...await import(`${binding.runtimePath}/novel-service-core/src/design-review.ts`),
};
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const records = [];
for (const id of ['cross-4-5', 'followup-cross-3-5/timeline', 'synthesis-22']) {
  const stage = run.stages.find(stage => stage.id === id);
  const request = designReviewStageInput(run, stage);
  validateDesignReview(request, stage.result);
  let calls = 0;
  const planner = new JsonDesignPlanner({ complete: async () => {
    assert.ok(calls < stage.modelResponses.length);
    return stage.modelResponses[calls++];
  } });
  const { modelResponses, ...result } = await planner.reviewDesignContent(request);
  assert.equal(calls, stage.modelResponses.length);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), stage.result);
  assert.deepEqual(modelResponses, stage.modelResponses);
  const { evidence, ...check } = stage.result.checks.find(check => check.criterion === 'timeline');
  records.push({ stageId: id, stageSha256: sha(JSON.stringify(stage)), requestSha256: sha(JSON.stringify(request)),
    originalCheck: check, evidenceSha256: sha(JSON.stringify(evidence)), evidenceCount: evidence.length,
    responsesReplayed: calls });
}
const stage = run.stages.find(stage => stage.id === 'synthesis-22');
const request = designReviewStageInput(run, stage);
const resolutions = request.stage.coverage.resolvedDeferrals;
assert.equal(resolutions.length, 23);
for (const [checkId, resolvedByStageId] of [
  ['batch-5/timeline', 'cross-4-5'],
  ['cross-3-5/timeline', 'followup-cross-3-5/timeline'],
]) assert.ok(resolutions.some(item => item.checkId === checkId && item.resolvedByStageId === resolvedByStageId));
assert.equal(records[2].originalCheck.verdict, 'insufficient');
assert.ok(records[2].originalCheck.explanation.includes('本次综合没有对应的 resolvedDeferrals 记录'));
assert.ok(records[0].originalCheck.resolves.includes('batch-5/timeline'));
assert.ok(records[1].originalCheck.resolves.includes('cross-3-5/timeline'));
const childTimelineChecks = stage.children.map(id => {
  const child = run.stages.find(child => child.id === id);
  const { evidence, ...check } = child.result.checks.find(check => check.criterion === 'timeline');
  assert.equal(check.verdict, 'pass');
  return { stageId: id, check, evidenceSha256: sha(JSON.stringify(evidence)) };
});
const parentPath = [stage.id];
for (;;) {
  const parent = run.stages.find(stage => stage.children.includes(parentPath.at(-1)));
  if (!parent) break;
  parentPath.push(parent.id);
}
const snapshotPath = `${root}/story-resolution-dispute.json`;
const proof = {
  kind: 'design68_story_false_unresolved_deferral_claim', observedAt: checkpoint.updatedAt,
  inputHash: baseline.inputHash, runId: run.id, snapshotPath, snapshotSha256: sha(bytes),
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  records, responsesReplayed: records.reduce((n, record) => n + record.responsesReplayed, 0),
  deliveredResolvedDeferrals: resolutions, childTimelineChecks,
  disputes: [{ id: 'resolved_timeline_reopened', stageId: stage.id, criterion: 'timeline', parentPath,
    correction: '综合22的实际请求已携带全部23项有效解决记录；其引用的batch-5/timeline由cross-4-5解决，同类cross-3-5/timeline也已由定向补读解决。两个直接子报告时间判断均通过。报告声称没有resolvedDeferrals，与实际请求不符，不能据此修改正确章纲或重复关闭同一问题。' }],
  modelCalls: 0, productionWrites: 0, originalVerdictsChanged: false, designApproved: false,
  limitation: 'This verifies the delivered validated resolution metadata and preserves the new formal insufficient judgment. It does not silently downgrade that judgment or guarantee a later synthesis will retract it; trace the actual final aggregation separately.',
};
fs.writeFileSync(snapshotPath, bytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-story-resolution-dispute.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ responsesReplayed: proof.responsesReplayed, deliveredResolutions: resolutions.length, parentPath, modelCalls: 0, productionWrites: 0 }));
