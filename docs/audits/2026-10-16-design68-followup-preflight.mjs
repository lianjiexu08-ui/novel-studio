import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayDesignReviewPrefix } from '../../scripts/audit-design-reviews.mjs';

const read = path => JSON.parse(fs.readFileSync(path));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const control = 'data/audit-runtimes/design68-review';
const binding = read('data/audit-runtimes/design68-runtime-bound.json');
const baseline = read(`${control}/baseline.json`);
const inputs = read(`${control}/inputs.json`);
const checkpointBytes = fs.readFileSync(`${control}/result.json`);
const checkpoint = JSON.parse(checkpointBytes);
const run = checkpoint.runs.find(run => run.input.area === 'world');
assert.ok(run);
assert.equal(checkpoint.inputHash, baseline.inputHash);
assert.equal(checkpoint.runnerSha256, baseline.runnerSha256);
assert.equal(hash(fs.readFileSync('scripts/run-design68-review.mjs')), baseline.runnerSha256);
for (const [path, expected] of Object.entries(binding.sourceHashes)) {
  assert.equal(hash(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
}
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const raw = run.stages.filter(stage => stage.kind !== 'synthesis' && !stage.followupFor);
assert.equal(raw.length, 21);
assert.ok(raw.every(stage => stage.result), 'Wait for all original/cross batches; do not synthesize missing results');
const replay = await replayDesignReviewPrefix(run, inputs.world, { ...runtime, JsonDesignPlanner });
const questions = raw.flatMap(stage => stage.result.checks.filter(check => check.awaitingSources?.length)
  .map(check => ({ id: `${stage.id}/${check.criterion}`, stage, check })));
const resolutions = run.stages.flatMap(stage => (stage.result?.checks ?? []).filter(check => check.verdict === 'pass')
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
const snapshotPath = `${control}/world-followup-prefix.json`;
fs.writeFileSync(snapshotPath, checkpointBytes, { flag: 'wx' });
const proof = { kind: 'design68_world_dynamic_followups_preflight', observedAt: new Date().toISOString(),
  inputHash: checkpoint.inputHash, runId: run.id, snapshotPath, snapshotSha256: hash(checkpointBytes),
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  prefixReplay: replay, originalStagesCompleted: raw.length, pendingSourceQuestions: questions.length,
  explicitRawResolutions: resolutions, followups: rows, totalScheduledStages: run.stages.length,
  modelCalls: 0, productionWrites: 0, questionsResolvedByThisAudit: 0, formalAcceptance: false,
  limitation: 'Offline replay and complete-source/request-capacity checks only. Followup responses, dynamic report synthesis, semantic quality and all four area acceptance remain unproven.' };
fs.writeFileSync('docs/audits/2026-10-16-design68-followup-preflight.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ originalStagesCompleted: raw.length, prefixResponsesReplayed: replay.responsesReplayed,
  sourceQuestions: questions.length, followups: rows.length, totalStages: run.stages.length,
  maximumSourceCharacters: Math.max(...rows.map(row => row.sourceCharacters)),
  maximumMetadataCharacters: Math.max(...rows.map(row => row.metadataCharacters)), formalAcceptance: false }));
