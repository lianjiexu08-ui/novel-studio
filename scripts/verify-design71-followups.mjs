// Read-only verification of actual dynamic followups, without model calls or acceptance.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { replayDesignReviewRecord } from './audit-design-reviews.mjs';

const { values } = parseArgs({ options: { area: { type: 'string' }, check: { type: 'boolean', default: false } }, strict: true });
const area = values.area;
assert.ok(['power', 'characters', 'story', 'world'].includes(area), 'Usage: --area=power|characters|story|world [--check].');

const read = path => JSON.parse(fs.readFileSync(path));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const control = 'data/audit-runtimes/design71-review';
const bindingPath = 'data/audit-runtimes/design71-runtime-bound.json';
const binding = read(bindingPath);
const baseline = read(`${control}/baseline.json`);
const snapshotPath = `${control}/${area}-followup-prefix.json`;
const proofPath = `docs/audits/2026-10-17-design71-${area}-followup-preflight.json`;
if (!values.check) assert.ok(!fs.existsSync(snapshotPath) && !fs.existsSync(proofPath), 'Preserve prior preflight evidence; use --check for read-only verification');
assert.equal(hash(fs.readFileSync(bindingPath)), baseline.runtimeBindingSha256);
const inputBytes = fs.readFileSync(`${control}/inputs.json`);
assert.equal(hash(inputBytes), baseline.inputsSha256);
const inputs = JSON.parse(inputBytes);
assert.equal(hash(JSON.stringify(inputs[area])), baseline.areas.find(item => item.area === area).sourceEnvelopeSha256);
const checkpointBytes = fs.readFileSync(`${control}/result.json`);
const checkpoint = JSON.parse(checkpointBytes);
const run = checkpoint.runs.find(run => run.input.area === area);
assert.ok(run);
assert.equal(checkpoint.inputHash, baseline.inputHash);
assert.equal(checkpoint.runnerSha256, baseline.runnerSha256);
assert.equal(hash(fs.readFileSync('scripts/run-design71-review.mjs')), baseline.runnerSha256);
for (const [path, expected] of Object.entries(binding.sourceHashes)) {
  assert.equal(hash(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
}
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const raw = run.stages.filter(stage => stage.kind !== 'synthesis' && !stage.followupFor);
assert.equal(run.scheduleVersion, 32);
const canonical = runtime.createDesignReviewRun(inputs[area], run.createdAt, run.scheduleVersion);
const canonicalRaw = canonical.stages.filter(stage => stage.kind !== 'synthesis' && !stage.followupFor);
assert.deepEqual(raw.map(stage => stage.id), canonicalRaw.map(stage => stage.id), 'Original schedule must match the independent frozen input');
assert.ok(raw.every(stage => stage.result), 'Wait for all original/cross batches; do not synthesize missing results');
const replay = await replayDesignReviewRecord(run, inputs[area], checkpoint.reports.find(report => report.id === run.reportId), { ...runtime, JsonDesignPlanner });
const questions = raw.flatMap(stage => stage.result.checks.filter(check => check.verdict === 'insufficient' && check.awaitingSources?.length)
  .map(check => ({ id: `${stage.id}/${check.criterion}`, stage, check })));
const resolutionRecords = raw.flatMap(stage => stage.result.checks.filter(check => check.verdict === 'pass')
  .flatMap(check => (check.resolves ?? []).map(checkId => ({ checkId, stageId: stage.id, criterion: check.criterion,
    explanation: check.explanation, evidenceSourceIds: [...new Set(check.evidence.map(e =>
      run.units.find(unit => unit.id === e.sourceId)?.sourceId ?? e.sourceId))] }))));
const resolutions = resolutionRecords.map(item => item.checkId);
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

const proof = { kind: `design71_${area}_dynamic_followups_preflight`, area, observedAt: new Date().toISOString(),
  inputHash: checkpoint.inputHash, runId: run.id, snapshotPath, snapshotSha256: hash(checkpointBytes),
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  independentInputsSha256: baseline.inputsSha256, prefixReplay: replay, originalStagesCompleted: raw.length, pendingSourceQuestions: questions.length,
  explicitRawResolutions: resolutionRecords,
  questionDisposition: questions.map(question => ({ checkId: question.id,
    originalExplanation: question.check.explanation, requestedSources: question.check.awaitingSources,
    resolvedBy: resolutionRecords.filter(record => record.checkId === question.id).map(record => record.stageId),
    followupStageId: followups.find(stage => stage.followupFor === question.id)?.id })), followups: rows, totalScheduledStages: run.stages.length,
  modelCalls: 0, productionWrites: 0, questionsResolvedByThisAudit: 0, formalAcceptance: false,
  limitation: 'Offline replay and complete-source/request-capacity checks only. Followup responses, dynamic report synthesis, semantic quality and all four area acceptance remain unproven.' };
if (!values.check) {
  fs.writeFileSync(snapshotPath, checkpointBytes, { flag: 'wx' });
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ area, checkOnly: values.check, evidenceFilesWritten: values.check ? 0 : 2,
  originalStagesCompleted: raw.length, prefixResponsesReplayed: replay.responsesReplayed,
  sourceQuestions: questions.length, followups: rows.length, totalStages: run.stages.length,
  maximumSourceCharacters: Math.max(0, ...rows.map(row => row.sourceCharacters)),
  maximumMetadataCharacters: Math.max(0, ...rows.map(row => row.metadataCharacters)), formalAcceptance: false }));
