// Clarify the unapplied cold-protection proposal's vessel/crew attribution.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
const basePath = 'data/design-candidates/design68-personal-load-draft-v14.json';
const bytes = fs.readFileSync(basePath);
assert.equal(sha(bytes), 'd90070e88c59d7eb615eea8f648de36d20b78db42166f65553654a02431116de');
const base = JSON.parse(bytes), candidate = structuredClone(base);
const id = 'ms_v2_boundary';
const milestone = candidate.plan.milestones.find(m => m.id === id);
const changes = [];
function edit(key, index, replacements, suffix = '') {
  const before = index === null ? milestone[key] : milestone[key][index];
  let after = before;
  for (const [old, value] of replacements) {
    assert.ok(after.includes(old), old);
    after = after.replaceAll(old, value);
  }
  after += suffix;
  assert.notEqual(after, before);
  if (index === null) milestone[key] = after;
  else milestone[key][index] = after;
  changes.push({ key, index, before, after });
}
edit('setup', 2, [['船方当面', '押运货船方当面']]);
edit('setup', 3, [
  ['船方为', '押运货船方为'], ['原船长与当班船工', '押运货船船长与当班货船船工'],
  ['两名原船工轮班', '该货船原两名值炉船工轮班'], ['原船方库存', '押运货船方库存'],
  ['船方已收回', '押运货船方已收回'],
]);
edit('setup', 4, [
  ['原船方', '押运货船方'], ['原船长', '押运货船船长'],
  ['两名原船工', '该货船原两名值炉船工'], ['船长保留', '押运货船船长保留'],
]);
edit('setup', 5, [
  ['船方把', '押运货船方把'], ['船方代答', '押运货船方代答'],
  ['船上原航簿', '押运货船原航簿'], ['船方单据', '押运货船方单据'],
]);
edit('setup', 17, [
  ['行动前原船方已', '行动前港内救助舟承运方已'], ['两船工', '本舟原两名船工'],
], ' 此处救助舟承运方及其原两名救助船工，与扣工押运货船方及其原两名值炉船工分别归属不同船只、不是同一经营方或同两个人；救助舟的20只支付本次港内船班，不能计为押运货船方的新收入，也不抵其160款下的101支出。');
edit('setup', 20, [
  ['原船方柜台', '原港内救助舟承运方柜台'], ['船方签明', '救助舟承运方签明'], ['两船工', '本舟两名船工'],
]);
edit('cost', null, [['获救前供给另由原船方', '获救前供给另由押运货船方']]);
const restored = structuredClone(candidate);
const restoredMilestone = restored.plan.milestones.find(m => m.id === id);
for (const { key, index, before } of changes) {
  if (index === null) restoredMilestone[key] = before;
  else restoredMilestone[key][index] = before;
}
assert.deepEqual(restored, base);
// Only attribution changed: each edited paragraph retains its numeric literals.
for (const { before, after, index } of changes) {
  const text = index === 17 ? after.slice(0, after.indexOf(' 此处救助舟承运方')) : after;
  assert.deepEqual(text.match(/\d+/g), before.match(/\d+/g));
}
assert.equal(candidate.plan.chapters.length, 50);
assert.equal(candidate.plan.targetChapterCount, 100);
const candidatePath = 'data/design-candidates/design68-vessel-parties-draft-v15.json';
const output = JSON.stringify(candidate, null, 2) + '\n';
const proof = {
  kind: 'unapplied_vessel_operator_and_crew_attribution_clarification',
  basePath, baseSha256: sha(bytes), candidatePath, candidateSha256: sha(output),
  changedPaths: changes.map(({ key, index }) => `plan.milestones[${id}].${key}${index === null ? '' : `[${index}]`}`),
  changes, preservedAllOtherFieldsExactly: true,
  accounts: { captiveCarrier: '160−101=59; belongs to the captive cargo carrier', rescueBoat: '20 paid from the port relief240; belongs to the separate local rescue operator' },
  modelCalls: 0, productionWrites: 0, questionsClosed: 0, formalAcceptance: false,
  limitation: 'Clarifies an ambiguity introduced by the unapplied v12 proposal. Different operators and crews are explicit new author choices, not recovered historical facts. All inherited drafts remain unaccepted; await complete reviews, combined validation and persistence rehearsal.',
};
fs.writeFileSync(candidatePath, output, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-vessel-parties-draft.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ candidatePath, candidateSha256: proof.candidateSha256, changedFields: changes.length, productionWrites: 0 }));
