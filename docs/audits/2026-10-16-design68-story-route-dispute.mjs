// Preserve a synthesis-only route misattribution without changing the review.
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
const { designReviewStageInput } = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const records = [];
for (const id of ['followup-cross-2-3/timeline', 'synthesis-14']) {
  const stage = run.stages.find(stage => stage.id === id);
  assert.ok(stage?.result);
  const request = designReviewStageInput(run, stage);
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
assert.equal(records[1].originalCheck.verdict, 'pass');
assert.ok(records[1].originalCheck.explanation.includes('林苏的返宗慢车路线'));
assert.ok(!records[0].originalCheck.explanation.includes('林苏的返宗慢车路线'));
const evidence = ['plan/chapters/29', 'plan/chapters/30'].map(id => {
  const source = run.input.sources.find(source => source.id === id);
  const { summary } = JSON.parse(source.text);
  return { sourceId: id, sourceSha256: sha(source.text), field: 'summary', quote: summary };
});
assert.ok(evidence[0].quote.includes('213–216日返外门是苏随押解队的慢车行程，林辰不随该队回宗'));
assert.ok(evidence[1].quote.includes('第212日至213日，林辰随六箱药材离开古境入口外营'));
const parentPath = ['synthesis-14'];
for (;;) {
  const parent = run.stages.find(stage => stage.children.includes(parentPath.at(-1)));
  if (!parent) break;
  parentPath.push(parent.id);
}
const snapshotPath = `${root}/story-route-dispute.json`;
const proof = {
  kind: 'design68_story_synthesis_route_dispute', observedAt: checkpoint.updatedAt,
  inputHash: baseline.inputHash, runId: run.id, snapshotPath, snapshotSha256: sha(bytes),
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  records, responsesReplayed: records.reduce((n, record) => n + record.responsesReplayed, 0),
  disputes: [{ id: 'lin_su_return_route', stageId: 'synthesis-14', criterion: 'timeline', parentPath,
    correction: '苏随押解队于213—216日慢车返宗；林辰不回宗，212—213日护货赴港、214日暮出航。综合报告的“林苏返宗”误把林辰加入另一条路线，不能据此修改原章纲或宣称原设计一人两地。', evidence }],
  modelCalls: 0, productionWrites: 0, originalVerdictsChanged: false, designApproved: false,
  limitation: 'The phrase is a synthesis explanation error against explicit primary sources. It does not invalidate the original source-deferral resolution or prove a design conflict. Preserve the response and trace its actual parents to the final report; omission is not explicit retraction.',
};
fs.writeFileSync(snapshotPath, bytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-story-route-dispute.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ responsesReplayed: proof.responsesReplayed, parentPath, modelCalls: 0, productionWrites: 0 }));
