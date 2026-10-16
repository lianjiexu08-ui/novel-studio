import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { designReviewStageInput, designReviewResolutionContext } from '../../novel-service-core/src/design-review-run.ts';
const read = path => JSON.parse(fs.readFileSync(path));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const binding = read('data/audit-runtimes/design68-runtime-bound.json');
const baseline = read('data/audit-runtimes/design68-review/baseline.json');
const bytes = fs.readFileSync('data/audit-runtimes/design68-review/result.json');
const checkpoint = JSON.parse(bytes);
assert.equal(checkpoint.status, 'completed');
assert.equal(checkpoint.inputHash, baseline.inputHash);
for (const [path, expected] of Object.entries(binding.sourceHashes))
  assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
const frozen = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const rows = [];
let probe;
for (const run of checkpoint.runs) {
  const first = run.stages.findIndex(stage => stage.kind === 'synthesis');
  const context = designReviewResolutionContext(run, first);
  assert.ok(context);
  const records = JSON.parse(context.text.slice(context.text.indexOf('{'))).resolvedDeferrals;
  for (const stage of run.stages) {
    const original = frozen.designReviewStageInput(run, stage);
    assert.deepEqual(designReviewStageInput(run, stage), original, 'Legacy request bytes changed');
    if (stage.kind !== 'synthesis') continue;
    assert.deepEqual(original.stage.coverage.resolvedDeferrals,
      records.map(({ checkId, resolvedByStageId }) => ({ checkId, resolvedByStageId })));
    const augmented = { ...original, sources: [...original.sources, context] };
    const originalSize = JSON.stringify(original.sources).length;
    const augmentedSize = JSON.stringify(augmented.sources).length;
    assert.ok(augmentedSize <= 240_000, `${run.input.area}/${stage.id}: ${augmentedSize}`);
    rows.push({ area: run.input.area, stageId: stage.id, originalSize, augmentedSize,
      contextSha256: sha(context.text), originalRequestSha256: sha(JSON.stringify(original)),
      augmentedRequestSha256: sha(JSON.stringify(augmented)) });
    if (run.input.area === 'story' && stage.id === 'synthesis-22') {
      assert.equal(records.length, 23);
      assert.ok(records.some(record => record.checkId === 'batch-5/timeline' && record.resolvedByStageId === 'cross-4-5'));
      probe = { input: augmented, originalCheck: stage.result.checks.find(check => check.criterion === 'timeline'),
        originalRequestSha256: sha(JSON.stringify(original)), contextSourceId: context.id };
    }
  }
}
assert.ok(probe);
const control = 'data/audit-runtimes/design68-resolution-context-probe';
fs.mkdirSync(control);
const inputPath = `${control}/input.json`;
fs.writeFileSync(inputPath, JSON.stringify(probe.input), { flag: 'wx' });
const proof = {
  kind: 'quotable_resolution_context_preflight', observedAt: new Date().toISOString(),
  checkpointSha256: sha(bytes), inputHash: checkpoint.inputHash,
  legacyRequestsCompared: checkpoint.runs.reduce((n, run) => n + run.stages.length, 0),
  synthesisRequestsCompared: rows.length, maxAugmentedSourceCharacters: Math.max(...rows.map(row => row.augmentedSize)), rows,
  inputPath, inputSha256: sha(fs.readFileSync(inputPath)), originalRequestSha256: probe.originalRequestSha256,
  contextSourceId: probe.contextSourceId, originalTimelineCheck: probe.originalCheck,
  runtimeSourceHashes: Object.fromEntries(Object.keys(binding.sourceHashes).map(path => [path, sha(fs.readFileSync(path))])),
  modelCalls: 0, productionWrites: 0, designApproved: false,
  limitation: 'All 272 saved v26 requests remain exact. Capacity checks add one validated context source to each old synthesis request; this isolates the change, not a claim that old responses were produced by v29 or that future regenerated reports will always fit. The live probe changes only that source envelope and cannot replace any formal report.',
};
fs.writeFileSync('docs/audits/2026-10-16-review-resolution-context-preflight.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ legacyRequestsCompared: proof.legacyRequestsCompared, synthesisRequestsCompared: rows.length,
  maxAugmentedSourceCharacters: proof.maxAugmentedSourceCharacters, inputSha256: proof.inputSha256, modelCalls: 0 }));
