// Unapplied author clarification, not a recovered fact or accepted repair.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
const basePath = 'data/design-candidates/design68-sword-inspection-draft-v13.json';
const bytes = fs.readFileSync(basePath);
assert.equal(sha(bytes), 'f5b1f122eb830605e54a4eb7217d5f90be85c93f9f4d8751cc71793686718ae9');
const base = JSON.parse(bytes), candidate = structuredClone(base);
const originalActor = base.storyBible.characters.find(c => c.id === 'char_04');
const actor = candidate.storyBible.characters.find(c => c.id === 'char_04');
const chapter = candidate.plan.chapters.find(c => c.chapterNumber === 23);
const bibleChapter = candidate.storyBible.chapterPlans.find(c => c.chapterNumber === 23);
const originalChapter = base.plan.chapters.find(c => c.chapterNumber === 23);
const originalBibleChapter = base.storyBible.chapterPlans.find(c => c.chapterNumber === 23);
const replaceOnce = (text, old, replacement) => {
  assert.equal(text.split(old).length, 2, old);
  return text.replace(old, replacement);
};
actor.identity = replaceOnce(actor.identity,
  '曾将不超过六百斤的无锁普通滑车沿平地滚开一步并经医修复核',
  '个人本次已测总重明确为五百斤：原训练场将无锁普通滑车连同配重实称五百斤，他按既有聚罡一息、推劲一息及二成预付规则沿平地滚开一步，随后经医修复核；此为墨自己的已测负荷，不把世界六百斤上限或顾峤三百斤实测记为墨的能力，也不是托举五百斤');
const oldSummary = '已解闸、不到六百斤的滑车';
const newSummary = '已解闸、作者执行总重四百八十斤的滑车';
chapter.summary = replaceOnce(chapter.summary, oldSummary, newSummary);
bibleChapter.purpose = replaceOnce(bibleChapter.purpose, oldSummary, newSummary);
const oldScene = '车身与散装料合重不到六百斤，轮轴可转、闸块已经由原装车看守取下，不是整辆囚笼重车；若闸未解就不得按本操作硬推。';
const newScene = '作者执行重量：本次车身与散装料总重明确为四百八十斤，低于墨开篇前已实际测过的五百斤，也低于ax_13的六百斤通用上限；这些是拟定动作的作者依据，旁观林苏秦不能仅凭看见推车就知道准确斤数或墨的训练记录。轮轴可转、闸块已经由原装车看守取下，不是整辆囚笼重车；若实际载荷超过墨的已测负荷、闸未解、地面不平或伤情复核不稳，就不得按本操作硬推，须卸料、解闸或停手，不因余额足够就保证成功。';
chapter.scenes[2] = replaceOnce(chapter.scenes[2], oldScene, newScene);
bibleChapter.requiredEvents[2] = replaceOnce(bibleChapter.requiredEvents[2], oldScene, newScene);
assert.equal(chapter.summary, bibleChapter.purpose);
assert.equal(chapter.scenes[2], bibleChapter.requiredEvents[2]);
assert.ok(480 <= 500 && 500 <= 600);
const restored = structuredClone(candidate);
restored.storyBible.characters.find(c => c.id === 'char_04').identity = originalActor.identity;
Object.assign(restored.plan.chapters.find(c => c.chapterNumber === 23), { summary: originalChapter.summary, scenes: originalChapter.scenes });
Object.assign(restored.storyBible.chapterPlans.find(c => c.chapterNumber === 23), { purpose: originalBibleChapter.purpose, requiredEvents: originalBibleChapter.requiredEvents });
assert.deepEqual(restored, base);
assert.equal(candidate.plan.chapters.length, 50);
assert.equal(candidate.plan.targetChapterCount, 100);
assert.equal(candidate.plan.volumeCount, 3);
assert.ok(candidate.storyBible.characters.find(c => c.id === 'char_10').identity.includes('个人本次已测总重只记三百斤'));
const candidatePath = 'data/design-candidates/design68-personal-load-draft-v14.json';
const output = JSON.stringify(candidate, null, 2) + '\n';
const proof = {
  kind: 'unapplied_personal_load_author_clarification',
  basePath, baseSha256: sha(bytes), candidatePath, candidateSha256: sha(output),
  reason: 'The review wrongly attributes Gu’s300 to Mo. Separately, the original two ranges under600 do not identify a single measured personal load and actual cart load. This proposal clarifies that narrower issue without treating the attribution error as true.',
  changedPaths: ['storyBible.characters[char_04].identity', 'storyBible.chapterPlans[chapter-plan-23].purpose', 'storyBible.chapterPlans[chapter-plan-23].requiredEvents[2]', 'plan.chapters[chapter-23].summary', 'plan.chapters[chapter-23].scenes[2]'],
  newAuthorValues: { worldCeilingUnchanged: 600, moMeasured: 500, cart: 480, guMeasuredUnchanged: 300 },
  proposedActorIdentity: actor.identity, proposedScene: chapter.scenes[2],
  preservedAllOtherFieldsExactly: true, mirroredChapterFieldsEqual: true,
  inheritedUnacceptedDrafts: ['v12 captive cold protection', 'v13 sword inspection'],
  modelCalls: 0, productionWrites: 0, questionsClosed: 0, formalAcceptance: false,
  limitation: 'Only edit-scope and numeric-bound checks. Exact500/480 are new fiction awaiting semantic review, not facts recovered from frozen Plan68. No claim that character knowledge, physical execution, or the complete design has been accepted.',
};
fs.writeFileSync(candidatePath, output, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-personal-load-draft.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ candidatePath, candidateSha256: proof.candidateSha256, changedPaths: proof.changedPaths, productionWrites: 0 }));
