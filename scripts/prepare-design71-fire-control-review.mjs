// Prepare or verify an unapplied, scoped candidate request. Never call a model or save a work.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { replayDesignReviewRecord } from './audit-design-reviews.mjs';

const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } }, strict: true });
const read = file => JSON.parse(fs.readFileSync(file));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash = file => hash(fs.readFileSync(file));
const control = 'data/audit-runtimes/design71-review';
const candidateProofPath = 'docs/audits/2026-10-17-design71-fire-control-candidate.json';
const preparedPath = 'docs/audits/2026-10-17-design71-fire-control-request.json';
const directory = 'data/audit-runtimes/design71-fire-control-review';
const inputPath = `${directory}/input.json`;
const baseline = read(`${control}/baseline.json`);
const proof = read(candidateProofPath);
const bindingPath = 'data/audit-runtimes/design71-runtime-bound.json';
assert.equal(fileHash(bindingPath), baseline.runtimeBindingSha256);
assert.equal(fileHash(proof.inputPath), baseline.inputsSha256);
assert.equal(proof.inputsSha256, baseline.inputsSha256);
assert.equal(proof.expectedInputHash, baseline.inputHash);
assert.equal(fileHash(proof.candidatePath), proof.candidateSha256);
assert.equal(fileHash(proof.snapshotPath), proof.snapshotSha256);
assert.equal(fileHash('scripts/run-design71-review.mjs'), baseline.runnerSha256);
const inputs = read(proof.inputPath), candidate = read(proof.candidatePath);
assert.equal(candidate.basedOnInputHash, baseline.inputHash);
assert.equal(candidate.workId, baseline.workId);
assert.equal(candidate.applied, false);
assert.equal(candidate.modelReviewed, false);
assert.equal(candidate.formalAcceptance, false);
assert.equal(inputs.power.scope.planRevisionId, baseline.planId);
assert.deepEqual(candidate.changes, proof.changes);
assert.deepEqual(candidate.changes.map(change => change.sourceId), ['world/techniques/tech_07', 'world/resources/res_12']);

const binding = read(bindingPath);
for (const [file, expected] of Object.entries(binding.sourceHashes)) {
  assert.equal(fileHash(path.join(binding.runtimePath, file)), expected, file);
}
const snapshot = read(proof.snapshotPath);
const run = snapshot.runs.find(run => run.input.area === 'power');
assert.equal(snapshot.inputHash, baseline.inputHash);
assert.equal(run.id, proof.runId);
assert.deepEqual(run.input, inputs.power);
assert.deepEqual(run.stages.find(stage => stage.id === proof.stageId), proof.originalStage);
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const prefixReplay = await replayDesignReviewRecord(run, inputs.power, undefined, { ...runtime, JsonDesignPlanner });

const originals = new Map();
for (const input of Object.values(inputs)) for (const source of input.sources) {
  if (originals.has(source.id)) assert.deepEqual(originals.get(source.id), source, source.id);
  originals.set(source.id, source);
}
const changed = new Map(candidate.changes.map(change => {
  assert.deepEqual(JSON.parse(originals.get(change.sourceId).text), change.before, change.sourceId);
  return [change.sourceId, { id: change.sourceId, text: JSON.stringify(change.after, null, 2) }];
}));
// All complete world sources fit; include them rather than guessing which rules the model needs.
const included = [...originals.values()].filter(source => source.id === 'author' || source.id.startsWith('world/')
  || ['plan/overview', 'story/overview'].includes(source.id));
