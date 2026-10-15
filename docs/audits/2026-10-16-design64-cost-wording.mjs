import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateDesignCandidate } from '../../packages/application/src/design-candidate.ts';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourcePath = 'data/design-candidates/design64-opening-budget-checks-draft-v9.json';
const sourceBytes = fs.readFileSync(sourcePath);
assert.equal(hash(sourceBytes), 'b59b6d84abaab658b8d6152c2ebe4242dfe2ed15cbd3a3d1f29f514db8dfd5a4');
const source = JSON.parse(sourceBytes), candidate = structuredClone(source);
const techniqueIndex = candidate.worldPack.techniques.findIndex(t => t.id === 'tech_06');
const axiomIndex = candidate.worldPack.axioms.findIndex(t => t.id === 'ax_12');
assert.ok(techniqueIndex >= 0 && axiomIndex >= 0);
const changes = [
  { path: ['worldPack', 'techniques', techniqueIndex, 'cost'], sourceId: 'world/techniques/tech_06',
    before: '支付三成本人当境健康稳定法力上限', after: '支付本人当境健康稳定法力上限的三成' },
  { path: ['worldPack', 'techniques', techniqueIndex, 'limitations', 2], sourceId: 'world/techniques/tech_06',
    before: '支付三成本人当境健康稳定法力上限', after: '支付本人当境健康稳定法力上限的三成' },
  { path: ['worldPack', 'axioms', axiomIndex, 'content'], sourceId: 'world/axioms/ax_12',
    before: '预付一成本人当境健康稳定元罡上限', after: '预付本人当境健康稳定元罡上限的一成' },
];
for (const change of changes) {
  const parent = change.path.slice(0, -1).reduce((v, key) => v[key], candidate), key = change.path.at(-1);
  const value = parent[key]; assert.equal(value.split(change.before).length, 2);
  change.originalField = value;
  parent[key] = value.replace(change.before, change.after);
  change.proposedField = parent[key];
}
const restored = structuredClone(candidate);
for (const change of changes) {
  const parent = change.path.slice(0, -1).reduce((v, key) => v[key], restored);
  parent[change.path.at(-1)] = change.originalField;
}
assert.deepEqual(restored, source, 'Only the three declared word-order clarifications may change');
assert.deepEqual(candidate.plan, source.plan); assert.deepEqual(candidate.storyBible, source.storyBible);
const validation = validateDesignCandidate(candidate);
assert.equal(validation.valid, true, JSON.stringify(validation.issues));
assert.equal(validation.blockers.length, 41);
assert.equal(candidate.plan.chapters.flatMap(c => c.executionChecks ?? []).length, 40);
const checkpointBytes = fs.readFileSync('data/audit-runtimes/design64-control/result.json');
const checkpoint = JSON.parse(checkpointBytes), run = checkpoint.runs.find(r => r.input.area === 'power');
const stage = run?.stages.find(s => s.id === 'cross-1-2');
assert.ok(stage?.result);
const findings = stage.result.checks.filter(c => ['tiers', 'costs'].includes(c.criterion) && c.verdict === 'revise');
assert.equal(findings.length, 2);
const candidatePath = 'data/design-candidates/design64-cost-wording-draft-v10.json';
const bytes = JSON.stringify(candidate, null, 2) + '\n';
fs.writeFileSync(candidatePath, bytes, { flag: 'wx' });
const proof = { kind: 'proposed_cost_word_order_clarification', observedAt: new Date().toISOString(), sourcePath,
  sourceSha256: hash(sourceBytes), candidatePath, candidateSha256: hash(bytes),
  inputHash: run.input.inputHash, runId: run.id, stageId: stage.id,
  resultSha256: hash(JSON.stringify(stage.result)), modelResponsesSha256: hash(JSON.stringify(stage.modelResponses)),
  originalFindings: findings, changes, validation,
  assessment: '三成＋本人在原句连写为“三成本人”，并非与“三成”不同的数值。本草案调整语序消除误断句；同类的一成元罡上限同步澄清，不改比例、计费基准、账户、施术时点、寿储、伤损或恢复规则。原返修记录保留。',
  preservedExecutionChecks: 40, unresolvedBlockers: 41, planAndBibleUnchanged: true,
  productionWrites: 0, modelCalls: 0, applied: false, formalVerdictsOverridden: false, questionsResolved: 0,
  designApproved: false, proseGenerated: false,
  limitation: '结构校验与精确字段差异不等于语义通过。四领域评审结束后与其他发现合并，再应用并重新评审；不要在正式评审期间替换输入。' };
fs.writeFileSync('docs/audits/2026-10-16-design64-cost-wording.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ candidatePath, sha256: proof.candidateSha256, changedFields: changes.length, blockers: 41, applied: false }));
