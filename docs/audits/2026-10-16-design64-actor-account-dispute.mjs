import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayDesignReviewPrefix } from '../../scripts/audit-design-reviews.mjs';

const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const binding = read('data/audit-runtimes/design64-runtime-bound.json');
const baseline = read('data/audit-runtimes/design64-control/baseline.json');
const checkpointPath = 'data/audit-runtimes/design64-control/actor-account-checkpoint.json';
// The worker replaces its checkpoint atomically; retain one immutable observation.
fs.copyFileSync('data/audit-runtimes/design64-control/resume-3-result.json', checkpointPath, fs.constants.COPYFILE_EXCL);
const checkpoint = read(checkpointPath);
const run = checkpoint.runs.find(r => r.input.area === 'power');
assert.equal(run.input.inputHash, baseline.inputHash);
assert.equal(checkpoint.runtimeCommit, binding.commit);
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(binding.root + '/' + p), h);
const stages = await import(binding.root + '/novel-service-core/src/design-review-run.ts');
const { JsonDesignPlanner } = await import(binding.root + '/packages/planner/src/index.ts');
const replay = await replayDesignReviewPrefix(run, run.input, { ...stages, JsonDesignPlanner });
const stage = run.stages.find(s => s.id === 'followup-cross-3-5/tiers');
const check = stage.result.checks.find(c => c.criterion === 'tiers');
assert.equal(check.verdict, 'revise');
assert.ok(check.explanation.includes('第44章则同时写明林承接第43章为“四成半真元”'));

const appliedPath = 'data/design-candidates/design64-receipt-exception-draft-v7.json';
const candidatePath = 'data/design-candidates/design64-motivation-wording-draft-v11.json';
assert.equal(fileHash(appliedPath), checkpoint.candidateFileSha256);
assert.equal(fileHash(candidatePath), 'ec7d90cb870f6d35f9cfc9d1c95cc21169f97bf856940f8ef8bf2a70273c19be');
const applied = read(appliedPath), candidate = read(candidatePath);
const sources = [42, 43, 44].map(n => {
  const source = run.input.sources.find(s => s.id === `plan/chapters/${n}`);
  assert.ok(source);
  const chapter = JSON.parse(source.text);
  assert.deepEqual(chapter, applied.plan.chapters.find(c => c.chapterNumber === n));
  assert.deepEqual(chapter, candidate.plan.chapters.find(c => c.chapterNumber === n));
  return { source, chapter };
});
const [c42, c43, c44] = sources.map(s => s.chapter);
const excerpts = [
  [42, 'cost', '此次缓慢试注共耗半成，余四成半。试船之前另在原住处完成一小时不受扰温和吐纳，复测只记回半成至伤后上限五成，再赴码头；此后至244出剑前未再施术。'],
  [43, 'cost', '凝元伙计一次送钩支出半成真元，自身保守余量五成降至四成半，钩挂稳即停术'],
  [43, 'endState', '林敲钟已获岗役回应，现扶栏登船坐稳握剑，尚未施术'],
  [43, 'endState', '送钩伙计已停御物，余四成半'],
  [44, 'cost', '出剑前沿用239日复测的保守余量五成，一式二成后余三成'],
  [44, 'cost', '送钩伙计承接43章四成半真元，44章没有再施术'],
].map(([chapterNumber, field, quote]) => {
  const { source, chapter } = sources.find(s => s.chapter.chapterNumber === chapterNumber);
  assert.ok(chapter[field].includes(quote));
  return { sourceId: source.id, field, quote };
});
assert.ok(c42.scenes[1].includes('从五成降至四成半'));
assert.ok(c43.scenes[2].includes('伙计的余元是作者计划账，林没有感知他人精确余额'));
const evidence = check.evidence.find(e => e.quote.includes('送钩伙计承接43章四成半真元'));
assert.ok(evidence, 'The negative check itself quotes the distinct actor label');
const unit = run.units.find(u => u.id === evidence.sourceId);
assert.equal(unit.sourceId, 'plan/chapters/44');
assert.ok(sources[2].source.text.slice(unit.start, unit.end).includes(evidence.quote));
const accounts = [
  { actor: '林辰', basis: '本人的健康稳定真元上限；伤后允许上限五成', chapter42: { opening: 5, swordTestDebit: 0.5, afterTest: 4.5, measuredRecovery: 0.5, closing: 5 }, chapter43: { opening: 5, castDebit: 0, closing: 5 }, chapter44: { opening: 5, swordDebit: 2, closing: 3 } },
  { actor: '送钩伙计', basis: '伙计自身的真元基准，与林辰独立', chapter43: { opening: 5, hookDebit: 0.5, closing: 4.5 }, chapter44: { opening: 4.5, castDebit: 0, closing: 4.5 } },
];
assert.equal(5 - 0.5 + 0.5, accounts[0].chapter43.opening);
assert.equal(accounts[0].chapter44.opening - 2, accounts[0].chapter44.closing);
assert.equal(5 - 0.5, accounts[1].chapter44.opening);
const proof = {
  kind: 'manual_actor_account_conflation_dispute', observedAt: new Date().toISOString(),
  inputHash: run.input.inputHash, runId: run.id, stageId: stage.id, checkpointPath,
  checkpointSha256: fileHash(checkpointPath), runtimeCommit: binding.commit, replay,
  originalCheck: check, resultSha256: hash(stage.result), modelResponsesSha256: hash(stage.modelResponses),
  sources: sources.map(({ source }) => ({ id: source.id, sha256: hash(source), text: source.text })),
  excerpts, originalEvidence: evidence, sourceUnit: unit, accounts,
  appliedCandidateSha256: fileHash(appliedPath), latestCandidateSha256: fileHash(candidatePath),
  assessment: '负面解释把送钩伙计的四成半归给林辰；模型自己的引文已明确标出送钩伙计。冻结42章也已记林辰试剑后有效吐纳复测至五成，43章未施术，44章五成扣二成余三成。两个账户分别闭合，无需追加虚构恢复或改低林辰余额。',
  productionWrites: 0, modelCalls: 0, formalVerdictsOverridden: false, questionsResolved: 0, designApproved: false,
  limitation: '仅核对42—44章两个人物真元的归属及所列收支，不证明整场救援、全书力量体系或实际正文通过；保留原负面，待四领域完成后定向复评。',
};
fs.writeFileSync('docs/audits/2026-10-16-design64-actor-account-dispute.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ stageId: stage.id, replayedStages: replay.completedStages, responses: replay.responsesReplayed, actorAccounts: accounts, productionWrites: 0 }));
