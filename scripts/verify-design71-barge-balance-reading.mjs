// Bind an independently checked ownership error to the unchanged model record.
// No model calls, database access, verdict changes or prose generation.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { replayDesignReviewRecord } from './audit-design-reviews.mjs';
import { annotationSources, designReviewCheckHash } from '../novel-service-core/src/design-review-annotations.ts';

parseArgs({ options: {}, strict: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const read = file => JSON.parse(fs.readFileSync(file));
const control = 'data/audit-runtimes/design71-review';
const snapshotPath = `${control}/barge-balance-reading-prefix.json`;
const proofPath = 'docs/audits/2026-10-17-design71-barge-balance-reading.json';
const annotationPath = `${control}/barge-balance-annotation-inputs.json`;
for (const file of [snapshotPath, proofPath, annotationPath]) assert.ok(!fs.existsSync(file), `Preserve prior evidence: ${file}`);
const baseline = read(`${control}/baseline.json`);
const inputBytes = fs.readFileSync(`${control}/inputs.json`);
assert.equal(sha(inputBytes), baseline.inputsSha256);
const input = JSON.parse(inputBytes).story;
const bytes = fs.readFileSync(`${control}/result.json`), checkpoint = JSON.parse(bytes);
assert.equal(checkpoint.inputHash, baseline.inputHash);
assert.equal(sha(fs.readFileSync('scripts/run-design71-review.mjs')), baseline.runnerSha256);
const run = checkpoint.runs.find(run => run.input.area === 'story');
assert.deepEqual(run.input, input);
const bindingPath = 'data/audit-runtimes/design71-runtime-bound.json';
assert.equal(sha(fs.readFileSync(bindingPath)), baseline.runtimeBindingSha256);
const binding = read(bindingPath);
for (const [file, expected] of Object.entries(binding.sourceHashes)) assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${file}`)), expected, file);
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const replay = await replayDesignReviewRecord(run, input, checkpoint.reports.find(report => report.id === run.reportId), { ...runtime, JsonDesignPlanner });
const stage = run.stages.find(stage => stage.id === 'cross-1-5');
assert.ok(stage?.result && stage.modelResponses?.length);
const request = runtime.designReviewStageInput(run, stage);
const sources = ['plan/chapters/43', 'plan/chapters/44'].map(id => {
  const source = input.sources.find(source => source.id === id); assert.ok(source); return source;
});
const provided = Object.fromEntries(sources.map(source => {
  const units = request.stage.sourceMap.filter(unit => unit.sourceId === source.id).sort((a, b) => a.start - b.start);
  return [source.id, units.map(unit => request.sources.find(source => source.id === unit.id).text).join('') === source.text];
}));
assert.equal(provided['plan/chapters/43'], false);
assert.equal(provided['plan/chapters/44'], true);
const linQuote = '出剑前沿用239日复测的保守余量五成，一式二成后余三成';
const crewQuote = '送钩伙计承接43章四成半真元，44章没有再施术';
const crew43Quote = '凝元伙计一次送钩支出半成真元，自身保守余量五成降至四成半';
assert.ok(JSON.parse(sources[1].text).cost.includes(linQuote));
assert.ok(JSON.parse(sources[1].text).cost.includes(crewQuote));
assert.ok(JSON.parse(sources[0].text).cost.includes(crew43Quote));
const correction = '四成半真元属于送钩伙计，不是林辰。第44章已明确林辰沿用第239日复测的五成保守余量，一式支付二成后余三成；伙计承接第43章四成半且第44章未再施术。此处是评语的余额归属误读。仍保留对第18章训练和第43章现场承接的补读要求，不自动解除材料不足或批准设计。';
const quotes = {
  causality: '43章已经报警、拖偏并形成的现场态势和四成半真元起点',
  timeline: '其二成施剑后的三成余额取自43章四成半余额',
};
const annotations = Object.entries(quotes).map(([criterion, claimQuote]) => {
  const check = stage.result.checks.find(check => check.criterion === criterion);
  assert.equal(check.verdict, 'insufficient');
  assert.ok(check.explanation.includes(claimQuote));
  assert.ok(stage.modelResponses.some(response => response.includes(claimQuote)));
  const note = { requestKey: `design71-barge-balance-${criterion}`, runId: run.id, stageId: stage.id, criterion,
    expectedInputHash: run.input.inputHash, expectedCheckHash: designReviewCheckHash(check),
    claimQuote, explanation: correction, evidence: [
      { sourceId: sources[1].id, quote: linQuote }, { sourceId: sources[1].id, quote: crewQuote },
      { sourceId: sources[0].id, quote: crew43Quote },
    ] };
  assert.deepEqual(annotationSources({ designReviewRuns: new Map([[run.id, run]]) }, note), [sources[1], sources[0]]);
  return note;
});
const proof = { observedAt: new Date().toISOString(), kind: 'model_explanation_resource_owner_mismatch',
  inputHash: baseline.inputHash, inputsSha256: baseline.inputsSha256, runId: run.id,
  snapshotPath, snapshotSha256: sha(bytes), prefixReplay: replay,
  stageId: stage.id, stageSha256: hash(stage), requestSha256: hash(request),
  checks: stage.result.checks.filter(check => Object.hasOwn(quotes, check.criterion)),
  modelResponses: stage.modelResponses, completeOriginalSources: sources, sourcesActuallyProvided: provided,
  correction, separateAccounts: {
    lin: { opening: 5, payment: 2, remaining: 3, chapterNumber: 44 },
    hookCrew: { opening: 5, payment: 0.5, remaining: 4.5, chapterNumber: 43, chapter44Payment: 0 },
  }, annotationPath, annotationInputsSha256: hash(annotations), annotationCount: annotations.length,
  requiredFollowup: 'Check actual supplemental reading, later syntheses and the final report for this ownership confusion. Exact phrase matching alone cannot establish whether later paraphrases repeat it. Preserve all original waits and their explicit dispositions.',
  modelCalls: 0, productionWrites: 0, chapterEdits: 0, questionsResolved: 0, formalAcceptance: false };
fs.writeFileSync(snapshotPath, bytes, { flag: 'wx' });
fs.writeFileSync(annotationPath, JSON.stringify(annotations, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ proofPath, completedStages: replay.completedStages, responsesReplayed: replay.responsesReplayed,
  provided, preparedAnnotations: annotations.length, productionWrites: 0, formalAcceptance: false }));
