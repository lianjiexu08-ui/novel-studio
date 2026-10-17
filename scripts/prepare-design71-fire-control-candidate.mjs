// Preserve the actual rejection and draft a separate proposal. No work/database writes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { techniqueDefinitionSchema, resourceDefinitionSchema } from '../packages/contracts/src/world.ts';

const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash = file => sha(fs.readFileSync(file));
const control = 'data/audit-runtimes/design71-review';
const baseline = read(`${control}/baseline.json`);
const inputPath = `${control}/inputs.json`;
assert.equal(fileHash(inputPath), baseline.inputsSha256);
assert.equal(fileHash('scripts/run-design71-review.mjs'), baseline.runnerSha256);
const inputs = read(inputPath);
assert.equal(inputs.power.scope.planRevisionId, baseline.planId);
const checkpointBytes = fs.readFileSync(`${control}/result.json`);
const checkpoint = JSON.parse(checkpointBytes);
assert.equal(checkpoint.inputHash, baseline.inputHash);
const run = checkpoint.runs.find(run => run.input.area === 'power');
assert.ok(run);
assert.equal(run.scheduleVersion, 32);
assert.deepEqual(run.input, inputs.power);
const stage = run.stages.find(stage => stage.id === 'batch-5');
assert.ok(stage?.result);
assert.deepEqual(stage.result.checks.map(check => [check.criterion, check.verdict]),
  [['tiers', 'revise'], ['costs', 'revise'], ['counters', 'revise']]);

const sources = new Map(inputs.power.sources.map(source => [source.id, source]));
const units = new Map(run.units.map(unit => [unit.id, unit]));
const originalEvidence = stage.result.checks.map(check => ({ criterion: check.criterion,
  evidence: check.evidence.map(evidence => {
    const unit = units.get(evidence.sourceId);
    assert.ok(unit);
    const source = sources.get(unit.sourceId);
    assert.ok(source);
    assert.ok(source.text.slice(unit.start, unit.end).includes(evidence.quote));
    return { ...evidence, canonicalSourceId: source.id, unit, sourceSha256: sha(source.text) };
  }),
}));
const techniqueBefore = JSON.parse(sources.get('world/techniques/tech_07').text);
const resourceBefore = JSON.parse(sources.get('world/resources/res_12').text);
assert.equal(techniqueBefore.name, '天火焚野典');
assert.deepEqual(techniqueBefore.allowedRealmIds, ['realm_03', 'realm_04']);
assert.ok(techniqueBefore.limitations[0].includes('神识失准'));
assert.ok(techniqueBefore.limitations[3].includes('神识控制'));

