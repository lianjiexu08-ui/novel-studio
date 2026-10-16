// Offline evidence only. Never changes the live review, design, or verdict.
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
const inputs = JSON.parse(inputBytes);
const checkpointBytes = fs.readFileSync(`${root}/result.json`);
const checkpoint = JSON.parse(checkpointBytes);
for (const [path, expected] of Object.entries(binding.sourceHashes)) {
  assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
}
const run = checkpoint.runs.find(run => run.input.area === 'power');
assert.deepEqual(run.input, inputs.power);
const stage = run.stages.find(stage => stage.id === 'followup-cross-2-3/costs');
const check = stage.result.checks.find(check => check.criterion === 'costs');
assert.equal(check.verdict, 'insufficient');
assert.equal(check.awaitingSources, undefined);
const { designReviewStageInput } = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const request = designReviewStageInput(run, stage);
let calls = 0;
const planner = new JsonDesignPlanner({ complete: async () => {
  assert.ok(calls < stage.modelResponses.length);
  return stage.modelResponses[calls++];
} });
const { modelResponses, ...replayed } = await planner.reviewDesignContent(request);
assert.deepEqual(JSON.parse(JSON.stringify(replayed)), stage.result);
assert.deepEqual(modelResponses, stage.modelResponses);
const source = id => {
  const value = inputs.power.sources.find(source => source.id === id);
  assert.ok(value, id);
  return { id, sha256: sha(value.text), value: JSON.parse(value.text) };
};
const spring = source('world/resources/res_09');
const charm = source('world/artifacts/art_16');
for (const item of [spring, charm]) {
  assert.ok(!request.stage.sourceMap.some(entry => entry.sourceId === item.id));
}
assert.ok(spring.value.usage.effect.includes('每人终生最多六个有效剂额'));
assert.ok(spring.value.usage.effect.includes('累计新增不超过三十年'));
assert.ok(charm.value.cost.includes('完好满符最多累计720小时'));
const chapter26 = source('plan/chapters/26');
const chapter27 = source('plan/chapters/27');
const chapter28 = source('plan/chapters/28');
const allocation = chapter26.value.scenes.find(text => text.includes('核准另6滴两支封管给林'));
const first = chapter27.value.scenes.find(text => text.includes('有效剂数由0到1'));
const second = chapter28.value.scenes.find(text => text.includes('有效剂数从1到2'));
assert.ok(allocation && first && second);
assert.ok(allocation.includes('两剂未来10元载不能先花'));
assert.ok(second.includes('未再从原批或下一周期领一剂'));
assert.ok(check.explanation.includes('个人两剂上限'));
const snapshotPath = `${root}/power-resource-coverage.json`;
const proof = {
  kind: 'design68_power_resource_followup_coverage', observedAt: checkpoint.updatedAt,
  inputHash: baseline.inputHash, runId: run.id, stageId: stage.id,
  snapshotPath, snapshotSha256: sha(checkpointBytes),
  requestSha256: sha(JSON.stringify(request)), stageSha256: sha(JSON.stringify(stage)),
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  savedResponsesReplayed: calls,
  originalCheck: { ...check, evidence: undefined, evidenceCount: check.evidence.length },
  coverage: [spring, charm].map(({ id, sha256 }) => ({ id, sha256, presentInFrozenInputs: true, presentInThisRequest: false })),
  adjudication: {
    status: 'review_material_not_closed',
    explanation: 'The two requested rule objects exist in the complete frozen design but are absent from this followup request. Preserve insufficient; missing local review material does not establish missing design rules.',
    doseWording: 'The reviewer phrase personal two-dose limit must not replace the world rule. Chapters26–28 allocate and consume two doses in this phase, while res_09 defines a lifetime maximum of six effective doses / thirty added years. This does not entitle the protagonist to obtain the remaining four.',
    evidence: [spring, charm, { id: chapter26.id, sha256: chapter26.sha256, quote: allocation }, { id: chapter27.id, sha256: chapter27.sha256, quote: first }, { id: chapter28.id, sha256: chapter28.sha256, quote: second }],
  },
  modelCalls: 0, productionWrites: 0, originalVerdictsChanged: false, questionsClosed: 0,
  formalAcceptance: false,
  limitation: 'This replay and source comparison does not semantically certify every ledger, resolve the formal insufficient check, or establish future source coverage. No supplemental model review has been performed.',
  nextStep: 'Reconcile the completed four-area reports, then include these exact rules with their dependent chapter accounts in focused re-review; preserve the original insufficient result and all sources. Do not change the running schedule or add duplicate world entries.',
};
fs.writeFileSync(snapshotPath, checkpointBytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-power-resource-coverage.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ stageId: stage.id, savedResponsesReplayed: calls, coverage: proof.coverage, modelCalls: 0, productionWrites: 0 }));
