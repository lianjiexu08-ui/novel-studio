// Offline identity reconciliation. Retains the original report and verdicts.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
const read = path => JSON.parse(fs.readFileSync(path));
const root = 'data/audit-runtimes/design68-review';
const binding = read('data/audit-runtimes/design68-runtime-bound.json');
const baseline = read(`${root}/baseline.json`);
const inputsBytes = fs.readFileSync(`${root}/inputs.json`);
assert.equal(sha(inputsBytes), baseline.inputsSha256);
for (const [path, hash] of Object.entries(binding.sourceHashes))
  assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), hash, path);
const bytes = fs.readFileSync(`${root}/result.json`), checkpoint = JSON.parse(bytes);
const run = checkpoint.runs.find(run => run.input.area === 'characters');
assert.deepEqual(run.input, JSON.parse(inputsBytes).characters);
const stage = run.stages.find(stage => stage.id === 'synthesis-16');
const agency = stage.result.checks.find(check => check.criterion === 'agency');
const relationships = stage.result.checks.find(check => check.criterion === 'relationships');
assert.equal(agency.verdict, 'pass');
assert.equal(relationships.verdict, 'pass');
assert.ok(agency.explanation.includes('陆沉川停止协助扣人'));
assert.ok(relationships.explanation.includes('陆沉川开门只形成有限承认和继续看护'));
const { designReviewStageInput } = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const request = designReviewStageInput(run, stage);
let calls = 0;
const planner = new JsonDesignPlanner({ complete: async () => {
  assert.ok(calls < stage.modelResponses.length);
  return stage.modelResponses[calls++];
} });
const { modelResponses, ...result } = await planner.reviewDesignContent(request);
assert.deepEqual(JSON.parse(JSON.stringify(result)), stage.result);
assert.deepEqual(modelResponses, stage.modelResponses);
const source = id => {
  const item = run.input.sources.find(source => source.id === id);
  assert.ok(item, id);
  return { id, sha256: sha(item.text), value: JSON.parse(item.text) };
};
const elder = source('story/characters/char_16');
const younger = source('story/characters/char_21');
const relation = source('story/relationships/rel_13');
const youngerRelation = source('story/relationships/rel_19');
const chapter = source('plan/chapters/50');
assert.equal(elder.value.name, '陆沉舟');
assert.equal(younger.value.name, '陆沉川');
assert.ok(younger.value.identity.includes('陆沉舟的弟弟'));
assert.equal(relation.value.toCharacterId, elder.value.id);
assert.equal(youngerRelation.value.toCharacterId, younger.value.id);
const stage50 = relation.value.stages.find(stage => stage.sinceChapter === 50 && stage.untilChapter === 50);
assert.ok(stage50.cause.includes('吴指认陆本次押送'));
assert.ok(stage50.cost.includes('陆仍受看护'));
assert.ok(chapter.value.characterIds.includes(elder.value.id));
assert.ok(!chapter.value.characterIds.includes(younger.value.id));
assert.ok(chapter.value.choice.includes('陆改为外拉木闩'));
const snapshotPath = `${root}/characters-brother-dispute.json`;
const proof = {
  kind: 'design68_character_synthesis_brother_identity_conflation', observedAt: checkpoint.updatedAt,
  inputHash: baseline.inputHash, runId: run.id, stageId: stage.id,
  snapshotPath, snapshotSha256: sha(bytes), requestSha256: sha(JSON.stringify(request)),
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length, savedResponsesReplayed: calls,
  originalChecks: [agency, relationships].map(({ evidence, ...check }) => ({ ...check, evidenceCount: evidence.length })),
  sourceEvidence: [
    ...[elder, younger].map(item => ({ id: item.id, sha256: item.sha256, characterId: item.value.id, name: item.value.name, identity: item.value.identity })),
    { id: relation.id, sha256: relation.sha256, toCharacterId: relation.value.toCharacterId, stage50 },
    { id: youngerRelation.id, sha256: youngerRelation.sha256, toCharacterId: youngerRelation.value.toCharacterId,
      stage39: youngerRelation.value.stages.find(stage => stage.sinceChapter === 39) },
    { id: chapter.id, sha256: chapter.sha256, characterIds: chapter.value.characterIds, choice: chapter.value.choice, endState: chapter.value.endState },
  ],
  adjudication: 'The synthesis attributes chapter50 intervention, admission and continued supervision to younger brother Lu Chenchuan (char_21). The chapter cast and relation rel_13 identify elder brother Lu Chenzhou (char_16). This is an explanation identity error; do not transfer the elder brother\'s conduct or responsibility to the rescued younger brother.',
  correctionForReconciliation: '第50章协助开门、承认本次押送并继续受看护的是哥哥陆沉舟（char_16）；弟弟陆沉川（char_21）不能被代入该现场行动。',
  originalVerdictsChanged: false, productionWrites: 0, modelCalls: 0, questionsClosed: 0,
  limitation: 'This preserves a concrete explanation error without claiming a formal failed verdict or changing the correct design. Inspect synthesis20, synthesis22 and synthesis24 for propagation, then reconcile with the completed story review before any design approval or prose generation.',
};
fs.writeFileSync(snapshotPath, bytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-characters-brother-dispute.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ stageId: stage.id, savedResponsesReplayed: calls, elder: elder.value.name,
  wronglyAttributed: younger.value.name, chapter50Cast: chapter.value.characterIds, modelCalls: 0, productionWrites: 0 }));
