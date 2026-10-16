// Offline proposal only: never write a live work or interrupt its review.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateDesignCandidate } from '../packages/application/src/design-candidate.ts';
const read = p => JSON.parse(fs.readFileSync(p));
const hash = x => createHash('sha256').update(x).digest('hex');
const appliedPath = 'docs/audits/2026-10-17-design70-applied.json';
const applied = read(appliedPath);
const originalBytes = fs.readFileSync(applied.candidatePath);
assert.equal(hash(originalBytes), applied.candidateSha256);
const original = JSON.parse(originalBytes);
const candidate = structuredClone(original);
const inputsPath = 'data/audit-runtimes/design70-review/inputs.json';
const baseline = read('data/audit-runtimes/design70-review/baseline.json');
assert.equal(hash(fs.readFileSync(inputsPath)), baseline.inputsSha256);
assert.equal(applied.inputHash, baseline.inputHash);
const sources = read(inputsPath).world.sources;
const profile = candidate.storyBible.characters.find(c => c.id === 'char_04');
const chapter = candidate.plan.chapters.find(c => c.chapterNumber === 14);
const bibleChapter = candidate.storyBible.chapterPlans.find(c => c.chapterNumber === 14);
assert.deepEqual(profile, JSON.parse(sources.find(s => s.id === 'story/characters/char_04').text));
assert.deepEqual(chapter, JSON.parse(sources.find(s => s.id === 'plan/chapters/14').text));
assert.deepEqual(bibleChapter, JSON.parse(sources.find(s => s.id === 'story/chapterPlans/chapter-plan-14').text));
const market = candidate.worldPack.locations.find(l => l.id === 'loc_30');
assert.ok(market.entryConditions.some(s => s.includes('不是枉死黑窟总坛的外围')));
assert.equal(profile.locationId, 'loc_10');
profile.locationId = 'loc_30';
profile.identity += ' 作者开篇位置：本轮矿务行动期间，墨在青灵坊市普通后街接收外围信使的实体回报；第14章接报不发生于枉死黑窟总坛或幽冥死渊。其宗门称谓只说明身份，不证明具备总坛血契、血税或死渊防护条件；后续若安排进入这些地点，须另核原有门槛。';
const beforeSummary = '另一边，墨幽屠收到矿道行动失败的实体回报';
const afterSummary = '另一边，墨幽屠在青灵坊市普通后街等到徒步赶来的信使，收到矿道行动失败的实体回报';
assert.ok(chapter.summary.includes(beforeSummary));
assert.equal(bibleChapter.purpose, chapter.summary);
chapter.summary = chapter.summary.replace(beforeSummary, afterSummary);
bibleChapter.purpose = chapter.summary;
assert.ok(chapter.location.includes('loc_10枉死黑窟总坛'));
chapter.location = chapter.location.replace('loc_10枉死黑窟总坛', 'loc_30青灵坊市普通后街');
assert.ok(bibleChapter.locationIds.includes('loc_10'));
bibleChapter.locationIds = bibleChapter.locationIds.map(id => id === 'loc_10' ? 'loc_30' : id);
const oldScene = '枉死黑窟中，迟到的信使把矿道行动失败的实体回报交给墨幽屠；墨收起未炼成的万鬼幡图谱，改令手下筹备下一期可掳走的采集者与泉液去向。';
const newScene = '青灵坊市人流渐散的普通后街，墨幽屠等到沿外山公共道路徒步赶来的信使，当面接过矿道行动失败的纸报。此处是集镇公共街面，双方没有进入总坛、死渊或商铺内室，也不在现场交易、施术或私斗。墨看完纸报，收起未炼成的万鬼幡图谱，低声改令手下筹备下一期可掳走的采集者与泉液去向；消息只到在场收报者，林苏不在这条街上。';
assert.equal(chapter.scenes.filter(s => s === oldScene).length, 1);
assert.equal(bibleChapter.requiredEvents.filter(s => s === oldScene).length, 1);
chapter.scenes = chapter.scenes.map(s => s === oldScene ? newScene : s);
bibleChapter.requiredEvents = bibleChapter.requiredEvents.map(s => s === oldScene ? newScene : s);
chapter.executionChecks = [...(chapter.executionChecks ?? []), {
  id: 'mo-public-message-location',
  requirement: '墨在青灵坊市普通公共后街等信使沿外山公共道路徒步到场，收到矿道失败纸报后才改令。该场不进入总坛或死渊，不借少主身份取得准入、防护或新增法宝；图谱仍未炼成王器，林苏不因读者看到接报而知情。',
}];
assert.deepEqual(candidate.worldPack, original.worldPack);
assert.deepEqual(candidate.storyBible.unresolvedQuestions, original.storyBible.unresolvedQuestions);
assert.deepEqual(candidate.plan.openQuestions, original.plan.openQuestions);
assert.deepEqual(candidate.storyBible.relationships, original.storyBible.relationships);
assert.deepEqual(candidate.storyBible.arcBeats, original.storyBible.arcBeats);
const changes = [];
function diff(a,b,path='') {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a),...Object.keys(b)])) diff(a[key],b[key],`${path}/${key}`);
  } else changes.push({path,before:a,after:b});
}
diff(original,candidate);
const ci=candidate.storyBible.characters.indexOf(profile), pi=candidate.plan.chapters.indexOf(chapter), bi=candidate.storyBible.chapterPlans.indexOf(bibleChapter);
const allowed = new Set([
  `/storyBible/characters/${ci}/locationId`, `/storyBible/characters/${ci}/identity`,
  `/storyBible/chapterPlans/${bi}/purpose`, `/storyBible/chapterPlans/${bi}/locationIds/2`,
  `/storyBible/chapterPlans/${bi}/requiredEvents/5`, `/plan/chapters/${pi}/summary`,
  `/plan/chapters/${pi}/location`, `/plan/chapters/${pi}/scenes/5`, `/plan/chapters/${pi}/executionChecks`,
]);
assert.equal(changes.length,allowed.size);
assert.ok(changes.every(c=>allowed.has(c.path)));
const validation=validateDesignCandidate(candidate);
assert.equal(validation.valid,true);
assert.equal(validation.blockers.length,41);
assert.equal(candidate.plan.chapters.length,50);
assert.equal(candidate.plan.targetChapterCount,100);
assert.equal(candidate.plan.chapters.flatMap(c=>c.executionChecks??[]).length,41);
const candidatePath='data/design-candidates/design70-entry-location-v1.json';
const proofPath='docs/audits/2026-10-17-design70-entry-candidate.json';
assert.ok(!fs.existsSync(candidatePath)&&!fs.existsSync(proofPath),'Preserve prior candidate and proof');
const candidateBytes=JSON.stringify(candidate,null,2)+'\n';
const proof={kind:'design70_entry_location_offline_candidate',preparedAt:new Date().toISOString(),
  workId:applied.workId,basePlanId:applied.appliedPlanId,expectedInputHash:applied.inputHash,
  sourceCandidatePath:applied.candidatePath,sourceCandidateSha256:applied.candidateSha256,
  candidatePath,candidateSha256:hash(candidateBytes),changes,validation,
  retainedBlockingQuestions:41,executionChecks:41,modelCalls:0,productionWrites:0,formalAcceptance:false,
  nextSteps:'Reconcile completed formal review, review this changed location and initial position, rehearse preserving history, then save as a new proposal. Do not apply while the design70 worker is live.',
  limitations:['Structural validity does not prove narrative quality or adequate concealment in a public market.',
    'The candidate changes current opening placement, not the world entry rules or the character’s historic training.',
    'Existing design and prose history remain untouched; no old review passes this changed proposal.']};
fs.writeFileSync(candidatePath,candidateBytes,{flag:'wx'});
fs.writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({candidatePath,candidateSha256:proof.candidateSha256,changes:changes.length,valid:validation.valid,blockers:validation.blockers.length,productionWrites:0,formalAcceptance:false}));
