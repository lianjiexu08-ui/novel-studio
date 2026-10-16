// Audit actual raw/followup results before the remaining synthesis completes.
// Never invent missing results, resolve questions, or call a model.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayDesignReviewRecord } from '../../scripts/audit-design-reviews.mjs';
const read = path => JSON.parse(fs.readFileSync(path));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const control = 'data/audit-runtimes/design70-review';
const baseline = read(`${control}/baseline.json`), binding = read('data/audit-runtimes/design70-runtime-bound.json');
const inputBytes = fs.readFileSync(`${control}/inputs.json`);
assert.equal(sha(inputBytes), baseline.inputsSha256);
assert.equal(sha(fs.readFileSync('scripts/run-design70-review.mjs')), baseline.runnerSha256);
assert.equal(sha(fs.readFileSync('data/audit-runtimes/design70-runtime-bound.json')), baseline.runtimeBindingSha256);
for (const [name, expected] of Object.entries(binding.sourceHashes)) assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${name}`)), expected);
const bytes = fs.readFileSync(`${control}/result.json`), checkpoint = JSON.parse(bytes);
const run = checkpoint.runs.find(run => run.input.area === 'power');
assert.ok(run);
assert.equal(run.input.inputHash, baseline.inputHash);
const raw = run.stages.filter(stage => stage.kind !== 'synthesis');
assert.equal(raw.filter(stage => !stage.followupFor).length, 15);
assert.equal(raw.filter(stage => stage.followupFor).length, 34);
assert.ok(raw.every(stage => stage.result), 'Wait for all actual raw and followup results');
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const replay = await replayDesignReviewRecord(run, JSON.parse(inputBytes).power,
  checkpoint.reports.find(report => report.id === run.reportId), { ...runtime, JsonDesignPlanner });
const firstSynthesis = run.stages.find(stage => stage.kind === 'synthesis');
assert.ok(firstSynthesis);
const request = runtime.designReviewStageInput(run, firstSynthesis);
const resolutions = request.stage.coverage.resolvedDeferrals;
assert.equal(new Set(resolutions.map(item => item.checkId)).size, resolutions.length);
const questions = raw.filter(stage => !stage.followupFor).flatMap(stage => stage.result.checks
  .filter(check => check.awaitingSources?.length).map(check => ({ id: `${stage.id}/${check.criterion}`, stage, check })));
assert.equal(questions.length, 37);
for (const resolution of resolutions) {
  const question = questions.find(question => question.id === resolution.checkId);
  assert.ok(question);
  const resolver = raw.find(stage => stage.id === resolution.resolvedByStageId);
  assert.ok(resolver);
  assert.ok(resolver.result.checks.some(check => check.criterion === question.check.criterion
    && check.verdict === 'pass' && check.resolves?.includes(question.id)));
}
const unresolved = questions.filter(question => !resolutions.some(item => item.checkId === question.id));
const ready = run.stages.filter(stage => stage.kind === 'synthesis'
  && stage.children.every(id => run.stages.find(child => child.id === id)?.result));
const capacity = ready.map(stage => {
  const input = runtime.designReviewStageInput(run, stage);
  const sourceCharacters = JSON.stringify(input.sources).length;
  const metadataCharacters = JSON.stringify(input.stage.coverage).length;
  assert.ok(sourceCharacters <= runtime.designReviewCapacity);
  assert.ok(metadataCharacters <= 40_000);
  return { stageId: stage.id, children: stage.children, sourceCharacters, metadataCharacters,
    requestSha256: sha(JSON.stringify(input)) };
});
const resolutionContext = runtime.designReviewResolutionContext(run, run.stages.indexOf(firstSynthesis));
const snapshotPath = `${control}/power-raw-complete-checkpoint.json`;
const proof = { observedAt: new Date().toISOString(), kind: 'design70_power_raw_completion_integrity',
  runId: run.id, inputHash: run.input.inputHash, snapshotPath, snapshotSha256: sha(bytes),
  rawStagesCompleted: raw.length, followupsCompleted: raw.filter(stage => stage.followupFor).length,
  totalScheduledStages: run.stages.length, prefixReplay: replay,
  sourceQuestionCount: questions.length, resolutions, unresolvedSourceQuestionIds: unresolved.map(question => question.id),
  resolutionContextSha256: resolutionContext ? sha(resolutionContext.text) : null,
  rawNonPassChecks: raw.flatMap(stage => stage.result.checks.filter(check => check.verdict !== 'pass')
    .map(check => ({ stageId: stage.id, criterion: check.criterion, verdict: check.verdict,
      explanation: check.explanation, revisionAdvice: check.revisionAdvice,
      awaitingSources: check.awaitingSources, resolvedByStageId: resolutions.find(item => item.checkId === `${stage.id}/${check.criterion}`)?.resolvedByStageId }))),
  readySynthesisRequests: capacity, pendingSynthesisCapacityUnverified: run.stages.filter(stage => stage.kind === 'synthesis').length - capacity.length,
  modelCalls: 0, productionWrites: 0, formalAcceptance: false,
  limitation: 'Actual raw evidence and ready-request integrity only. Remaining synthesis, semantic quality, all four design areas and prose acceptance are not established by this audit.' };
fs.writeFileSync(snapshotPath, bytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-17-design70-power-raw-complete.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ rawStagesCompleted: raw.length, completedStages: replay.completedStages,
  responsesReplayed: replay.responsesReplayed, resolvedSourceQuestions: resolutions.length,
  unresolvedSourceQuestions: unresolved.length, readySynthesisRequests: capacity.length,
  maximumSourceCharacters: Math.max(...capacity.map(row => row.sourceCharacters)),
  maximumMetadataCharacters: Math.max(...capacity.map(row => row.metadataCharacters)), formalAcceptance: false }));
