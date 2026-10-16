import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayDesignReviewPrefix } from '../../scripts/audit-design-reviews.mjs';

const read = p => JSON.parse(fs.readFileSync(p));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const checkpointPath = 'data/audit-runtimes/design64-control/resume-3-result.json';
const checkpointSha256 = fileHash(checkpointPath);
assert.equal(checkpointSha256, '2d0dc26bdc499bb2b61d72fd4913626d42f6957118d6f25b68fdaa95370fd063');
const checkpoint = read(checkpointPath), binding = read('data/audit-runtimes/design64-runtime-bound.json');
assert.equal(checkpoint.status, 'stopped_after_failure');
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(binding.root + '/' + p), h);
const run = checkpoint.runs.find(r => r.input.area === 'characters');
const prior = read('data/audit-runtimes/design64-control/power-completed-checkpoint.json').runs.find(r => r.id === run.id);
assert.deepEqual(run.input, prior.input);
for (const s of prior.stages.filter(s => s.result)) assert.deepEqual(run.stages.find(t => t.id === s.id), s);
const stages = await import(binding.root + '/novel-service-core/src/design-review-run.ts');
const { JsonDesignPlanner } = await import(binding.root + '/packages/planner/src/index.ts');
const { prepareDesignReviewEvidence, DesignReviewInsufficiencyError } = await import(binding.root + '/packages/planner/src/design-review-evidence.ts');
const replay = await replayDesignReviewPrefix(run, prior.input, { ...stages, JsonDesignPlanner });
const stage = run.stages.find(s => s.id === 'cross-3-4');
assert.equal(stage.result, undefined);
assert.equal(stage.failures.length, 1);
const input = stages.designReviewStageInput(run, stage), prepared = prepareDesignReviewEvidence(input);
assert.equal(input.stage.requireInsufficiencyReason, true);
const responses = stage.failures[0].modelResponses.map((raw, index) => {
  const value = JSON.parse(raw), check = value.checks.find(c => c.criterion === 'relationships');
  assert.equal(value.requestId, prepared.requestId);
  assert.equal(check.verdict, 'insufficient');
  assert.equal(check.awaitingSources, undefined);
  assert.equal(check.insufficiencyReason, undefined);
  assert.throws(() => prepared.resolve(value), DesignReviewInsufficiencyError);
  return { response: index + 1, sha256: hash(raw), originalCheck: check, rejectionReproduced: true };
});
assert.equal(responses.length, 2);
const relationshipSources = Object.keys(input.stage.coverage.sourceLengths).filter(id => id.startsWith('story/relationships/'));
assert.equal(relationshipSources.length, 22);
const proof = { observedAt: new Date().toISOString(), checkpointPath, checkpointSha256,
  runtimeCommit: binding.commit, inputHash: run.input.inputHash, runId: run.id, stageId: stage.id,
  stageSha256: hash(stage), stageInputSha256: hash(input), replay,
  relationshipSources, directlySuppliedRelationshipSources: [...new Set(input.stage.sourceMap.map(u => u.sourceId))].filter(id => relationshipSources.includes(id)),
  responses, originalFailure: stage.failures[0].error,
  disposition: 'retry_same_stage_without_changing_frozen_input_or_acceptance_rules',
  modelCalls: 0, productionWrites: 0, findingsOverridden: false, designApproved: false,
  limitation: '确认失败源于必需不足分类缺失，不证明人物设计通过，也不替模型补写来源或删除问题。当前恢复继续使用冻结运行时。' };
fs.writeFileSync('docs/audits/2026-10-16-design64-character-classification-failure.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ acceptedStepsReplayed: replay.completedStages, acceptedResponsesReplayed: replay.responsesReplayed,
  rejectedResponses: responses.length, relationshipSources: relationshipSources.length,
  directlySuppliedRelationshipSources: proof.directlySuppliedRelationshipSources.length, modelCalls: 0, productionWrites: 0 }));
