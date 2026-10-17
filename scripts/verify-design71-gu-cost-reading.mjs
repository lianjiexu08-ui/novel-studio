// Preserve a model explanation error separately; do not change correct chapter plans or review history.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayDesignReviewRecord } from './audit-design-reviews.mjs';

const read = file => JSON.parse(fs.readFileSync(file));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash = file => hash(fs.readFileSync(file));
const control = 'data/audit-runtimes/design71-review';
const baseline = read(`${control}/baseline.json`);
const inputPath = `${control}/inputs.json`;
assert.equal(fileHash(inputPath), baseline.inputsSha256);
const inputs = read(inputPath);
const snapshotBytes = fs.readFileSync(`${control}/result.json`);
const checkpoint = JSON.parse(snapshotBytes);
assert.equal(checkpoint.inputHash, baseline.inputHash);
const run = checkpoint.runs.find(run => run.input.area === 'power');
assert.deepEqual(run.input, inputs.power);
const bindingPath = 'data/audit-runtimes/design71-runtime-bound.json';
assert.equal(fileHash(bindingPath), baseline.runtimeBindingSha256);
const binding = read(bindingPath);
for (const [file, expected] of Object.entries(binding.sourceHashes)) {
  assert.equal(fileHash(`${binding.runtimePath}/${file}`), expected, file);
}
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const replay = await replayDesignReviewRecord(run, inputs.power, undefined, { ...runtime, JsonDesignPlanner });
const sourceIds = ['plan/chapters/25', 'story/chapterPlans/chapter-plan-25',
  'world/axioms/ax_12', 'world/axioms/ax_13', 'world/techniques/tech_06'];
const sources = sourceIds.map(id => {
  const source = inputs.power.sources.find(source => source.id === id);
  assert.ok(source, id); return source;
});
const [plan, story, guard, push, light] = sources.map(source => JSON.parse(source.text));
const costQuote = '顾到场前元罡十成，左前臂局部护罡聚合一成、承受一次斜擦一成，共二成；真光三成后余五成，贴身推劲再预付二成后余三成。';
assert.ok(plan.cost.includes(costQuote));
assert.ok(plan.cost.includes('随后可用上限下修至六成，实际仍只有三成'));
const guardScene = plan.scenes.find(text => text.includes('顾看到墨手中短木棍斜扫'));
const lightAndPushScene = plan.scenes.find(text => text.startsWith('按同一交锋的呼吸顺序：'));
assert.ok(guardScene && lightAndPushScene);
assert.ok(story.requiredEvents.includes(guardScene));
assert.ok(story.requiredEvents.includes(lightAndPushScene));
assert.ok(guardScene.includes('付一成，承受一次斜擦另付一成'));
assert.ok(lightAndPushScene.includes('支付三成元罡和0.25元载'));
assert.ok(lightAndPushScene.includes('聚劲一息、预付二成'));
assert.ok(guard.content.includes('预付本人当境健康稳定元罡上限的一成'));
assert.ok(guard.content.includes('另预留并即时扣一成'));
assert.ok(push.content.includes('预付本人健康稳定元罡上限二成'));
assert.ok(light.cost.includes('三成') && light.cost.includes('0.25元载'));
const rows = ['followup-batch-3/counters', 'followup-cross-2-5/costs'].map(id => {
  const stage = run.stages.find(stage => stage.id === id);
  assert.ok(stage?.result && stage.modelResponses?.length);
  assert.equal(stage.result.checks.length, 1);
  const check = stage.result.checks[0];
  const request = runtime.designReviewStageInput(run, stage);
  const units = request.stage.sourceMap.filter(unit => unit.sourceId === 'plan/chapters/25').sort((a, b) => a.start - b.start);
  assert.equal(units.map(unit => request.sources.find(source => source.id === unit.id).text).join(''), sources[0].text);
  return { stageId: id, stageSha256: hash(JSON.stringify(stage)), requestSha256: hash(JSON.stringify(request)),
    criterion: check.criterion, verdict: check.verdict, explanation: check.explanation,
    modelResponses: stage.modelResponses, fullChapter25WasProvided: true };
});
const incorrectQuote = '顾的局部护罡、真光、推劲共扣五成元罡及0.25元载';
assert.ok(rows[0].explanation.includes(incorrectQuote));
assert.ok(rows[0].modelResponses.some(text => text.includes(incorrectQuote)));
assert.ok(rows[1].explanation.includes('局部护罡两成、真光三成及贴身推劲两成后余三成'));
const payments = { guard: 1 + 1, light: 3, push: 2 };
const totalSpent = Object.values(payments).reduce((sum, value) => sum + value, 0);
assert.equal(totalSpent, 7); assert.equal(10 - totalSpent, 3);
const snapshotPath = `${control}/gu-cost-reading-prefix.json`;
const proofPath = 'docs/audits/2026-10-17-design71-gu-cost-reading.json';
for (const file of [snapshotPath, proofPath]) assert.ok(!fs.existsSync(file), `Preserve prior evidence: ${file}`);
const proof = { observedAt: new Date().toISOString(), kind: 'model_explanation_arithmetic_mismatch',
  inputHash: baseline.inputHash, inputPath, inputsSha256: baseline.inputsSha256, runId: run.id,
  snapshotPath, snapshotSha256: hash(snapshotBytes), runtimeBindingSha256: fileHash(bindingPath), prefixReplay: replay,
  completeOriginalSources: sources, checks: rows, incorrectQuote, sourceCostQuote: costQuote,
  derivedAccount: { characterId: 'char_10', characterName: '顾峤', chapterNumber: 25,
    unit: '成本人健康稳定元罡', opening: 10, payments, totalSpent, remaining: 3,
    separateLifespanPayment: { value: 0.25, unit: '元载', owner: 'char_10' },
    injuryLimit: 6, usableBalanceStill: 3 },
  finding: 'The earlier model explanation totals three payments as five instead of seven despite receiving the complete correct chapter. Both chapter plans agree on the actual payments; the later cost review states them correctly. This is a review explanation error, not evidence of a conflicting chapter design.',
  requiredFollowup: 'Check the eventual synthesis and final report for propagation of the incorrect total. Preserve both original responses; use the actual chapter and rule sources for independent content adjudication. Do not rewrite correct plans, overwrite the original check, or treat a structurally valid pass as semantic proof.',
  modelCalls: 0, productionWrites: 0, questionsResolved: 0, formalAcceptance: false };
fs.writeFileSync(snapshotPath, snapshotBytes, { flag: 'wx' });
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ verified: true, responsesReplayed: replay.responsesReplayed,
  totalSpent, remaining: 3, chapterEdits: 0, modelCalls: 0, productionWrites: 0, formalAcceptance: false }));
