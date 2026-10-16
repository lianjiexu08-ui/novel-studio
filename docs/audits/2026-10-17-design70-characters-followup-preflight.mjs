import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayDesignReviewRecord } from '../../scripts/audit-design-reviews.mjs';

const read = path => JSON.parse(fs.readFileSync(path));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const control = 'data/audit-runtimes/design70-review';
const bindingPath = 'data/audit-runtimes/design70-runtime-bound.json';
const binding = read(bindingPath);
const baseline = read(`${control}/baseline.json`);
assert.equal(hash(fs.readFileSync(bindingPath)), baseline.runtimeBindingSha256);
const inputBytes = fs.readFileSync(`${control}/inputs.json`);
assert.equal(hash(inputBytes), baseline.inputsSha256);
const inputs = JSON.parse(inputBytes);
assert.equal(hash(JSON.stringify(inputs.characters)), baseline.areas.find(area => area.area === 'characters').sourceEnvelopeSha256);
const checkpointBytes = fs.readFileSync(`${control}/result.json`);
const checkpoint = JSON.parse(checkpointBytes);
const run = checkpoint.runs.find(run => run.input.area === 'characters');
assert.ok(run);
assert.equal(checkpoint.inputHash, baseline.inputHash);
assert.equal(checkpoint.runnerSha256, baseline.runnerSha256);
assert.equal(hash(fs.readFileSync('scripts/run-design70-review.mjs')), baseline.runnerSha256);
for (const [path, expected] of Object.entries(binding.sourceHashes)) {
  assert.equal(hash(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
}
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const raw = run.stages.filter(stage => stage.kind !== 'synthesis' && !stage.followupFor);
assert.equal(raw.length, 15);
assert.ok(raw.every(stage => stage.result), 'Wait for all original/cross batches; do not synthesize missing results');
const replay = await replayDesignReviewRecord(run, inputs.characters, checkpoint.reports.find(report => report.id === run.reportId), { ...runtime, JsonDesignPlanner });
const questions = raw.flatMap(stage => stage.result.checks.filter(check => check.awaitingSources?.length)
  .map(check => ({ id: `${stage.id}/${check.criterion}`, stage, check })));
const resolutions = raw.flatMap(stage => (stage.result?.checks ?? []).filter(check => check.verdict === 'pass')
  .flatMap(check => check.resolves ?? []));
const followups = run.stages.filter(stage => stage.followupFor);
assert.equal(new Set(followups.map(stage => stage.followupFor)).size, followups.length);
for (const question of questions) {
  assert.ok(resolutions.includes(question.id) || followups.some(stage => stage.followupFor === question.id), `Unscheduled deferral: ${question.id}`);
}
const rows = followups.map(stage => {
  const request = runtime.designReviewStageInput(run, stage);
  const question = questions.find(question => question.id === stage.followupFor);
  assert.ok(question);
  assert.deepEqual(Object.keys(request.rubric), [question.check.criterion]);
  const pending = request.stage.coverage.pendingChecks.find(check => check.id === question.id);
  assert.ok(pending, `Missing original question metadata: ${question.id}`);
  assert.deepEqual(pending.requiredSourceIds, question.check.awaitingSources);
  assert.ok(request.sources.some(source => source.id === pending.questionSourceId));
  const required = [...new Set([...pending.requiredSourceIds, ...pending.priorSourceIds])];
  for (const sourceId of required) {
    const original = run.input.sources.find(source => source.id === sourceId);
    assert.ok(original, sourceId);
    const units = request.stage.sourceMap.filter(unit => unit.sourceId === sourceId).sort((a, b) => a.start - b.start);
    assert.ok(units.length, sourceId);
    assert.equal(units[0].start, 0, sourceId);
    assert.equal(units.at(-1).end, original.text.length, sourceId);
    units.slice(1).forEach((unit, i) => assert.equal(unit.start, units[i].end, sourceId));
    assert.equal(units.map(unit => request.sources.find(source => source.id === unit.id)?.text).join(''), original.text, sourceId);
  }
  const sourceCharacters = JSON.stringify(request.sources).length;
  const metadataCharacters = JSON.stringify(request.stage.coverage).length;
  assert.ok(sourceCharacters <= runtime.designReviewCapacity);
  assert.ok(metadataCharacters <= 40_000);
  return { stageId: stage.id, originalCheckId: question.id, criterion: question.check.criterion,
    requestedSourceIds: pending.requiredSourceIds, originalEvidenceSourceIds: pending.priorSourceIds,
    completeRequiredSources: required.length, sourceCharacters, metadataCharacters,
    inputSha256: hash(JSON.stringify(request)) };
});
assert.ok(rows.length > 0);
const snapshotPath = `${control}/characters-followup-prefix.json`;
fs.writeFileSync(snapshotPath, checkpointBytes, { flag: 'wx' });
const proof = { kind: 'design70_characters_dynamic_followups_preflight', observedAt: new Date().toISOString(),
  inputHash: checkpoint.inputHash, runId: run.id, snapshotPath, snapshotSha256: hash(checkpointBytes),
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  independentInputsSha256: baseline.inputsSha256, prefixReplay: replay, originalStagesCompleted: raw.length, pendingSourceQuestions: questions.length,
  explicitRawResolutions: resolutions, followups: rows, totalScheduledStages: run.stages.length,
  modelCalls: 0, productionWrites: 0, questionsResolvedByThisAudit: 0, formalAcceptance: false,
  limitation: 'Offline replay and complete-source/request-capacity checks only. Followup responses, dynamic report synthesis, semantic quality and all four area acceptance remain unproven.' };
fs.writeFileSync('docs/audits/2026-10-17-design70-characters-followup-preflight.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ originalStagesCompleted: raw.length, prefixResponsesReplayed: replay.responsesReplayed,
  sourceQuestions: questions.length, followups: rows.length, totalStages: run.stages.length,
  maximumSourceCharacters: Math.max(...rows.map(row => row.sourceCharacters)),
  maximumMetadataCharacters: Math.max(...rows.map(row => row.metadataCharacters)), formalAcceptance: false }));
