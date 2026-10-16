import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateDesignCandidate } from '../../packages/application/src/design-candidate.ts';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourcePath = 'data/design-candidates/design64-cost-wording-draft-v10.json';
const sourceBytes = fs.readFileSync(sourcePath);
assert.equal(hash(sourceBytes), '0ae66cd4c90a9d02de50cc5cbc9d8be518b111538822bdbe8a09f94edba8d5b9');
const source = JSON.parse(sourceBytes), candidate = structuredClone(source);
const bibleIndex = candidate.storyBible.chapterPlans.findIndex(c => c.chapterNumber === 17);
const planIndex = candidate.plan.chapters.findIndex(c => c.chapterNumber === 17);
assert.ok(bibleIndex >= 0 && planIndex >= 0);
const purposeBefore = '第108日，他因害怕赶不上第120日复测，擅自延长第三段吐纳';
const purposeAfter = '第108日，他怕第120日凝元前复测不达标、压缩随后为第180日公开复核准备的训练时间，急于赶上眼前的第120日复测，擅自延长第三段吐纳';
const sceneBefore = '第108日，林辰害怕180日复核落空，仍想赶上120日计划';
const sceneAfter = '第108日，林辰急于赶上第120日凝元前复测：他担心这次不达标会压缩此后为第180日公开复核准备的训练时间；这是他对后续进度的担忧，第120日复测并不保证第180日取得古境准入';
const changes = [
  { path: ['storyBible', 'chapterPlans', bibleIndex, 'purpose'], sourceId: 'bible/chapterPlans/chapter-plan-17', before: purposeBefore, after: purposeAfter },
  { path: ['plan', 'chapters', planIndex, 'summary'], sourceId: 'plan/chapters/17', before: purposeBefore, after: purposeAfter },
  { path: ['storyBible', 'chapterPlans', bibleIndex, 'requiredEvents', 1], sourceId: 'bible/chapterPlans/chapter-plan-17', before: sceneBefore, after: sceneAfter },
  { path: ['plan', 'chapters', planIndex, 'scenes', 1], sourceId: 'plan/chapters/17', before: sceneBefore, after: sceneAfter },
];
for (const change of changes) {
  const parent = change.path.slice(0, -1).reduce((v, key) => v[key], candidate), key = change.path.at(-1);
  change.originalField = parent[key];
  assert.equal(parent[key].split(change.before).length, 2);
  parent[key] = parent[key].replace(change.before, change.after);
  change.proposedField = parent[key];
}
const restored = structuredClone(candidate);
for (const change of changes) change.path.slice(0, -1).reduce((v, key) => v[key], restored)[change.path.at(-1)] = change.originalField;
assert.deepEqual(restored, source, 'Only four declared wording fields may change');
assert.deepEqual(candidate.worldPack, source.worldPack);
assert.equal(candidate.storyBible.chapterPlans[bibleIndex].purpose, candidate.plan.chapters[planIndex].summary);
assert.deepEqual(candidate.storyBible.chapterPlans[bibleIndex].requiredEvents, candidate.plan.chapters[planIndex].scenes);
const validation = validateDesignCandidate(candidate);
assert.equal(validation.valid, true, JSON.stringify(validation.issues));
assert.equal(validation.blockers.length, 41);
assert.equal(candidate.plan.chapters.flatMap(c => c.executionChecks ?? []).length, 40);
const checkpoint = JSON.parse(fs.readFileSync('data/audit-runtimes/design64-control/result.json'));
const run = checkpoint.runs.find(r => r.input.area === 'characters');
const stage = run.stages.find(s => s.id === 'batch-3');
const findings = stage.result.checks.filter(c => ['agency', 'knowledge'].includes(c.criterion) && c.verdict === 'revise');
assert.equal(findings.length, 2);
const candidatePath = 'data/design-candidates/design64-motivation-wording-draft-v11.json';
const bytes = JSON.stringify(candidate, null, 2) + '\n';
fs.writeFileSync(candidatePath, bytes, { flag: 'wx' });
const proof = { kind: 'proposed_character_motivation_clarification', observedAt: new Date().toISOString(),
  sourcePath, sourceSha256: hash(sourceBytes), candidatePath, candidateSha256: hash(bytes),
  inputHash: run.input.inputHash, runId: run.id, stageId: stage.id,
  resultSha256: hash(JSON.stringify(stage.result)), modelResponsesSha256: hash(JSON.stringify(stage.modelResponses)),
  originalFindings: findings, changes, validation,
  assessment: '原场景同时包含180日复核与120日计划，不能据此认定日期自相矛盾。草案把近期复测目标与远期训练进度担忧的因果关系写明，并同步概要与场景；不删除任一时间点，不把担忧变成必然落选，也不把凝元前复测当作古境准入。',
  preservedExecutionChecks: 40, unresolvedBlockers: 41, worldUnchanged: true,
  productionWrites: 0, modelCalls: 0, applied: false, formalVerdictsOverridden: false,
  questionsResolved: 0, designApproved: false, proseGenerated: false,
  limitation: '结构校验不是人物质量通过。保留原评审；待本轮四领域评审结束后合并修订并重新评审。' };
fs.writeFileSync('docs/audits/2026-10-16-design64-motivation-wording.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ candidatePath, sha256: proof.candidateSha256, changedFields: changes.length, blockers: 41, applied: false }));
