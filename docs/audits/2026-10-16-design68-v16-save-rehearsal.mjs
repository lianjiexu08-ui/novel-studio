// Save/reload only an isolated SQLite backup; never apply to production.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = process.cwd();
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const fileHash = file => sha(fs.readFileSync(file));
const clean = value => JSON.parse(JSON.stringify(value));
const binding = read('data/audit-runtimes/design68-runtime-bound.json');
const baseline = read('data/audit-runtimes/design68-review/baseline.json');
const input = read('data/audit-runtimes/design68-review/v16-save-rehearsal-input.json');
const productionPath = fs.realpathSync(path.join(root, 'data/novel-studio.db'));
const snapshotPath = fs.realpathSync(input.snapshot);
assert.notEqual(snapshotPath, productionPath);
assert.ok(path.basename(path.dirname(snapshotPath)).startsWith('novel-design68-v16-save-'));
assert.notDeepEqual([fs.statSync(snapshotPath).dev, fs.statSync(snapshotPath).ino], [fs.statSync(productionPath).dev, fs.statSync(productionPath).ino]);
const candidatePath = 'data/design-candidates/design68-combined-draft-v16.json';
const candidateSha256 = fileHash(candidatePath);
assert.equal(candidateSha256, '0a8d5884ae8def3e6fedf69d276b047b9ca6499f2e7d3f63841d0e52c941a51c');
for (const [name, expected] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(path.join(binding.runtimePath, name)), expected, name);
process.env.DATABASE_URL = `file:${snapshotPath}`;
const { PrismaWorkRepository } = await import(`${binding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const { ChapterWorkflow } = await import(`${binding.runtimePath}/packages/application/src/index.ts`);
const { qualityAuditFor } = await import(`${binding.runtimePath}/novel-service-core/src/core.ts`);
const { designReviewHash, designReviewInput } = await import(`${binding.runtimePath}/novel-service-core/src/design-review.ts`);
const { createDesignReviewRun, designReviewStageInput, designReviewCapacity } = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const candidate = read(candidatePath);
const preservedMaps = ['plans', 'designHistory', 'versions', 'events', 'manuscripts', 'candidates', 'designReviewRuns', 'designContentReviews'];
const mapHashes = work => Object.fromEntries(preservedMaps.map(key => [key, [...work[key]].map(([id, value]) => [id, hash(value)])]));
const repo = new PrismaWorkRepository();
let before, saved, oldChapterChecks, after;
try {
  const work = await repo.get(baseline.workId);
  assert.ok(work);
  assert.equal(designReviewHash(work, baseline.planId), baseline.inputHash);
  assert.equal(work.plans.size, 68);
  before = { maps: mapHashes(work), activePlanId: work.activePlanId, constraintRevision: work.constraintRevision };
  oldChapterChecks = work.plans.get(baseline.planId).plan.chapters.map(chapter => [chapter.chapterNumber, chapter.executionChecks]);
  const workflow = new ChapterWorkflow(repo, { generateChapter() { throw new Error('No prose in isolated rehearsal'); } });
  saved = await workflow.saveDesignCandidate(work.id, { basePlanId: baseline.planId, expectedInputHash: baseline.inputHash, candidate,
    note: '隔离保存演练：救援前保暖、剑器复用检查、个人推重实测及船方归属合并草案；未通过正式内容评审，不采纳到生产。' });
  assert.equal(saved.plan.status, 'proposed');
} finally { await repo.disconnect(); }
const restarted = new PrismaWorkRepository();
try { after = await restarted.get(baseline.workId); }
finally { await restarted.disconnect(); }
assert.ok(after);
for (const key of preservedMaps) {
  for (const [id, expected] of before.maps[key]) assert.equal(hash(after[key].get(id)), expected, `${key}/${id}`);
  assert.equal(after[key].size, before.maps[key].length + (key === 'plans' ? 1 : key === 'designHistory' ? 2 : 0));
}
assert.equal(after.activePlanId, before.activePlanId);
assert.equal(after.constraintRevision, before.constraintRevision + 1);
assert.equal(after.plans.get(after.activePlanId).revision, 10);
const restored = after.plans.get(saved.plan.id);
assert.equal(restored.revision, 69);
assert.equal(restored.status, 'proposed');
assert.deepEqual(restored.plan, candidate.plan);
assert.deepEqual(after.worldPack, clean({ ...candidate.worldPack, revision: 35, status: 'proposed', lockedAt: undefined }));
assert.deepEqual(after.storyBible, clean({ ...candidate.storyBible, revision: 66, status: 'proposed', lockedAt: undefined,
  worldPackId: after.worldPack.id, worldPackRevision: 35 }));
assert.deepEqual(restored.plan.chapters.map(chapter => [chapter.chapterNumber, chapter.executionChecks]), oldChapterChecks);
const executionChecks = restored.plan.chapters.flatMap(chapter => chapter.executionChecks ?? []).length;
assert.equal(executionChecks, 40);
const blockers = qualityAuditFor(after).questions.filter(question => question.blocking && question.status !== 'resolved').length;
assert.equal(blockers, 41);
const freshHash = designReviewHash(after, restored.id);
assert.notEqual(freshHash, baseline.inputHash);
const inputs = {}, areas = [];
for (const area of ['world', 'power', 'characters', 'story']) {
  const reviewInput = designReviewInput(after, area, restored.id);
  assert.equal(reviewInput.inputHash, freshHash);
  inputs[area] = reviewInput;
  const run = createDesignReviewRun(reviewInput);
  for (const source of reviewInput.sources) {
    const units = run.units.filter(unit => unit.sourceId === source.id).sort((a, b) => a.start - b.start);
    assert.equal(units[0].start, 0);
    assert.equal(units.at(-1).end, source.text.length);
    units.slice(1).forEach((unit, index) => assert.equal(unit.start, units[index].end));
    assert.ok(units.every(unit => run.stages.some(stage => stage.kind === 'batch' && stage.unitIds.includes(unit.id))));
  }
  const requests = run.stages.filter(stage => stage.kind !== 'synthesis').map(stage => {
    const request = designReviewStageInput(run, stage);
    for (const unit of request.stage.sourceMap) {
      const original = reviewInput.sources.find(source => source.id === unit.sourceId);
      assert.equal(request.sources.find(source => source.id === unit.id)?.text, original.text.slice(unit.start, unit.end));
    }
    const sourceCharacters = JSON.stringify(request.sources).length;
    const metadataCharacters = JSON.stringify(request.stage.coverage).length;
    assert.ok(sourceCharacters <= designReviewCapacity);
    assert.ok(metadataCharacters <= 40000);
    return { stageId: stage.id, sourceCharacters, metadataCharacters, sha256: hash(request) };
  });
  areas.push({ area, sources: reviewInput.sources.length, inputSha256: hash(reviewInput), requests, completeSourceCoverage: true });
}
const inputsPath = path.join(path.dirname(snapshotPath), 'fresh-review-inputs.json');
fs.writeFileSync(inputsPath, JSON.stringify(inputs), { flag: 'wx' });
const proof = {
  kind: 'isolated_v16_save_reload_and_actual_input_binding', observedAt: new Date().toISOString(),
  candidatePath, candidateSha256, snapshotPath, snapshotPreparation: input,
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  sourcePlanId: baseline.planId, sourceInputHash: baseline.inputHash,
  isolatedPlanId: restored.id, isolatedInputHash: freshHash,
  revisions: { world: 35, bible: 66, plan: 69, approvedPlan: 10 },
  retainedMapCounts: Object.fromEntries(preservedMaps.map(key => [key, before.maps[key].length])),
  oldHistoryPreservedExactly: true, savedCandidateContentMatchesExactly: true,
  allExecutionChecksPreserved: executionChecks, unresolvedBlockers: blockers,
  detailedOutlines: restored.plan.chapters.length, macroChapterTarget: restored.plan.targetChapterCount,
  inputsPath, inputsSha256: fileHash(inputsPath), areas,
  modelCalls: 0, productionWrites: 0, isolatedDesignSaves: 1, formalAcceptance: false,
  limitation: 'Only the provisional v16 candidate was saved in an isolated backup and read through a new repository connection. Fresh hashes and IDs belong only to that backup, never production. The live four-area review is unfinished; later findings may change the candidate. No semantic review, approval, prose generation, or dynamic followup verification is claimed.',
};
fs.writeFileSync('docs/audits/2026-10-16-design68-v16-save-rehearsal.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ revisions: proof.revisions, retained: proof.retainedMapCounts, executionChecks, blockers,
  initialRequests: areas.flatMap(area => area.requests).length, maxSourceCharacters: Math.max(...areas.flatMap(area => area.requests.map(request => request.sourceCharacters))),
  productionWrites: 0, modelCalls: 0, formalAcceptance: false }));
