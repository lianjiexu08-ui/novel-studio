// Read-only review reconciliation; never advance or restart the live worker.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayDesignReviewPrefix } from '../../scripts/audit-design-reviews.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const read = path => JSON.parse(fs.readFileSync(path));
const root = 'data/audit-runtimes/design68-review';
const bytes = fs.readFileSync(`${root}/result.json`);
const checkpoint = JSON.parse(bytes);
const baseline = read(`${root}/baseline.json`);
const binding = read('data/audit-runtimes/design68-runtime-bound.json');
const inputBytes = fs.readFileSync(`${root}/inputs.json`);
assert.equal(sha(inputBytes), baseline.inputsSha256);
assert.equal(checkpoint.inputHash, baseline.inputHash);
assert.equal(sha(fs.readFileSync('scripts/run-design68-review.mjs')), baseline.runnerSha256);
for (const [path, expected] of Object.entries(binding.sourceHashes)) {
  assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
}
const input = JSON.parse(inputBytes).story;
const run = checkpoint.runs.find(item => item.input.area === 'story');
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const replay = await replayDesignReviewPrefix(run, input, { ...runtime, JsonDesignPlanner });
const batches = Array.from({ length: 5 }, (_, i) => run.stages.find(stage => stage.id === `batch-${i + 1}`));
assert.ok(batches.every(stage => stage?.result));
const initialChecks = batches.map(stage => ({
  stageId: stage.id, stageSha256: sha(JSON.stringify(stage)),
  responsesReplayed: stage.modelResponses.length,
  checks: stage.result.checks.map(({ evidence, ...check }) => ({ ...check,
    evidenceCount: evidence.length, evidenceSha256: sha(JSON.stringify(evidence)) })),
}));
const source = id => {
  const value = input.sources.find(item => item.id === id);
  assert.ok(value, id);
  return value;
};
const extract = (id, field, fragment) => {
  const value = source(id);
  const object = JSON.parse(value.text);
  const matches = (Array.isArray(object[field]) ? object[field] : [object[field]])
    .filter(text => typeof text === 'string' && text.includes(fragment));
  assert.equal(matches.length, 1, `${id}/${field}: ${fragment}`);
  return { sourceId: id, sourceSha256: sha(value.text), field, quote: matches[0] };
};
const trainingEvidence = [
  extract('plan/chapters/18', 'scenes', '第132日顾交给他'),
  extract('plan/chapters/18', 'scenes', '两丈两处直接可见普通靶'),
  extract('world/techniques/tech_04', 'cost', '少放几道风刃不按比例免成本'),
  extract('world/techniques/tech_04', 'limitations', '第18章对林的两丈实测'),
  extract('plan/chapters/25', 'scenes', '索段在距林一丈的外耳处外露'),
  extract('plan/chapters/25', 'scenes', '本场剑诀只放一道'),
];
const boundaryEvidence = [
  extract('plan/chapters/43', 'endState', '44从切索同一瞬接续'),
  extract('plan/chapters/44', 'summary', '244'),
];
const snapshotPath = `${root}/story-initial-completed.json`;
const proof = {
  kind: 'design68_story_initial_batches_reconciled', observedAt: checkpoint.updatedAt,
  inputHash: baseline.inputHash, runId: run.id, runStatus: run.status,
  snapshotPath, snapshotSha256: sha(bytes), frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  prefixReplay: replay, initialChecks,
  initialDeferrals: initialChecks.flatMap(stage => stage.checks.filter(check => check.awaitingSources?.length)
    .map(check => ({ checkId: `${stage.stageId}/${check.criterion}`, requestedSources: check.awaitingSources }))),
  trainingEvidence, boundaryEvidence,
  adjudication: {
    training: 'The frozen design contains the requested prior instruction, measured two-zhang range, full two-tenths cost and one-zhang rope target. These primary sources counter a claim that training is absent from the design; they do not formally resolve a pending model source deferral or establish all power rules as correct.',
    boundary: 'Chapter 43 ends with the hook attached and sword not yet used; chapter 44 continues the same rescue. Preserve the pending formal cross-check. Endpoint comparison alone is not a full timeline audit.',
    literaryScope: 'Local passes are design-support judgments, not proof of prose quality or reader appeal. Chapter 18 compresses breakthrough and weeks of practice; later investigation spans many chapters. This distribution warrants whole-arc pacing review but is not itself a defect or an instruction to add free upgrades. Different costs, choices and consequences must be read in context.',
  },
  workerProtectedHistoryCheck: checkpoint.protectedHistoryUnchanged,
  modelCalls: 0, productionWrites: 0, questionsClosed: 0, designApproved: false, proseGenerated: false,
  limitation: 'This is an immutable interim prefix. Later stages, formal source-deferral resolutions and final story verdict remain pending at this observation. Replay checks provenance and canonical scheduling, not semantic correctness. History protection here is the worker assertion, not a fresh independent database audit.',
};
fs.writeFileSync(snapshotPath, bytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-story-initial.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ completedStages: replay.completedStages, responsesReplayed: replay.responsesReplayed,
  initialBatches: batches.length, initialDeferrals: proof.initialDeferrals.length,
  sourceExcerpts: trainingEvidence.length + boundaryEvidence.length, modelCalls: 0, productionWrites: 0 }));
