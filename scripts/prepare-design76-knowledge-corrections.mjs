// Prepare an offline follow-up draft. Never imports a repository or calls a model.
// The running design76 review keeps its unchanged production inputs.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateDesignCandidate } from '../packages/application/src/design-candidate.ts';

const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const applied = read('docs/audits/2026-10-18-design76-repairs-applied.json');
const baseline = read('data/audit-runtimes/design76-recovery/baseline.json');
const inputsPath = 'data/audit-runtimes/design76-recovery/inputs.json';
assert.equal(fileHash(inputsPath), baseline.inputsSha256);
assert.equal(applied.appliedPlanId, baseline.planId);
const base = read(applied.candidatePath);
assert.equal(hash(base), applied.candidateSha256);
const inputs = read(inputsPath);
const sources = new Map(Object.values(inputs).flatMap(i => i.sources).map(s => [s.id, s]));
const candidate = structuredClone(base);
const corrections = [];

function source(id, value) {
  assert.ok(sources.has(id), id);
  assert.deepEqual(JSON.parse(sources.get(id).text), value, `Candidate differs from frozen source: ${id}`);
}

function replaceField(object, field, replacements, sourceId, fieldPath) {
  const before = object[field];
  assert.equal(typeof before, 'string');
  let after = before;
  for (const [from, to] of replacements) {
    assert.equal(after.split(from).length, 2, `Expected one exact occurrence: ${fieldPath}`);
    after = after.replace(from, to);
  }
  assert.notEqual(before, after);
  object[field] = after;
  corrections.push({sourceId, sourceTextSha256: createHash('sha256').update(sources.get(sourceId).text).digest('hex'), fieldPath, before, after});
}

const dispatch = candidate.storyBible.arcBeats.find(b => b.id === 'message-dispatch');
source('story/arcBeats/message-dispatch', dispatch);
replaceField(dispatch, 'expectedChange', [
  ['亲见林贺随巡查进附棚、两工及两看守被分别带出的报告', '看见林贺留在外院、巡员在附棚门口处置、两工自行出门后由贺陪同离开、两看守被控制的报告'],
  ['未听门内认罪', '未听见门前陆的承认与工人去留对话'],
], 'story/arcBeats/message-dispatch', 'expectedChange');

const relationship = candidate.storyBible.relationships.find(r => r.id === 'rel_02');
source('story/relationships/rel_02', relationship);
const relationIndex = relationship.stages.findIndex(s => s.cause.includes('98章439程抵乾都只自述'));
assert.ok(relationIndex >= 0);
replaceField(relationship.stages[relationIndex], 'cause', [
  ['98章439程抵乾都只自述', '98章程438抵乾都、439获见赵，只自述'],
], 'story/relationships/rel_02', `stages[${relationIndex}].cause`);

const secret = candidate.storyBible.secrets.find(s => s.id === 'sec_02');
source('story/secrets/sec_02', secret);
const knowledgeIndex = secret.knowledgeStages.findIndex(s => s.characterId === 'char_03' && s.sinceChapter === 98);
assert.ok(knowledgeIndex >= 0);
replaceField(secret.knowledgeStages[knowledgeIndex], 'trigger', [
  ['98章439程沿普通驿路抵乾都当面报', '98章程沿普通驿路438抵乾都、439获见赵当面报'],
], 'story/secrets/sec_02', `knowledgeStages[${knowledgeIndex}].trigger`);

const payoff = candidate.plan.milestones.find(m => m.id === 'ms_v3_payoff');
source('plan/milestones/ms_v3_payoff', payoff);
const payoffIndex = payoff.setup.findIndex(s => s.includes('98章439程按普通驿路到乾都面报'));
assert.ok(payoffIndex >= 0);
replaceField(payoff.setup, payoffIndex, [
  ['98章439程按普通驿路到乾都面报', '98章程按普通驿路438抵乾都、439获见赵面报'],
], 'plan/milestones/ms_v3_payoff', `setup[${payoffIndex}]`);

// Verify the repaired witness account against the unchanged primary scene,
// macro scene, and recipient knowledge, rather than only against our replacement.
const chapter50 = JSON.parse(sources.get('plan/chapters/50').text);
assert.ok(chapter50.scenes.some(s => s.includes('林贺在外院等认人')));
assert.ok(chapter50.scenes.some(s => s.includes('吴卢把门推开，自行跨过平整门槛到外院')));
const fire = JSON.parse(sources.get('plan/milestones/ms_v2_fire').text);
assert.ok(fire.setup.some(s => s.includes('未听见门前陆的承认与去留对话')));
const recipient = secret.knowledgeStages.find(s => s.characterId === 'char_03' && s.sinceChapter === 53);
assert.ok(recipient.belief.includes('林贺留外院、两工自行出门及两看守被控'));
const defeat = candidate.storyBible.arcBeats.find(b => b.id === 'message-defeat-report');
assert.ok(defeat.expectedChange.includes('438抵乾都、439获见赵'));

const validation = validateDesignCandidate(candidate);
assert.equal(validation.valid, true);
assert.equal(validation.blockers.length, 41);
assert.deepEqual(validation.blockers, validateDesignCandidate(base).blockers);
assert.deepEqual(candidate.worldPack, base.worldPack);
assert.deepEqual(candidate.plan.chapters, base.plan.chapters);
const restored = structuredClone(candidate);
restored.storyBible.arcBeats = structuredClone(base.storyBible.arcBeats);
restored.storyBible.relationships = structuredClone(base.storyBible.relationships);
restored.storyBible.secrets = structuredClone(base.storyBible.secrets);
restored.plan.milestones = structuredClone(base.plan.milestones);
assert.deepEqual(restored, base);
// Count leaf changes independently: exactly four strings, no hidden array edits.
function differences(a, b) {
  if (Object.is(a, b)) return 0;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return 1;
  assert.deepEqual(Object.keys(a), Object.keys(b));
  return Object.keys(a).reduce((n, k) => n + differences(a[k], b[k]), 0);
}
assert.equal(differences(base, candidate), 4);

const candidatePath = 'data/design-candidates/design76-followup-knowledge-v1.json';
const proofPath = 'docs/audits/2026-10-18-design76-followup-knowledge-v1.json';
assert.ok(!fs.existsSync(candidatePath));
assert.ok(!fs.existsSync(proofPath));
fs.writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + '\n', {flag: 'wx'});
const proof = {
  kind: 'design76_unapplied_knowledge_followup_draft', createdAt: new Date().toISOString(),
  workId: baseline.workId, basePlanId: baseline.planId, expectedInputHash: baseline.inputHash,
  inputsSha256: baseline.inputsSha256, baseCandidatePath: applied.candidatePath,
  baseCandidateSha256: hash(base), candidatePath, candidateSha256: hash(candidate),
  corrections, exactChangedStrings: 4, validation, worldUnchanged: true, detailedChaptersUnchanged: true,
  modelCalls: 0, productionWrites: 0, formalAcceptance: false, blockersClosed: 0,
  limitation: 'Offline factual corrections only. Power-control findings and later review findings remain open. Do not apply while the frozen design76 review is running; consolidate and review a complete follow-up candidate first.',
};
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({candidatePath, valid: true, changedStrings: 4, blockers: 41, productionWrites: 0}));
