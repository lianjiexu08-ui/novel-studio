// Prepare a detached correction; do not replace the live review's frozen input.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateDesignCandidate} from '../packages/application/src/design-candidate.ts';

const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const priorProofPath = 'docs/audits/2026-10-18-design76-followup-counters-v2.json';
const prior = read(priorProofPath), base = read(prior.candidatePath);
assert.equal(hash(base), prior.candidateSha256);
const control = 'data/audit-runtimes/design76-citation-edits-review';
const inputsPath = `${control}/inputs.json`, inputs = read(inputsPath);
const startPath = `${control}/model-calls/00046.started.json`;
const responsePath = `${control}/model-calls/00046.response.json`;
const start = read(startPath), response = read(responsePath);
assert.equal(start.step.area, 'story');
assert.equal(start.step.stageId, 'cross-1-4');
const answer = JSON.parse(response.response.text);
assert.equal(answer.checks.find(c => c.criterion === 'causality').verdict, 'revise');
assert.equal(answer.checks.find(c => c.criterion === 'payoff').verdict, 'revise');
const source = id => {
  const s = inputs.story.sources.find(s => s.id === id);
  assert.ok(s, id);
  return s;
};
const chapter33 = base.plan.chapters.find(c => c.chapterNumber === 33);
const bible33 = base.storyBible.chapterPlans.find(c => c.chapterNumber === 33);
const relationship = base.storyBible.relationships.find(r => r.id === 'rel_17');
const milestone = base.plan.milestones.find(m => m.id === 'ms_v2_loss');
for (const [id, value] of [
  ['plan/chapters/33', chapter33], ['story/chapterPlans/bible-chapter-33', bible33],
  ['story/relationships/rel_17', relationship], ['plan/milestones/ms_v2_loss', milestone],
]) assert.deepEqual(JSON.parse(source(id).text), value);
assert.ok(bible33.endHook.includes('尚不知道严涛身份'));
assert.ok(chapter33.endState.includes('林确认严身份'));
assert.equal(relationship.stages[0].sinceChapter, 33);
assert.equal(relationship.stages[0].untilChapter, 33);
assert.ok(relationship.stages[0].cause.includes('33林核出海上押货者是严'));
const setupIndex = milestone.setup.findIndex(s => s.includes('33章才核对严涛身份'));
assert.ok(setupIndex >= 0);
assert.ok(JSON.parse(source('plan/chapters/35').text).summary.includes('222日侧门册补出严工牌'));

const candidate = structuredClone(base), changes = [];
const targetChapter = candidate.plan.chapters.find(c => c.chapterNumber === 33);
const targetRelationship = candidate.storyBible.relationships.find(r => r.id === 'rel_17');
const targetMilestone = candidate.plan.milestones.find(m => m.id === 'ms_v2_loss');
const change = (object, key, value, sourceId, field) => {
  changes.push({sourceId, field, before: object[key], after: value});
  object[key] = value;
};
change(targetChapter, 'endState', chapter33.endState.replace(
  '林确认严身份、程拒接且要求全赔',
  '林尚未确认严涛身份，只确认程拒接且要求全赔；侧门报空、搬箱与领箱属于独立视角，不能成为林此时的见闻'
), 'plan/chapters/33', 'endState');
change(targetMilestone.setup, setupIndex, milestone.setup[setupIndex].replace(
  '33章才核对严涛身份；34章常钧说明215日暂存和217日抬至侧门，未见领货便条和去向，',
  '第33章林尚未确认严涛身份；34章与被救押货者当面对话，常钧说明215日暂存和217日抬至侧门，未见领货便条和去向；35章取得侧门册后核对严涛工牌与陆沉川姓名，册上记录仍不等于查明箱内去向；'
), 'plan/milestones/ms_v2_loss', `setup[${setupIndex}]`);
change(targetRelationship.stages[0], 'value',
  '林记得风暴中被救押货者及其私推动作，尚未确认其姓名身份，也不知道六号箱去向。',
  'story/relationships/rel_17', 'stages[0].value');
