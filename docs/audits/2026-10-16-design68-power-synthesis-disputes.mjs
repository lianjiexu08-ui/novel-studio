// Read-only replay and source reconciliation; no calls to a live model or DB writes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
const read = path => JSON.parse(fs.readFileSync(path));
const control = 'data/audit-runtimes/design68-review';
const binding = read('data/audit-runtimes/design68-runtime-bound.json');
const baseline = read(`${control}/baseline.json`);
const inputBytes = fs.readFileSync(`${control}/inputs.json`);
assert.equal(sha(inputBytes), baseline.inputsSha256);
for (const [path, expected] of Object.entries(binding.sourceHashes)) {
  assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
}
const checkpointBytes = fs.readFileSync(`${control}/result.json`);
const checkpoint = JSON.parse(checkpointBytes);
const run = checkpoint.runs.find(run => run.input.area === 'power');
assert.deepEqual(run.input, JSON.parse(inputBytes).power);
const { designReviewStageInput } = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const stageProofs = [];
for (const id of ['synthesis-5', 'synthesis-8']) {
  const stage = run.stages.find(stage => stage.id === id);
  assert.ok(stage.result);
  const request = designReviewStageInput(run, stage);
  let calls = 0;
  const planner = new JsonDesignPlanner({ complete: async () => {
    assert.ok(calls < stage.modelResponses.length);
    return stage.modelResponses[calls++];
  } });
  const { modelResponses, ...result } = await planner.reviewDesignContent(request);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), stage.result);
  assert.deepEqual(modelResponses, stage.modelResponses);
  stageProofs.push({ id, children: stage.children, requestSha256: sha(JSON.stringify(request)),
    stageSha256: sha(JSON.stringify(stage)), savedResponsesReplayed: calls,
    originalSummary: stage.result.summary,
    originalChecks: stage.result.checks.map(({ evidence, ...check }) => ({ ...check,
      evidenceCount: evidence.length, evidenceSha256: sha(JSON.stringify(evidence)) })) });
}
const source = id => {
  const found = run.input.sources.find(source => source.id === id);
  assert.ok(found, id);
  return { id, sha256: sha(found.text), value: JSON.parse(found.text) };
};
const chapter23 = source('plan/chapters/23');
const chapter25 = source('plan/chapters/25');
const returning = source('plan/milestones/ms_v3_return');
const mo = source('story/characters/char_04');
const gu = source('story/characters/char_10');
const pin23 = chapter23.value.scenes.find(text => text.includes('小销约八两'));
const pin25 = chapter25.value.scenes.find(text => text.includes('两丈内直视第23章核过的八两小销'));
assert.ok(pin23.includes('满斗重量由支轴和闸钩承受'));
assert.ok(pin25.includes('小销只锁空载拨片'));
assert.ok(pin25.includes('预付半成真元'));
assert.ok(returning.value.cost.includes('保温衣8'));
assert.ok(returning.value.cost.includes('查验625'));
assert.ok(returning.value.outcome.includes('保温衣、医药、食宿、供暖、查验689'));
assert.equal(12 + 1 + 18 + 36 + 8 + 625, 700);
assert.equal(700 + 24 + 56, 780);
assert.equal(8 + 625 + 56, 689);
assert.equal(12 + 1 + 18 + 24 + 36 + 689, 780);
assert.equal(14000 - 10000 - 3000 - 780, 220);
assert.equal(mo.value.name, '墨幽屠');
assert.equal(gu.value.name, '顾峤');
assert.ok(mo.value.identity.includes('不超过六百斤'));
assert.ok(!mo.value.identity.includes('三百斤'));
assert.ok(gu.value.identity.includes('个人本次已测总重只记三百斤'));
assert.ok(chapter23.value.scenes[2].includes('车身与散装料合重不到六百斤'));
const synthesis5 = stageProofs[0];
assert.ok(synthesis5.originalChecks.every(check => check.verdict === 'revise'));
assert.ok(synthesis5.originalChecks.find(check => check.criterion === 'counters').explanation.includes('插销是否为合规轻小自由物未被设计确认'));
const synthesis8 = stageProofs[1];
assert.ok(synthesis8.originalChecks.find(check => check.criterion === 'tiers').explanation.includes('墨幽屠开篇前个人实测总重为三百斤'));
const snapshotPath = `${control}/power-synthesis-disputes.json`;
const proof = {
  kind: 'design68_power_synthesis_disputed_claim_propagation',
  observedAt: checkpoint.updatedAt, inputHash: baseline.inputHash, runId: run.id,
  snapshotPath, snapshotSha256: sha(checkpointBytes),
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  stages: stageProofs,
  adjudication: [
    { stages: ['cross-1-5', 'synthesis-5'], criteria: ['tiers', 'counters'],
      status: 'missing_specification_claim_refuted_by_frozen_chapters',
      explanation: 'The synthesis repeats the short milestone omission as an omission from the design, and extends that premise to counters. Chapters23/25 already specify mass, visible distance, unloaded plate, separate mechanical load-bearing and half-unit payment. The inherited negative is preserved, but repetition does not independently corroborate its premise.',
      evidence: [{ id: chapter23.id, sha256: chapter23.sha256, quote: pin23 },
        { id: chapter25.id, sha256: chapter25.sha256, quote: pin25 }],
      limitation: 'This refutes the asserted absent specification; it is not a blanket approval of the combat, machinery or future prose.' },
    { stages: ['cross-1-5', 'synthesis-5'], criteria: ['costs'],
      status: 'category_and_period_mismatch',
      explanation: 'The second account includes clothing8 inside the residual689, whereas the earlier625 excludes it and precedes the later56. Synthesis5 incorrectly keeps clothing8 outside both residuals and treats the later cumulative residual as a competing earlier subtotal.',
      evidence: [{ id: returning.id, sha256: returning.sha256,
        cost: returning.value.cost, outcome: returning.value.outcome }],
      equations: ['12+1+18+36+8+625=700', '700+24=724', '724+56=780',
        '8+625+56=689', '12+1+18+24+36+689=780', '14000-10000-3000-780=220'],
      limitation: 'Checks planned arithmetic only. Future chapters must still establish the actual payments.' },
    { stages: ['followup-batch-1/tiers', 'synthesis-8'], criteria: ['tiers'],
      status: 'character_attribution_refuted_with_residual_load_ambiguity',
      explanation: 'Three hundred jin belongs to Gu, not Mo. Mo has tested a cart no heavier than600, but the source does not identify that measured load or establish that the chapter23 load is within it. Keep this actual ambiguity; neither assign Gu’s300 to Mo nor infer that Mo measured600.',
      evidence: [mo, gu].map(({ id, sha256, value }) => ({ id, sha256, name: value.name, identity: value.identity })),
      chapterEvidence: { id: chapter23.id, sha256: chapter23.sha256, quote: chapter23.value.scenes[2] },
      candidateStatus: 'Unapplied candidatev16 proposes Mo measured500/cart480 as new authored values, not recovered historical facts. It remains subject to four-area reconciliation and fresh review.' },
  ],
  modelCalls: 0, productionWrites: 0, originalVerdictsChanged: false,
  questionsClosed: 0, formalAcceptance: false,
  nextStep: 'Trace these claims into the complete power report. Re-review with complete relevant primary sources; do not alter correct facts merely to satisfy repeated negatives. Schedule27 protects unresolved negative verdicts but does not adjudicate whether their semantic claims are true.',
};
fs.writeFileSync(snapshotPath, checkpointBytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-power-synthesis-disputes.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ stages: stageProofs.map(s => s.id),
  savedResponsesReplayed: stageProofs.reduce((sum, s) => sum + s.savedResponsesReplayed, 0),
  adjudications: proof.adjudication.map(item => item.status),
  modelCalls: 0, productionWrites: 0, formalAcceptance: false }));