const referencePattern = /tech_07|天火焚野典/;
const explicitReferenceIds = [...originals.values()].filter(source => referencePattern.test(source.text)).map(source => source.id);
assert.deepEqual(explicitReferenceIds, proof.explicitReferences);
for (const id of explicitReferenceIds) assert.ok(included.some(source => source.id === id), `Missing direct reference: ${id}`);
const history = [
  { id: 'review-history/fire-control/batch-5', text: '以下是旧提案71的历史评审意见与原引用定位，不是当前候选事实，也不证明新提案通过。旧意见中的引用只对应下列旧来源；独立核对本次完整候选规则，不得因旧返修自动判新提案失败，亦不得因作者提出修订自动通过。\n'
    + JSON.stringify({ result: proof.originalStage.result, evidenceOrigins: proof.originalEvidence,
      originalSources: proof.originalCanonicalSources }, null, 2) },
  { id: 'review-context/fire-control-proposal', text: '本次仅评审尚未保存到作品的新控火提案。world/techniques/tech_07与world/resources/res_12为候选全文，其余世界原文来自冻结提案71；新控制方式与神海神识费用是作者新增设计，不是历史已证事实。scope只标记原提案来源，inputHash是本次局部请求指纹，不是生产设计指纹或新版本号。没有角色因此自动学会、取得火髓或施术成功；本请求没有提供章纲和人物档案，不能据此验收人物行动或全书。原正式四领域评审仍独立保留。\n'
    + JSON.stringify({ basedOnInputHash: baseline.inputHash, candidateSha256: proof.candidateSha256,
      changes: candidate.changes, applied: false, modelReviewed: false }, null, 2) },
];
const rubric = {
  tiers: '仅复核天火焚野典及火髓候选与完整世界规则是否相容。分别检查玄府元罡导火与神海可用神识的取得、指导训练、实测范围、使用资格，是否仍隐含未定义能力、循环前提或把晋阶等同掌握。核对百丈只是总上限，不能替代个人实测。火髓的炼制及九转焚天炉用途不能被控火修订误改。新控制方案本身可提出，但须评估其可信性，不能冒认旧设定已证明；不要求先写正文，也不宣称角色已修成。',
  costs: '仅复核本候选的法力、可用神识、火髓、注意力与不可逆损伤。分别核对两成当境法力、一份炉供、神海另付一成可用神识的基准、扣费时点、三息布网和十息维持是否存在重复收费、免费维持、余量不足或伤后打折；不能把玄府未定义神识账户靠改名补齐。核对一刻钟复测不是自动回满，神海恢复和本源损伤按ax_07，火髓不能代付其他账。玄府注意力约束必须有可执行停止条件，不能凭“专注”免除原法力成本。停术不返已用资源，也不撤销真实烫伤或燃烧。',
  counters: '仅复核两境控火的对象、可见范围、阵位、站位手势、三息起式、十息上限与伤后限制是否共同成立。独立检查遮挡、近身打断、阵位破坏、冰水压制及机动规避能否实际反制，停止引导与已经引燃的普通火势是否明确区分；不得因补上限制字句就自动判通过。检查神海能否改称玄府式绕过神识费用，以及新增控制是否暗中赋予隔障探知、跨境强度或人物已有技能。指出具体剩余冲突，不能仅因条目齐全或历史模型意见通过。',
};
const sources = [...included.map(source => changed.get(source.id) ?? source), ...history];
assert.equal(new Set(sources.map(source => source.id)).size, sources.length);
const sourceCharacters = JSON.stringify(sources).length;
assert.ok(sourceCharacters <= runtime.designReviewCapacity, 'Keep complete sources; never truncate to fit');
const scope = inputs.power.scope;
const inputHash = hash(JSON.stringify({ kind: 'unapplied_fire_control_local_review',
  basedOnInputHash: baseline.inputHash, candidateSha256: proof.candidateSha256, scope, sources, rubric }));
assert.notEqual(inputHash, baseline.inputHash);
const input = { area: 'power', scope, inputHash, sources, rubric };
const inputBytes = JSON.stringify(input, null, 2) + '\n';
const manifest = { kind: 'design71_fire_control_local_request', candidateProofPath,
  candidateProofSha256: fileHash(candidateProofPath), candidatePath: proof.candidatePath, candidateSha256: proof.candidateSha256,
  independentInputsPath: proof.inputPath, independentInputsSha256: baseline.inputsSha256,
  prefixSnapshotPath: proof.snapshotPath, prefixSnapshotSha256: proof.snapshotSha256, prefixReplay,
  runtimeBindingPath: bindingPath, runtimeBindingSha256: fileHash(bindingPath),
  basedOnInputHash: baseline.inputHash, inputPath, inputSha256: hash(inputBytes), inputHash,
  hashMeaning: 'Scoped unapplied request identity, not a saved production design hash. Scope identifies the original proposal only.',
  changedSourceIds: [...changed.keys()], explicitReferenceIds, sourceCharacters, rubric,
  selectedSources: sources.map(source => ({ id: source.id, sha256: hash(source.text), characters: source.text.length })),
  omittedSourceIds: [...originals.keys()].filter(id => !included.some(source => source.id === id)),
  historySourceIds: history.map(source => source.id),
  originalWorkerCheckpoint: `${control}/result.json`,
  requiredTerminalProof: 'docs/audits/2026-10-17-design71-review-result.json',
  executionCondition: 'After the original worker exits and its complete four-area terminal proof is verified, reconcile any new findings before using this scoped request. Current gpt-5.6-luna connection, no fallback, bounded calls, preserve every response. This script cannot execute a review.',
  modelCalls: 0, productionWrites: 0, formalAcceptance: false,
  limitation: 'Complete-source preparation and historical-response replay only. No semantic acceptance, character acquisition, candidate application, question closure or approval to write.' };
if (values.check) {
  assert.equal(fileHash(inputPath), manifest.inputSha256);
  assert.deepEqual(read(inputPath), input);
  const { preparedAt, ...saved } = read(preparedPath);
  assert.ok(Number.isFinite(Date.parse(preparedAt)));
  assert.deepEqual(saved, manifest);
} else {
  assert.ok(!fs.existsSync(directory) && !fs.existsSync(preparedPath), 'Preserve prior request; use --check');
  fs.mkdirSync(directory);
  fs.writeFileSync(inputPath, inputBytes, { flag: 'wx' });
  fs.writeFileSync(preparedPath, JSON.stringify({ preparedAt: new Date().toISOString(), ...manifest }, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ checkOnly: values.check, completeSources: sources.length, sourceCharacters,
  prefixResponsesReplayed: prefixReplay.responsesReplayed, changedSourceIds: manifest.changedSourceIds,
  modelCalls: 0, productionWrites: 0, formalAcceptance: false }));
