// Read-only reconciliation. Preserve the actual revise judgment and response.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = value => createHash('sha256').update(value).digest('hex');
const control = 'data/audit-runtimes/design69-review';
const checkpointBytes = fs.readFileSync(`${control}/result.json`), state = JSON.parse(checkpointBytes);
const binding = read('data/audit-runtimes/design69-runtime-bound.json');
for (const [name, expected] of Object.entries(binding.sourceHashes)) assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${name}`)), expected);
const { designReviewStageInput } = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const run = state.runs.find(run => run.input.area === 'world'), stage = run.stages.find(stage => stage.id === 'batch-1');
const request = designReviewStageInput(run, stage), check = stage.result.checks.find(check => check.criterion === 'geography');
assert.equal(check.verdict, 'revise');
assert.equal(request.stage.coverage.mode, 'local_sources');
const ids = ['plan/milestones/ms_v2_voyage', 'plan/milestones/ms_v2_boundary', 'plan/milestones/ms_v3_return'];
const counterevidence = ids.map(id => {
  const source = run.input.sources.find(source => source.id === id);
  assert.ok(source);
  assert.ok(request.stage.coverage.sourceLengths[id] > 0);
  assert.ok(!request.stage.sourceMap.some(unit => unit.sourceId === id));
  const parsed = JSON.parse(source.text);
  return { id, sourceSha256: sha(source.text), title: parsed.title, startChapter: parsed.startChapter, endChapter: parsed.endChapter, text: source.text };
});
assert.ok(counterevidence[0].text.includes('支付10000'));
assert.ok(counterevidence[1].text.includes('具名担保'));
assert.ok(counterevidence[2].text.includes('实付'));
let calls = 0;
const replay = new JsonDesignPlanner({ complete: async () => {
  assert.ok(calls < stage.modelResponses.length);
  return stage.modelResponses[calls++];
} });
const { modelResponses, ...replayed } = await replay.reviewDesignContent(request);
assert.deepEqual(replayed, stage.result);
assert.deepEqual(modelResponses, stage.modelResponses);
fs.writeFileSync(`${control}/world-batch1-dispute.json`, checkpointBytes, { flag: 'wx' });
const proof = {
  kind: 'design69_world_batch1_unread_macro_misclassified', observedAt: new Date().toISOString(),
  runId: run.id, inputHash: run.input.inputHash, stageId: stage.id,
  checkpointSnapshot: `${control}/world-batch1-dispute.json`, snapshotSha256: sha(checkpointBytes),
  requestSha256: sha(JSON.stringify(request)), originalCheck: check,
  coverageMode: request.stage.coverage.mode, counterevidence, originalResponsesReplayed: calls,
  modelCalls: 0, productionWrites: 0, formalJudgmentChanged: false,
  workerStopRequested: { pid: state.pid, signal: 'SIGTERM', behavior: 'Finish in-flight batch then stop; not cancellation of the overall goal' },
  finding: 'The available macro itinerary sources specify the alleged missing funds, tickets, ports and permits, but are not delivered in batch-1. The response treats absence from a local overview as a whole-design gap instead of requesting those existing sources. Preserve the revise verdict and its response; do not modify correct travel canon or silently convert it to pass.',
  limitation: 'This rebuts the stated absence claim, not every aspect of voyage feasibility or full world quality. A stop request is not terminal-state evidence.',
};
fs.writeFileSync('docs/audits/2026-10-17-design69-world-batch1-dispute.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ replayed: calls, scope: request.stage.coverage.mode, omittedExistingSources: ids, originalVerdict: check.verdict, stopRequested: true }));
