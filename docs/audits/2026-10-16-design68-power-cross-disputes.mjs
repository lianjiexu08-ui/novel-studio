// Read-only adjudication evidence. Preserve the model's negative response;
// do not modify its verdict, current design, running worker, or formal report.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
const read = path => JSON.parse(fs.readFileSync(path));
const binding = read('data/audit-runtimes/design68-runtime-bound.json');
const baseline = read('data/audit-runtimes/design68-review/baseline.json');
const inputBytes = fs.readFileSync('data/audit-runtimes/design68-review/inputs.json');
assert.equal(sha(inputBytes), baseline.inputsSha256);
const inputs = JSON.parse(inputBytes);
const checkpointBytes = fs.readFileSync('data/audit-runtimes/design68-review/result.json');
const checkpoint = JSON.parse(checkpointBytes);
for (const [path, expected] of Object.entries(binding.sourceHashes)) {
  assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
}
const run = checkpoint.runs.find(run => run.input.area === 'power');
assert.deepEqual(run.input, inputs.power);
const stage = run.stages.find(stage => stage.id === 'cross-1-5');
assert.ok(stage.result);
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const request = runtime.designReviewStageInput(run, stage);
let calls = 0;
const planner = new JsonDesignPlanner({ complete: async () => {
  assert.ok(calls < stage.modelResponses.length);
  return stage.modelResponses[calls++];
} });
const { modelResponses, ...replayed } = await planner.reviewDesignContent(request);
assert.deepEqual(JSON.parse(JSON.stringify(replayed)), stage.result);
assert.deepEqual(modelResponses, stage.modelResponses);
const source = id => {
  const found = inputs.power.sources.find(source => source.id === id);
  assert.ok(found, id);
  return { id, sha256: sha(found.text), value: JSON.parse(found.text) };
};
const chapter23 = source('plan/chapters/23');
const chapter25 = source('plan/chapters/25');
const returning = source('plan/milestones/ms_v3_return');
assert.ok(!request.stage.sourceMap.some(s => s.sourceId === chapter23.id || s.sourceId === chapter25.id));
const pin23 = chapter23.value.scenes.find(text => text.includes('小销约八两'));
const pin25 = chapter25.value.scenes.find(text => text.includes('两丈内直视第23章核过的八两小销'));
assert.ok(pin23.includes('满斗重量由支轴和闸钩承受'));
assert.ok(pin25.includes('小销只锁空载拨片'));
assert.ok(chapter25.value.summary.includes('八两无负载小销'));
assert.ok(returning.value.cost.includes('保温衣8'));
assert.ok(returning.value.cost.includes('查验625'));
assert.ok(returning.value.outcome.includes('查验689'));
const preTax = 12 + 1 + 18 + 36 + 8 + 625;
const tax = 24, later = 56;
const restAtSettlement = 8 + 625 + later;
assert.equal(preTax, 700);
assert.equal(preTax + tax, 724);
assert.equal(preTax + tax + later, 780);
assert.equal(restAtSettlement, 689);
assert.equal(12 + 1 + 18 + 24 + 36 + restAtSettlement, 780);
assert.equal(14000 - 10000 - 3000 - 780, 220);
const snapshotPath = 'data/audit-runtimes/design68-review/power-cross-1-5-disputes.json';
const proof = {
  kind: 'design68_power_cross_1_5_source_disputes',
  inputHash: baseline.inputHash, runId: run.id, stageId: stage.id,
  observedAt: checkpoint.updatedAt, snapshotPath, snapshotSha256: sha(checkpointBytes),
  requestSha256: sha(JSON.stringify(request)), stageSha256: sha(JSON.stringify(stage)),
  savedResponsesReplayed: calls, frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  originalChecks: stage.result.checks.filter(c => c.verdict === 'revise').map(({ evidence, ...check }) => ({ ...check, evidenceCount: evidence.length })),
  adjudication: [
    { criterion: 'tiers', status: 'disputed_against_existing_sources',
      explanation: 'The stage read the short climax milestone but not chapters23/25. The complete frozen chapter sources already specify the pin mass, visible distance, unloaded control plate and separate mechanical load-bearing. A request to read those sources is appropriate; absence from this local batch does not establish absence from the design.',
      evidence: [{ id: chapter23.id, sha256: chapter23.sha256, quote: pin23 }, { id: chapter25.id, sha256: chapter25.sha256, quote: pin25 }],
      limitation: 'Refutes the stated missing-specification claim; does not independently prove every possible mechanical or prose execution issue resolved.' },
    { criterion: 'costs', status: 'arithmetic_claim_refuted',
      explanation: 'The 692 calculation omits the explicitly listed clothing8. The final residual689 includes clothing8, earlier625 and later56; it is not an alternative pre-tax residual. These cumulative periods are explicitly distinguished in the source.',
      evidence: [{ id: returning.id, sha256: returning.sha256, cost: returning.value.cost, outcome: returning.value.outcome }],
      equations: ['12+1+18+36+8+625=700', '700+24=724', '724+56=780', '8+625+56=689', '12+1+18+24+36+689=780', '14000-10000-3000-780=220'],
      limitation: 'Verifies the proposed arithmetic, not historical payment or future chapter implementation.' },
  ],
  modelCalls: 0, productionWrites: 0, originalVerdictsChanged: false, questionsClosed: 0,
  formalAcceptance: false,
  nextStep: 'Preserve these counterexamples for the completed power report and combined candidate review. Do not remove original negatives or change correct accounts to satisfy this partial verdict.',
};
fs.writeFileSync(snapshotPath, checkpointBytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-power-cross-disputes.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ stageId: stage.id, savedResponsesReplayed: calls, disputes: proof.adjudication.map(a => ({ criterion: a.criterion, status: a.status })), modelCalls: 0, productionWrites: 0 }));
