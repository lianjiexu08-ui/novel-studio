// Preserve the synthesis's terminology objection alongside primary-source evidence.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
const read = path => JSON.parse(fs.readFileSync(path));
const control = 'data/audit-runtimes/design68-review';
const bytes = fs.readFileSync(`${control}/result.json`), checkpoint = JSON.parse(bytes);
const baseline = read(`${control}/baseline.json`);
const binding = read('data/audit-runtimes/design68-runtime-bound.json');
const inputsBytes = fs.readFileSync(`${control}/inputs.json`);
assert.equal(sha(inputsBytes), baseline.inputsSha256);
for (const [path, expected] of Object.entries(binding.sourceHashes)) assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
const run = checkpoint.runs.find(run => run.input.area === 'power');
assert.deepEqual(run.input, JSON.parse(inputsBytes).power);
const stage = run.stages.find(stage => stage.id === 'synthesis-32');
assert.ok(stage.result);
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
  const item = run.input.sources.find(source => source.id === id);
  assert.ok(item, id);
  return { id, sha256: sha(item.text), value: JSON.parse(item.text) };
};
const realm = source('world/realms/realm_03');
const ladder = source('world/tierLadders/ladder_realm');
const overview = source('plan/overview');
const training = source('plan/milestones/ms_v3_training');
const advancement = source('plan/milestones/ms_v3_advancement');
assert.equal(realm.value.name, '玄府境');
assert.ok(realm.value.prerequisites.includes('辟建丹府'));
assert.ok(ladder.value.levels.includes('玄府'));
assert.ok(!ladder.value.levels.includes('丹府'));
assert.ok(overview.value.protagonistArc.includes('实测丹府与支付十元载成为玄府初期'));
assert.ok(training.value.outcome.includes('第410日林已经能稳定建立丹府雏形但尚未付十年晋阶'));
assert.ok(advancement.value.setup[0].includes('第415日'));
assert.ok(advancement.value.setup[0].includes('顾观察辟建丹府实测'));
assert.ok(advancement.value.setup[0].includes('最后-10才是第415日玄府晋阶'));
const check = stage.result.checks.find(check => check.criterion === 'tiers');
assert.equal(check.verdict, 'revise');
assert.ok(check.explanation.includes('实测丹府'));
const snapshotPath = `${control}/power-danfu-dispute.json`;
const proof = {
  kind: 'design68_power_danfu_prerequisite_misread_as_realm', observedAt: checkpoint.updatedAt,
  inputHash: baseline.inputHash, runId: run.id, stageId: stage.id,
  snapshotPath, snapshotSha256: sha(bytes), stageSha256: sha(JSON.stringify(stage)),
  requestSha256: sha(JSON.stringify(request)), savedResponsesReplayed: calls,
  originalCheck: { ...check, evidence: undefined, evidenceCount: check.evidence.length, evidenceSha256: sha(JSON.stringify(check.evidence)) },
  evidence: [
    { id: realm.id, sha256: realm.sha256, name: realm.value.name, prerequisites: realm.value.prerequisites },
    { id: ladder.id, sha256: ladder.sha256, levels: ladder.value.levels },
    { id: overview.id, sha256: overview.sha256, protagonistArc: overview.value.protagonistArc },
    { id: training.id, sha256: training.sha256, outcome: training.value.outcome },
    { id: advancement.id, sha256: advancement.sha256, setup: advancement.value.setup[0] },
  ],
  requestContainsExactPrerequisitePhrase: request.sources.some(source => source.text.includes('辟建丹府')),
  adjudication: 'The current realm definition explicitly lists building the danfu as a prerequisite for Xuanfu. The overview says testing that prerequisite and paying10 leads to Xuanfu; it does not name Danfu as a separate realm. Day410 establishes only an initial structure and day415 pays for the actual advancement. The asserted realm-name conflict is not established by these sources. Adding a new realm or renaming the prerequisite would change existing rules unnecessarily.',
  limitation: 'This refutes the stated terminology conflict. It does not establish that every training scene, medical check, lifespan payment or later technique use is sufficient or has occurred in adopted prose.',
  modelCalls: 0, productionWrites: 0, originalVerdictChanged: false, questionsClosed: 0, formalAcceptance: false,
};
fs.writeFileSync(snapshotPath, bytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-power-danfu-dispute.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ stageId: stage.id, savedResponsesReplayed: calls,
  prerequisite: realm.value.prerequisites, finalRealm: realm.value.name,
  requestContainsExactPrerequisitePhrase: proof.requestContainsExactPrerequisitePhrase,
  originalVerdictChanged: false, modelCalls: 0, productionWrites: 0 }));
