// Unapplied author proposal; never mutate the frozen review inputs or database.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
const basePath = 'data/design-candidates/design68-captive-cold-draft-v12.json';
const bytes = fs.readFileSync(basePath);
assert.equal(sha(bytes), 'b1f4f16cdadd52160d9069a95e28737a92fa132dd70497d070e1ffd5fc77c57d');
const base = JSON.parse(bytes), candidate = structuredClone(base);
const inputs = JSON.parse(fs.readFileSync('data/audit-runtimes/design68-review/inputs.json'));
assert.equal(inputs.power.inputHash, '3274d4710800ad02565040a341a05177b4bd7cab363e169219b562a4a0f62d01');
const original = base.worldPack.artifacts.find(item => item.id === 'art_03');
assert.deepEqual(original, JSON.parse(inputs.power.sources.find(s => s.id === 'world/artifacts/art_03').text));
const artifact = candidate.worldPack.artifacts.find(item => item.id === 'art_03');
artifact.cost += ' 冷却后的低流量试注是单独的器身复用检查，每次预付本人凝元健康稳定真元上限的半成，另于挥击、剑诀和御物计费；中断、异常或检查失败均不退，不以流量低免单，也不把这半成作为下一式已付款。';
artifact.limitations.push('低流量试注只供已在授业中练成凝元注剑、收注与冷却检查者执行，不能由持剑或晋阶自动取得；第18章既有顾峤指导与176日“剑冷后再用”实测包含此检查，训练中逐次先扣半成，仍须余量足够才练，均在176日终段余额按零重新起算之前，不挪用177日以后的恢复。试注前须已停止实战灌注、自然散热至少一刻钟，确认剑脊与柄不再灼热，并符合本人握剑伤限；只在身边无人、剑锋不指人的安全位置，以本人凝元真元缓慢注入后主动收注，不形成外放剑芒或风刃，不挥击、不御剑、不切物。一次最多三息，半成是整次上限和固定支出，不因延长或多试免费；听到异响、剑柄灼热、掌痛或导气不稳即停注，已付不退，剑停用待检修和复验，不靠反复灌注把异常压下去。正常检查虽可轻微温升，不达到实战灌注的热负荷；收注后须再触验剑脊与柄仍不灼热，才算检查通过，不另循环要求再做一次同样试注。若实际升至灼热则本次失败，依异常停用处理。检查不启动攻击、不修复损坏、不回补真元、不消除旧伤，也不改变完整剑诀后的原冷却要求；玄府元罡仍不得灌入本剑。');

const restored = structuredClone(candidate);
const restoredArtifact = restored.worldPack.artifacts.find(item => item.id === 'art_03');
restoredArtifact.cost = original.cost;
restoredArtifact.limitations = original.limitations;
assert.deepEqual(restored, base);
assert.equal(candidate.plan.chapters.length, 50);
assert.equal(candidate.plan.targetChapterCount, 100);
assert.equal(candidate.plan.volumeCount, 3);
// Existing four paid checks already use exactly half a unit; the proposal
// supplies their missing shared rule without silently changing those accounts.
const accounts = [
  { day: 184, before: 8, cost: 0.5, recovery: 1.5, after: 9 },
  { day: 239, before: 5, cost: 0.5, recovery: 0.5, after: 5 },
  { day: 252, before: 3, recovery: 1, cost: 0.5, after: 3.5 },
  { day: 290, before: 4.5, cost: 0.5, recovery: 0, after: 4 },
];
for (const account of accounts) assert.equal(account.before - account.cost + account.recovery, account.after);
const candidatePath = 'data/design-candidates/design68-sword-inspection-draft-v13.json';
const output = JSON.stringify(candidate, null, 2) + '\n';
const proof = {
  kind: 'unapplied_sword_inspection_author_proposal',
  basePath, baseSha256: sha(bytes), candidatePath, candidateSha256: sha(output),
  baseInputHash: inputs.power.inputHash,
  finding: { runId: 'design_run_1a9589a8-f222-4b9b-861c-99adc2d45c80', stageId: 'batch-5', criterion: 'costs', finalReport: false },
  changedPaths: ['worldPack.artifacts[art_03].cost', 'worldPack.artifacts[art_03].limitations'],
  proposedArtifact: artifact,
  relatedSources: inputs.power.sources.filter(s => /低流量试注|复用检查|试注半成/.test(s.text)).map(s => ({ id: s.id, sha256: sha(s.text) })),
  relatedSourcesLimitation: 'Literal navigation inventory, not exhaustive semantic dependency analysis.',
  accounts, preservedAllOtherFieldsExactly: true,
  inheritedUnreviewedProposal: 'v12 pre-rescue cold protection remains unapplied and unaccepted.',
  modelCalls: 0, productionWrites: 0, questionsClosed: 0, designApproved: false,
  validationLimit: 'Arithmetic and exact edit scope only; not model acceptance, complete request-capacity validation, or a persistence rehearsal. Await all four formal reports and reconcile any additional findings before application.',
};
fs.writeFileSync(candidatePath, output, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-sword-inspection-draft.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ candidatePath, candidateSha256: proof.candidateSha256, changedPaths: proof.changedPaths, productionWrites: 0 }));