const techniqueAfter = structuredClone(techniqueBefore);
techniqueAfter.cost += ' 神海式另在开始三息引火时预付本人健康稳定可用神识上限一成，涵盖本次布网及随后至多十息控火；不足不得起术，提前中断不退，不扣永久本源。玄府式按下述已实测的元罡导火操作，不使用尚未定义的神识账户；控火注意力仍须清醒稳定，不能以法力或火髓替代。';
techniqueAfter.limitations[0] = '需先以火髓在施术地点完成三个呼吸的引火布网；布网期间受击、阵位被毁、火髓污染或本境控火失准即中断，已耗火髓、法力及神海式已付可用神识不返还。火网尚未成形不能预支其效果；中断后的实际余火、烫伤和已引燃普通材料须由现场人员处理，不因停术自动撤销。';
techniqueAfter.limitations[3] = '不能以赤霄神火髓替代施术者境界、已掌握的本境控火操作、当境法力、神海式可用神识或其他法宝启动成本；不得将玄府元罡导火记成神识外探，也不能让神海施术者改称玄府式来免付本境神识费用。';
techniqueAfter.limitations.push(
  '两境均须先由已掌握对应式者实际指导，在无旁人的可控阵位练成分装引火、三息布网、持续控火及主动停术，并通过受控打断、失去可见阵位时的停术实测及经脉复诊，记录本人本境已测稳定覆盖范围。玄府晋阶不自动获得控火，升神海须另练神海式；本条不宣称任何现有人物已经取得指导、火髓、阵位或修成此术。',
  '玄府式以肉眼持续辨认真实阵位和火网边界，用已训练的元罡导火与站位手势维持引导；只在本人本式实测稳定范围与百丈总上限中较小者内布网。必要阵位或火网边界被烟尘、遮挡或强光遮住，辨不清位置、手势受制、眩晕、分心或经脉灼痛即停止导火；不通过未定义的神念看穿遮挡，不兼行另一控术。注意力不是可数值回充的寿储、法力或神识池，疲劳须实际休息至定向稳定，伤损须经医修复核，法力回满和一刻钟到时均不自动恢复施术资格。',
  '神海式以另经训练和实测的可用神识控制已直接看见的阵位，仍受本人同式实测范围、百丈总上限、可见边界、三息布网与十息维持限制；不新增隔障探查、读心或追踪目标。每次起术前确认可用神识足付一成并经复测定向稳定，神识受扰失准、必要阵位被遮或意识失稳即停术；已付神识、法力和火髓均不退。神识的恢复、伤后上限及永久损伤按ax_07分别核算，不能用吐纳法力、火髓或等待冷却替代。',
);
const resourceAfter = structuredClone(resourceBefore);
resourceAfter.usage.cost += ' 控火按tech_07分别验收：玄府须已练成并实测元罡导火，不以火髓或境界名获得神识；神海还须在起术时另付可用神识一成，该份神识覆盖本次完整控火且中断不退，恢复与伤后上限另按ax_07。';
assert.deepEqual(techniqueDefinitionSchema.parse(techniqueAfter), techniqueAfter);
assert.deepEqual(resourceDefinitionSchema.parse(resourceAfter), resourceAfter);
for (const field of ['id', 'name', 'kind', 'tier', 'allowedRealmIds', 'effect', 'counters', 'status']) {
  assert.deepEqual(techniqueAfter[field], techniqueBefore[field], field);
}
assert.equal(techniqueAfter.limitations[1], techniqueBefore.limitations[1]);
assert.equal(techniqueAfter.limitations[2], techniqueBefore.limitations[2]);
assert.ok(techniqueAfter.cost.startsWith(techniqueBefore.cost));
const resourceWithoutCost = item => ({ ...item, usage: { ...item.usage, cost: undefined } });
assert.deepEqual(resourceWithoutCost(resourceAfter), resourceWithoutCost(resourceBefore));

const snapshotPath = `${control}/fire-control-candidate-prefix.json`;
const candidatePath = 'data/design-candidates/design71-fire-control-v1.json';
const proofPath = 'docs/audits/2026-10-17-design71-fire-control-candidate.json';
for (const file of [snapshotPath, candidatePath, proofPath]) assert.ok(!fs.existsSync(file), `Preserve prior file: ${file}`);
const changes = [
  { sourceId: 'world/techniques/tech_07', before: techniqueBefore, after: techniqueAfter },
  { sourceId: 'world/resources/res_12', before: resourceBefore, after: resourceAfter },
];
const candidate = { kind: 'unapplied_design_source_proposal', basedOnInputHash: baseline.inputHash,
  workId: baseline.workId, changes,
  rationale: 'New author proposal for separate Xuanfu and Shenhai control prerequisites, payment and interruption. Not a retroactive interpretation or a proven fix.',
  applied: false, modelReviewed: false, formalAcceptance: false };
fs.writeFileSync(snapshotPath, checkpointBytes, { flag: 'wx' });
fs.writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });
const allSources = new Map(Object.values(inputs).flatMap(input => input.sources).map(source => [source.id, source]));
const proof = { preparedAt: new Date().toISOString(), expectedInputHash: baseline.inputHash,
  inputPath, inputsSha256: baseline.inputsSha256, snapshotPath, snapshotSha256: sha(checkpointBytes),
  runId: run.id, stageId: stage.id, originalStage: stage, originalEvidence,
  originalCanonicalSources: [...new Set(originalEvidence.flatMap(check => check.evidence.map(evidence => evidence.canonicalSourceId)))].map(id => sources.get(id)),
  explicitReferences: [...allSources.values()].filter(source => /tech_07|天火焚野典/.test(source.text)).map(source => source.id),
  candidatePath, candidateSha256: fileHash(candidatePath), changes,
  schemaSourceSha256: fileHash('packages/contracts/src/world.ts'),
  modelCalls: 0, productionWrites: 0, formalAcceptance: false,
  limitation: 'Schema and unchanged-field assertions do not prove semantic quality. Preserve the original review; reconcile other areas and review the new control rules before merging into any saved design. No questions, plans, prose or character acquisition are changed.' };
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ runId: run.id, stageId: stage.id, changedSources: changes.map(change => change.sourceId),
  preservedRejections: stage.result.checks.length, schemaValid: true, modelCalls: 0, productionWrites: 0, formalAcceptance: false }));