change(targetRelationship.stages[0], 'cause',
  '32章林亲见私推并先救人，33章只确认正式仓五箱、程记拒接和全赔争议；未在侧门交接现场。',
  'story/relationships/rel_17', 'stages[0].cause');
change(targetRelationship.stages[0], 'cost',
  '林仍承担自己救人离位的复核，不能把疑点写成已查清的私挪全貌或幕后定论。',
  'story/relationships/rel_17', 'stages[0].cost');
change(targetRelationship.stages[1], 'cause',
  relationship.stages[1].cause + '35章实际取得侧门册后才核对严的工牌与陆沉川姓名，仍不能由底册直接认定赃物内容和幕后。',
  'story/relationships/rel_17', 'stages[1].cause');

// Restore the exact allowed fields and verify no other candidate content changed.
const restored = structuredClone(candidate);
restored.plan.chapters.find(c => c.chapterNumber === 33).endState = chapter33.endState;
restored.plan.milestones.find(m => m.id === 'ms_v2_loss').setup[setupIndex] = milestone.setup[setupIndex];
restored.storyBible.relationships.find(r => r.id === 'rel_17').stages = structuredClone(relationship.stages);
assert.deepEqual(restored, base);
assert.equal(changes.length, 6);
assert.ok(changes.every(c => c.before !== c.after));
const validation = validateDesignCandidate(candidate);
assert.equal(validation.valid, true);
assert.equal(validation.blockers.length, 41);
assert.deepEqual(validation.blockers, validateDesignCandidate(base).blockers);
const candidatePath = 'data/design-candidates/design76-followup-controls-v3.json';
const proofPath = 'docs/audits/2026-10-18-design76-followup-knowledge-v3.json';
const evidenceIds = ['plan/chapters/32', 'plan/chapters/33', 'plan/chapters/34', 'plan/chapters/35',
  'story/chapterPlans/bible-chapter-33', 'story/relationships/rel_17', 'story/secrets/sec_04', 'plan/milestones/ms_v2_loss'];
const proof = {
  kind: 'design76_unapplied_knowledge_boundary_candidate',
  previousCandidatePath: prior.candidatePath, previousCandidateSha256: hash(base),
  priorProofPath, priorProofSha256: fileHash(priorProofPath),
  candidatePath, candidateSha256: hash(candidate),
  inputsPath, inputsSha256: fileHash(inputsPath), expectedInputHash: inputs.story.inputHash,
  startPath, startSha256: fileHash(startPath), responsePath, responseSha256: fileHash(responsePath),
  modelFinding: {runId: start.step.runId, stageId: start.step.stageId,
    checks: answer.checks.filter(c => ['causality', 'payoff'].includes(c.criterion))},
  manualExtension: 'The same premature identity claim also occurs in rel_17 stage 33 and ms_v2_loss. These were checked against the original chapter plan, chapter 35 ledger and sec_04 knowledge stages; fixing only chapter 33 would leave contradictory instructions.',
  sourceHashes: evidenceIds.map(id => ({id, sha256: hash(source(id))})), changes, validation,
  modelCalls: 0, productionWrites: 0, blockersClosed: 0, formalAcceptance: false,
  limitation: 'Detached structural validation only. Inherits the previous artifact/control and message corrections; the new story/relationship edits need semantic review. All original reviews and live inputs remain unchanged. No approval or prose expansion.',
};
if (process.argv.includes('--check')) {
  assert.deepEqual(read(candidatePath), candidate);
  assert.deepEqual(read(proofPath), proof);
} else {
  assert.ok(!fs.existsSync(candidatePath) && !fs.existsSync(proofPath));
  fs.writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + '\n', {flag: 'wx'});
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', {flag: 'wx'});
}
console.log(JSON.stringify({candidatePath, fieldsChanged: changes.length, valid: true,
  blockers: validation.blockers.length, productionWrites: 0, semanticReviewComplete: false}));
