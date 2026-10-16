// Offline verification of completed raw/followup evidence, not design approval.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayDesignReviewPrefix } from '../../scripts/audit-design-reviews.mjs';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const control = 'data/audit-runtimes/design68-review';
const checkpointBytes = fs.readFileSync(`${control}/result.json`);
const checkpoint = JSON.parse(checkpointBytes);
const baseline = read(`${control}/baseline.json`);
const binding = read('data/audit-runtimes/design68-runtime-bound.json');
const inputsBytes = fs.readFileSync(`${control}/inputs.json`);
assert.equal(sha(inputsBytes), baseline.inputsSha256);
assert.equal(checkpoint.inputHash, baseline.inputHash);
assert.equal(sha(fs.readFileSync('scripts/run-design68-review.mjs')), baseline.runnerSha256);
for (const [path, expected] of Object.entries(binding.sourceHashes)) assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
const run = checkpoint.runs.find(run => run.input.area === 'power');
const raw = run.stages.filter(stage => stage.kind !== 'synthesis' && !stage.followupFor);
const followups = run.stages.filter(stage => stage.followupFor);
assert.equal(raw.length, 15);
assert.equal(followups.length, 24);
assert.ok([...raw, ...followups].every(stage => stage.result), 'Wait for all raw and followup results; do not simulate missing conclusions');
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const replay = await replayDesignReviewPrefix(run, JSON.parse(inputsBytes).power, { ...runtime, JsonDesignPlanner });
const firstSynthesis = run.stages.find(stage => stage.kind === 'synthesis');
const firstSynthesisInput = runtime.designReviewStageInput(run, firstSynthesis);
const resolutions = firstSynthesisInput.stage.coverage.resolvedDeferrals ?? [];
const deferrals = raw.flatMap(stage => stage.result.checks.filter(check => check.awaitingSources?.length)
  .map(check => ({ checkId: `${stage.id}/${check.criterion}`, criterion: check.criterion, requestedSources: check.awaitingSources })));
assert.equal(deferrals.length, 30);
const unresolvedDeferrals = deferrals.filter(question => !resolutions.some(resolution => resolution.checkId === question.checkId));
const ordinaryFindings = [...raw, ...followups].flatMap(stage => stage.result.checks
  .filter(check => check.verdict !== 'pass' && !check.awaitingSources?.length)
  .map(({ evidence, ...check }) => ({ stageId: stage.id, ...check, evidenceCount: evidence.length })));
assert.ok(ordinaryFindings.some(check => check.stageId === 'batch-5' && check.criterion === 'costs' && check.verdict === 'revise'));
assert.ok(ordinaryFindings.some(check => check.stageId === 'followup-batch-1/tiers' && check.verdict === 'revise'));
assert.ok(ordinaryFindings.some(check => check.stageId === 'followup-cross-2-3/costs' && check.verdict === 'insufficient'));
// Every original and followup stage must be an actual ancestor of the root.
const covered = new Set();
const visit = (stage, seen = new Set()) => {
  assert.ok(stage && !seen.has(stage.id), 'Invalid synthesis dependency');
  if (stage.kind !== 'synthesis') { covered.add(stage.id); return; }
  const next = new Set([...seen, stage.id]);
  for (const childId of stage.children) visit(run.stages.find(item => item.id === childId), next);
};
visit(run.stages.at(-1));
assert.deepEqual([...covered].sort(), [...raw, ...followups].map(stage => stage.id).sort());
const snapshotPath = `${control}/power-followups-completed.json`;
const proof = {
  kind: 'design68_completed_power_raw_and_followup_evidence', observedAt: checkpoint.updatedAt,
  inputHash: baseline.inputHash, runId: run.id, snapshotPath, snapshotSha256: sha(checkpointBytes),
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  rawStages: raw.length, followupStages: followups.length, scheduledSynthesisStages: run.stages.filter(stage => stage.kind === 'synthesis').length,
  replay, originalSourceDeferrals: deferrals.length, explicitResolutionsAtSynthesisStart: resolutions,
  unresolvedDeferralsAtSynthesisStart: unresolvedDeferrals,
  followupChecks: followups.map(stage => ({ stageId: stage.id, checks: stage.result.checks.map(({ criterion, verdict, resolves }) => ({ criterion, verdict, ...(resolves ? { resolves } : {}) })) })),
  ordinaryFindings, allRawAndFollowupStagesReachRoot: true,
  modelCalls: 0, productionWrites: 0, formalAcceptance: false,
  limitation: 'Verifies raw-response replay, canonical scheduling, explicit source deferrals and structural paths to the synthesis root. It does not assert semantic correctness of model judgments or preservation of each negative in not-yet-written synthesis text. Disputed negatives and ordinary insufficient remain; final report reconstruction and four-area acceptance are still required.',
};
fs.writeFileSync(snapshotPath, checkpointBytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-power-followups-complete.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ completedStagesReplayed: replay.completedStages, responsesReplayed: replay.responsesReplayed,
  retainedFailures: replay.failures.length, rawStages: raw.length, followupStages: followups.length,
  explicitResolutions: resolutions.length, unresolvedDeferrals: unresolvedDeferrals.map(question => question.checkId),
  ordinaryFindings: ordinaryFindings.map(check => ({ stageId: check.stageId, criterion: check.criterion, verdict: check.verdict })), formalAcceptance: false }));
