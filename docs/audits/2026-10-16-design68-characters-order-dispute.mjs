// Read-only reconciliation of a live review's saved response. No model calls.
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
for (const [path, hash] of Object.entries(binding.sourceHashes))
  assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), hash, path);
const bytes = fs.readFileSync(`${root}/result.json`), checkpoint = JSON.parse(bytes);
const run = checkpoint.runs.find(run => run.input.area === 'characters');
assert.deepEqual(run.input, JSON.parse(inputBytes).characters);
const stage = run.stages.find(stage => stage.id === 'synthesis-10');
const check = stage.result.checks.find(check => check.criterion === 'knowledge');
const disputed = '父案证据按署名图、巡档副本、当面交接和原令逐步推进';
assert.equal(check.verdict, 'pass');
assert.ok(check.explanation.includes(disputed));
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
const childId = 'followup-cross-1-5/knowledge';
const child = run.stages.find(stage => stage.id === childId).result.checks[0];
const correct = '父案证据仍按署名图、巡档副本、当面交接、外山存根递进';
assert.ok(child.explanation.includes(correct));
assert.ok(request.sources.find(source => source.id === `review-result/${childId}`).text.includes(correct));
const source = id => {
  const item = run.input.sources.find(source => source.id === id);
  assert.ok(item, id);
  return { id, sha256: sha(item.text), value: JSON.parse(item.text) };
};
const secret = source('story/secrets/sec_01');
const advancement = source('plan/milestones/ms_v3_advancement');
const convoy = source('plan/milestones/ms_v3_convoy');
const order = source('story/arcBeats/message-withdraw-seized');
const father = secret.value.knowledgeStages.find(item => item.characterId === 'char_01' && item.sinceChapter === 85);
assert.ok(father.trigger.includes('外山仓取存根'));
assert.ok(father.belief.includes('投毒与十年前完整因果仍未证实'));
const ledger = advancement.value.setup.find(text => text.includes('父亲署名的移交存根'));
const limit = convoy.value.setup.find(text => text.startsWith('认知：实际撤人令'));
assert.ok(ledger && limit);
assert.ok(limit.includes('追究赵本次行动'));
assert.equal(order.value.plannedChapter, 95);
assert.ok(order.value.expectedChange.includes('撤押一号'));
const snapshotPath = `${root}/characters-order-dispute.json`;
const proof = {
  kind: 'design68_character_synthesis_evidence_chain_conflation', observedAt: checkpoint.updatedAt,
  inputHash: baseline.inputHash, runId: run.id, stageId: stage.id,
  snapshotPath, snapshotSha256: sha(bytes), requestSha256: sha(JSON.stringify(request)),
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length, savedResponsesReplayed: calls,
  originalCheck: { ...check, evidence: undefined, evidenceCount: check.evidence.length },
  disputedPhrase: disputed, suppliedChildCorrection: { stageId: childId, quote: correct },
  sourceEvidence: [
    { id: secret.id, sha256: secret.sha256, quote: secret.value.revealCondition, knowledgeStage: father },
    { id: advancement.id, sha256: advancement.sha256, quote: ledger },
    { id: convoy.id, sha256: convoy.sha256, quote: limit },
    { id: order.id, sha256: order.sha256, quote: order.value.expectedChange },
  ],
  adjudication: 'The synthesis wording replaces the father-case archive stub with the current convoy order, conflating two evidence chains. The delivered child report already distinguishes them. The frozen design uses chapter85 archive records for father participation/concealment and chapter95 withdrawal order for the current convoy action. Neither establishes the complete poisoning case or all Nine-Cauldron secrets.',
  correctionForReconciliation: '父案证据按署名图、巡档副本、当面交接与外山原存根递进；第95章取得撤押原令后，才据其推动本次押运命令的问责。',
  originalVerdictChanged: false, productionWrites: 0, modelCalls: 0, questionsClosed: 0,
  limitation: 'This records a specific explanation error, not a new source-design defect or a formal reversal of pass. Character synthesis and story review remain unfinished. Inspect later reports for propagation and preserve the original response; do not rewrite correct novel sources to match the conflation.',
};
fs.writeFileSync(snapshotPath, bytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-characters-order-dispute.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ stageId: stage.id, savedResponsesReplayed: calls, disputedPhrase: disputed,
  suppliedChildCorrection: correct, snapshotPath, modelCalls: 0, productionWrites: 0 }));
