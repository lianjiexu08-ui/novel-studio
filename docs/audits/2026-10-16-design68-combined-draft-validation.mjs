// Preserve v15, shorten wording only, and run the real candidate contracts.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
const basePath = 'data/design-candidates/design68-vessel-parties-draft-v15.json';
const bytes = fs.readFileSync(basePath);
assert.equal(sha(bytes), '8a7fb6677267e32638b21f5c61739e790ee1f83e9192d46fab049ad1f3635125');
const base = JSON.parse(bytes), candidate = structuredClone(base);
const chapter = candidate.plan.chapters.find(c => c.chapterNumber === 23);
const bibleChapter = candidate.storyBible.chapterPlans.find(c => c.chapterNumber === 23);
const original = chapter.scenes[2];
assert.equal(original, bibleChapter.requiredEvents[2]);
assert.equal(original.length, 508);
const before = '作者执行重量：本次车身与散装料总重明确为';
const after = '作者账：车身与散料共';
assert.equal(original.split(before).length, 2);
chapter.scenes[2] = original.replace(before, after);
bibleChapter.requiredEvents[2] = chapter.scenes[2];
assert.ok(chapter.scenes[2].length <= 500);
const restored = structuredClone(candidate);
restored.plan.chapters.find(c => c.chapterNumber === 23).scenes[2] = original;
restored.storyBible.chapterPlans.find(c => c.chapterNumber === 23).requiredEvents[2] = original;
assert.deepEqual(restored, base);
const binding = JSON.parse(fs.readFileSync('data/audit-runtimes/design68-runtime-bound.json'));
for (const [path, expected] of Object.entries(binding.sourceHashes)) {
  assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
}
const { validateDesignCandidate } = await import(`${binding.runtimePath}/packages/application/src/design-candidate.ts`);
const validation = validateDesignCandidate(candidate);
assert.equal(validation.valid, true, JSON.stringify(validation.issues));
assert.equal(validation.blockers.length, 41);
assert.equal(candidate.plan.chapters.length, 50);
assert.equal(candidate.plan.targetChapterCount, 100);
assert.equal(candidate.plan.volumeCount, 3);
const candidatePath = 'data/design-candidates/design68-combined-draft-v16.json';
const output = JSON.stringify(candidate, null, 2) + '\n';
const proof = {
  kind: 'unapplied_combined_draft_contract_validation',
  basePath, baseSha256: sha(bytes), candidatePath, candidateSha256: sha(output),
  changedPaths: ['plan.chapters[chapter-23].scenes[2]', 'storyBible.chapterPlans[chapter-plan-23].requiredEvents[2]'],
  wordingChange: { before, after }, previousSceneLength: original.length, currentSceneLength: chapter.scenes[2].length,
  preservedAllOtherFieldsExactly: true, mirroredFieldsEqual: true,
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length, validation,
  modelCalls: 0, productionWrites: 0, questionsClosed: 0, designApproved: false,
  limitation: 'API schema, normalization and structural-reference validation only. All inherited author proposals remain unapplied and semantically unaccepted. No fresh formal input binding, atomic-save rehearsal, or prose generation.',
};
fs.writeFileSync(candidatePath, output, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-combined-draft-validation.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ candidatePath, candidateSha256: proof.candidateSha256, sceneLength: chapter.scenes[2].length, valid: validation.valid, blockers: validation.blockers.length, productionWrites: 0 }));
