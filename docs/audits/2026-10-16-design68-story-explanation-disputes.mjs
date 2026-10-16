// Preserve explanation errors without editing original verdicts or correct plans.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
const read = path => JSON.parse(fs.readFileSync(path));
const root = 'data/audit-runtimes/design68-review';
const binding = read('data/audit-runtimes/design68-runtime-bound.json');
const baseline = read(`${root}/baseline.json`);
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
const source = id => {
  const item = run.input.sources.find(source => source.id === id);
  assert.ok(item, id);
  return { sourceId: id, sha256: sha(item.text), value: JSON.parse(item.text) };
};
const excerpt = (id, field, fragment) => {
  const item = source(id), value = item.value[field];
  const matches = (Array.isArray(value) ? value : [value]).filter(text => typeof text === 'string' && text.includes(fragment));
  assert.equal(matches.length, 1, `${id}/${field}: ${fragment}`);
  return { sourceId: id, sourceSha256: item.sha256, field, quote: matches[0] };
};
const originalPayoff = run.stages.find(stage => stage.id === 'batch-1').result.checks.find(check => check.criterion === 'payoff');
assert.deepEqual(originalPayoff.awaitingSources, Array.from({ length: 50 }, (_, i) => `plan/chapters/${i + 1}`));
const originalRequest = designReviewStageInput(run, run.stages.find(stage => stage.id === 'batch-1'));
const overviewText = originalRequest.stage.sourceMap.filter(unit => unit.sourceId === 'story/overview')
  .map(unit => originalRequest.sources.find(source => source.id === unit.id).text).join('');
assert.equal(overviewText, run.input.sources.find(source => source.id === 'story/overview').text);
const disputes = [
  { id: 'growth_goal_chapter', stageId: 'cross-3-5', criterion: 'growth', phrase: '第21章的救人选择还把成长目标',
    correction: '控制一枚轻物的近期成长目标在第9章建立；第21章使用已学御物救秦禾，并在救人与取样箱之间选择。',
    evidence: [excerpt('plan/chapters/9', 'scenes', '林辰把近期成长目标缩到'), excerpt('plan/chapters/21', 'choice', '抬开无受载的小防脱钩')] },
  { id: 'original_missing_material', stageId: 'followup-batch-1/payoff', criterion: 'payoff', phrase: '此前缺少story/overview',
    correction: '原批已全文提供story/overview；原问题缺的是第1—50章细纲。本次补读确实提供了所要求的50章，不能因开头误述就否认实际补读，也不能改写原问题。',
    evidence: [{ sourceId: 'review-question/batch-1/payoff', explanation: originalPayoff.explanation,
      revisionAdvice: originalPayoff.revisionAdvice, requestedSourceCount: originalPayoff.awaitingSources.length,
      requestedSourceIdsSha256: sha(JSON.stringify(originalPayoff.awaitingSources)) },
    { sourceId: 'story/overview', sourceSha256: sha(overviewText), completeInOriginalBatch: true }] },
  { id: 'chapter_number_as_day', stageId: 'synthesis-3', criterion: 'timeline', phrase: '51—466日',
    correction: '第51章是章节号，不是第51日。该章从第254日午后开始；第100章阶段结尾为第466日。',
    evidence: [excerpt('plan/milestones/ms_v2_fire', 'setup', '51拟主写重聚后的失落'),
      excerpt('plan/milestones/ms_v3_payoff', 'outcome', '第437–466日')] },
  { id: 'advancement_training_order', stageId: 'synthesis-5', criterion: 'growth',
    phrase: '将玄府晋阶置于复诊、十元载支付、元罡稳定及护罡实测之后',
    correction: '第415日经诊察和丹府前置实测后支付十元载晋入玄府；第416—424日才进行玄府元罡稳定、局部护罡训练与实测。不得倒置成先掌握玄府元罡和护罡才能晋阶。',
    evidence: [excerpt('plan/milestones/ms_v3_advancement', 'setup', '第415日白榆连续复诊'),
      excerpt('plan/milestones/ms_v3_advancement', 'setup', '玄府初成需第416–424日稳定元罡')] },
];
let responsesReplayed = 0;
for (const dispute of disputes) {
  const stage = run.stages.find(stage => stage.id === dispute.stageId);
  const check = stage.result.checks.find(check => check.criterion === dispute.criterion);
  assert.equal(check.verdict, 'pass');
  assert.ok(check.explanation.includes(dispute.phrase), dispute.id);
  const request = designReviewStageInput(run, stage);
  let calls = 0;
  const planner = new JsonDesignPlanner({ complete: async () => {
    assert.ok(calls < stage.modelResponses.length);
    return stage.modelResponses[calls++];
  } });
  const { modelResponses, ...result } = await planner.reviewDesignContent(request);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), stage.result);
  assert.deepEqual(modelResponses, stage.modelResponses);
  responsesReplayed += calls;
  const { evidence, ...originalCheck } = check;
  Object.assign(dispute, { originalCheck, evidenceCount: evidence.length, evidenceSha256: sha(JSON.stringify(evidence)),
    requestSha256: sha(JSON.stringify(request)), savedResponsesReplayed: calls, parentPath: [stage.id] });
  for (;;) {
    const parent = run.stages.find(stage => stage.children.includes(dispute.parentPath.at(-1)));
    if (!parent) break;
    dispute.parentPath.push(parent.id);
  }
}
const snapshotPath = `${root}/story-explanation-disputes.json`;
const proof = {
  kind: 'design68_story_explanation_disputes', observedAt: checkpoint.updatedAt,
  inputHash: baseline.inputHash, runId: run.id, snapshotPath, snapshotSha256: sha(bytes),
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length, responsesReplayed, disputes,
  modelCalls: 0, productionWrites: 0, questionsClosed: 0, originalVerdictsChanged: false, designApproved: false,
  limitation: 'These are explanation errors reconciled against original sources, not new defects in the correct design or automatic formal failed verdicts. Follow the actual parent paths through the completed final report before determining propagation. Original responses, requests, verdicts, source deferrals and valid resolutions remain unchanged.',
};
fs.writeFileSync(snapshotPath, bytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-story-explanation-disputes.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ disputes: disputes.map(dispute => ({ id: dispute.id, stageId: dispute.stageId, parentPath: dispute.parentPath })), responsesReplayed, modelCalls: 0, productionWrites: 0 }));
