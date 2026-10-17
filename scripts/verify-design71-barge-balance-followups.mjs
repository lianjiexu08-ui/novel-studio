// Preserve actual supplemental answers to the known ownership misreading.
// This is a partial-run provenance check, not final semantic acceptance.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { replayDesignReviewRecord } from './audit-design-reviews.mjs';

const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } }, strict: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const read = file => JSON.parse(fs.readFileSync(file));
const fileHash = file => sha(fs.readFileSync(file));
const control = 'data/audit-runtimes/design71-review';
const originalPath = 'docs/audits/2026-10-17-design71-barge-balance-reading.json';
const outputPath = 'docs/audits/2026-10-17-design71-barge-balance-followups.json';
const snapshotPath = `${control}/barge-balance-followups-prefix.json`;
const saved = values.check ? read(outputPath) : undefined;
if (!values.check) for (const file of [outputPath, snapshotPath]) assert.ok(!fs.existsSync(file), `Preserve prior evidence: ${file}`);
const original = read(originalPath), baseline = read(`${control}/baseline.json`);
assert.equal(fileHash(original.snapshotPath), original.snapshotSha256);
assert.equal(original.inputHash, baseline.inputHash);
const inputsPath = `${control}/inputs.json`;
assert.equal(fileHash(inputsPath), baseline.inputsSha256);
assert.equal(fileHash('scripts/run-design71-review.mjs'), baseline.runnerSha256);
const bindingPath = 'data/audit-runtimes/design71-runtime-bound.json';
assert.equal(fileHash(bindingPath), baseline.runtimeBindingSha256);
const binding = read(bindingPath);
for (const [file, expected] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(`${binding.runtimePath}/${file}`), expected, file);
const checkpointBytes = fs.readFileSync(values.check ? snapshotPath : `${control}/result.json`);
if (values.check) assert.equal(sha(checkpointBytes), saved.snapshotSha256);
const checkpoint = JSON.parse(checkpointBytes), input = read(inputsPath).story;
assert.equal(checkpoint.inputHash, baseline.inputHash);
const run = checkpoint.runs.find(run => run.id === original.runId); assert.ok(run);
assert.deepEqual(run.input, input);
const originalStage = run.stages.find(stage => stage.id === original.stageId);
assert.equal(hash(originalStage), original.stageSha256);
for (const source of original.completeOriginalSources) assert.deepEqual(input.sources.find(s => s.id === source.id), source);
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const followups = ['causality', 'timeline'].map(criterion => {
  const questionId = `${original.stageId}/${criterion}`;
  const stage = run.stages.find(stage => stage.followupFor === questionId);
  assert.ok(stage?.result && stage.modelResponses?.length, `Wait for actual supplemental result: ${questionId}`);
  const request = runtime.designReviewStageInput(run, stage);
  const completeSources = original.completeOriginalSources.map(source => {
    const units = request.stage.sourceMap.filter(unit => unit.sourceId === source.id).sort((a, b) => a.start - b.start);
    assert.ok(units.length, source.id);
    assert.equal(units[0].start, 0);
    assert.equal(units.at(-1).end, source.text.length);
    units.slice(1).forEach((unit, index) => assert.equal(unit.start, units[index].end));
    assert.equal(units.map(unit => request.sources.find(s => s.id === unit.id).text).join(''), source.text);
    return { sourceId: source.id, sourceSha256: hash(source), units: units.map(unit => unit.id) };
  });
  const check = stage.result.checks.find(check => check.criterion === criterion); assert.ok(check);
  return { stageId: stage.id, questionId, stageSha256: hash(stage), requestSha256: hash(request),
    completeSources, summary: stage.result.summary, check,
    explicitlyResolvesOriginalQuestion: check.verdict === 'pass' && (check.resolves ?? []).includes(questionId),
    modelResponses: stage.modelResponses };
});
const replay = await replayDesignReviewRecord(run, input, checkpoint.reports.find(report => report.id === run.reportId), { ...runtime, JsonDesignPlanner });
const needles = ['四成半真元起点', '其二成施剑后的三成余额取自43章四成半余额'];
const occurrences = run.stages.filter(stage => stage.result).flatMap(stage => {
  const matches = [];
  function collect(text, position) {
    for (const phrase of needles) if (text?.includes(phrase)) matches.push({ ...position, phrase,
      textSha256: hash(text), excerpt: text.slice(Math.max(0, text.indexOf(phrase) - 60), text.indexOf(phrase) + phrase.length + 60) });
  }
  collect(stage.result.summary, { field: 'summary' });
  for (const check of stage.result.checks) {
    for (const field of ['explanation', 'revisionAdvice']) collect(check[field], { criterion: check.criterion, field });
    check.evidence.forEach((evidence, index) => collect(evidence.quote, { criterion: check.criterion, field: 'evidence', index, sourceId: evidence.sourceId }));
  }
  return matches.map(match => ({ stageId: stage.id, kind: stage.kind, ...match }));
});
const proof = { observedAt: saved?.observedAt ?? new Date().toISOString(), kind: 'known_model_resource_owner_error_supplemental_answers',
  inputHash: baseline.inputHash, runId: run.id, originalProofPath: originalPath, originalProofSha256: fileHash(originalPath),
  snapshotPath, snapshotSha256: sha(checkpointBytes), prefixReplay: replay,
  originalResponsesUnchanged: true, originalSourcesUnchanged: true, originalCorrection: original.correction,
  separateAccounts: original.separateAccounts, followups, exactPhraseOccurrences: occurrences,
  finalReportAvailableInSnapshot: Boolean(run.reportId), completedStages: run.stages.filter(stage => stage.result).length,
  totalStages: run.stages.length, modelCalls: 0, productionWrites: 0, chapterEdits: 0, formalAcceptance: false,
  limitation: 'Full original-source delivery and raw response replay verify provenance. A pass or the absence of an exact phrase does not prove the ownership error has been corrected semantically. Read both actual explanations, all relevant later syntheses and the final report; preserve historical quotations and other legitimate followup questions.' };
if (values.check) assert.deepEqual(proof, saved, 'Stored evidence differs from replayed snapshot');
else {
  fs.writeFileSync(snapshotPath, checkpointBytes, { flag: 'wx' });
  fs.writeFileSync(outputPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ mode: values.check ? 'read_only_check' : 'write_once', outputPath,
  completedStages: proof.completedStages, responsesReplayed: replay.responsesReplayed,
  followups: followups.map(item => ({ stageId: item.stageId, verdict: item.check.verdict, explicitlyResolves: item.explicitlyResolvesOriginalQuestion })),
  finalReportAvailable: proof.finalReportAvailableInSnapshot, productionWrites: 0, formalAcceptance: false }));
