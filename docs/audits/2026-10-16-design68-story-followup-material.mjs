// Inspect the actual scheduled followups and rehearse v28 in memory only.
// Wait for all original raw stages; never manufacture missing judgments.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as current from '../../novel-service-core/src/design-review-run.ts';
import { replayDesignReviewPrefix } from '../../scripts/audit-design-reviews.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const read = path => JSON.parse(fs.readFileSync(path));
const root = 'data/audit-runtimes/design68-review';
const bytes = fs.readFileSync(`${root}/result.json`), checkpoint = JSON.parse(bytes);
const run = checkpoint.runs.find(run => run.input.area === 'story');
const raw = run.stages.filter(stage => stage.kind !== 'synthesis' && !stage.followupFor);
assert.ok(raw.every(stage => stage.result), 'Wait for all original story batches and cross-checks');
const baseline = read(`${root}/baseline.json`);
const inputBytes = fs.readFileSync(`${root}/inputs.json`);
assert.equal(sha(inputBytes), baseline.inputsSha256);
assert.equal(checkpoint.inputHash, baseline.inputHash);
assert.equal(sha(fs.readFileSync('scripts/run-design68-review.mjs')), baseline.runnerSha256);
const binding = read('data/audit-runtimes/design68-runtime-bound.json');
for (const [path, expected] of Object.entries(binding.sourceHashes)) {
  assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
}
const frozen = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const replay = await replayDesignReviewPrefix(run, JSON.parse(inputBytes).story, { ...frozen, JsonDesignPlanner });
const rehearsal = current.createDesignReviewRun(run.input, run.createdAt, 28);
for (const saved of raw) {
  const stage = rehearsal.stages.find(stage => stage.id === saved.id);
  assert.deepEqual(current.designReviewStageInput(rehearsal, stage), frozen.designReviewStageInput(run, saved));
  current.acceptDesignReviewStage(rehearsal, stage, structuredClone(saved.result));
}
const sourceText = new Map(run.input.sources.map(source => [source.id, source.text]));
const completeSourceIds = request => {
  const ids = [...new Set(request.stage.sourceMap.map(unit => unit.sourceId))];
  return ids.filter(id => request.stage.sourceMap.filter(unit => unit.sourceId === id)
    .sort((a, b) => a.start - b.start)
    .map(unit => request.sources.find(source => source.id === unit.id).text).join('') === sourceText.get(id));
};
const inspect = (state, api) => state.stages.filter(stage => stage.followupFor).map(stage => {
  const request = api.designReviewStageInput(state, stage);
  const pending = request.stage.coverage.pendingChecks?.find(check => check.id === stage.followupFor);
  assert.ok(pending, `${stage.id}: missing original question/coverage`);
  const complete = completeSourceIds(request);
  const mandatory = [...new Set([...pending.requiredSourceIds, ...(pending.priorSourceIds ?? [])])];
  assert.ok(mandatory.every(id => complete.includes(id)), `${stage.id}: incomplete mandatory source`);
  assert.ok(request.sources.some(source => source.id === pending.questionSourceId));
  const materialCharacters = JSON.stringify(request.sources).length;
  const metadataCharacters = JSON.stringify(request.stage.coverage).length;
  assert.ok(materialCharacters <= api.designReviewCapacity);
  assert.ok(metadataCharacters <= 40000);
  assert.deepEqual(api.designReviewStageInput(JSON.parse(JSON.stringify(state)), stage), request);
  return { stageId: stage.id, followupFor: stage.followupFor,
    requestSha256: sha(JSON.stringify(request)), materialCharacters, metadataCharacters,
    mandatorySources: mandatory, completeSourceIds: complete,
    relatedContext: request.stage.coverage.relatedSourceContext ?? null,
    reloadRequestUnchanged: true };
});
const existing = inspect(run, frozen), next = inspect(rehearsal, current);
const differences = next.map(row => {
  const old = existing.find(item => item.followupFor === row.followupFor);
  return { checkId: row.followupFor, newFollowup: !old,
    addedCompleteSources: row.completeSourceIds.filter(id => !old?.completeSourceIds.includes(id)),
    removedCompleteSources: (old?.completeSourceIds ?? []).filter(id => !row.completeSourceIds.includes(id)) };
}).filter(row => row.newFollowup || row.addedCompleteSources.length || row.removedCompleteSources.length);
const pending = raw.flatMap(stage => stage.result.checks.filter(check => check.awaitingSources?.length)
  .map(check => ({ checkId: `${stage.id}/${check.criterion}`, requestedSources: check.awaitingSources,
    scheduledInFrozenRun: existing.some(row => row.followupFor === `${stage.id}/${check.criterion}`),
    scheduledInRehearsal: next.some(row => row.followupFor === `${stage.id}/${check.criterion}`) })));
const snapshotPath = `${root}/story-followup-material.json`;
const proof = {
  kind: 'design68_story_followup_material', observedAt: checkpoint.updatedAt,
  inputHash: baseline.inputHash, runId: run.id, snapshotPath, snapshotSha256: sha(bytes),
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length, prefixReplay: replay,
  originalRawRequestsIdenticalInV28: raw.length, pending, frozenFollowups: existing,
  rehearsalV28Followups: next, differences,
  modelCalls: 0, productionWrites: 0, findingsResolved: 0, designApproved: false,
  limitation: 'Verifies actual original-source coverage, bounds and reload stability. V28 is only an in-memory rehearsal; the live v26 worker and reports are unchanged. Missing scheduled followups require checking actual formal resolutions or capacity, never automatic clearance. Complete material does not prove semantic correctness or prose quality.',
};
fs.writeFileSync(snapshotPath, bytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-story-followup-material.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ stagesReplayed: replay.completedStages, responsesReplayed: replay.responsesReplayed,
  originalRawRequestsIdenticalInV28: raw.length, pending: pending.length,
  frozenFollowups: existing.length, rehearsalFollowups: next.length,
  differences: differences.map(row => ({ checkId: row.checkId, newFollowup: row.newFollowup,
    addedCompleteSources: row.addedCompleteSources.length, removedCompleteSources: row.removedCompleteSources.length })),
  modelCalls: 0, productionWrites: 0 }));
