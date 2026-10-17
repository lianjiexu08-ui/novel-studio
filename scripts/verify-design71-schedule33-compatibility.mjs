// Offline compatibility proof against the immutable, actually reviewed v32 prefix.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as current from '../novel-service-core/src/design-review-run.ts';
import { JsonDesignPlanner } from '../packages/planner/src/index.ts';
import { replayDesignReviewPrefix } from './audit-design-reviews.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => JSON.parse(fs.readFileSync(path));
const root = 'data/audit-runtimes/design71-review';
const proofPath = 'docs/audits/2026-10-17-design71-schedule33-compatibility.json';
assert.ok(!fs.existsSync(proofPath), 'Preserve the existing proof');
const baseline = read(`${root}/baseline.json`);
const bindingBytes = fs.readFileSync('data/audit-runtimes/design71-runtime-bound.json');
assert.equal(hash(bindingBytes), baseline.runtimeBindingSha256);
const binding = JSON.parse(bindingBytes);
for (const [path, expected] of Object.entries(binding.sourceHashes)) {
  assert.equal(hash(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
}
assert.equal(hash(fs.readFileSync('scripts/run-design71-review.mjs')), baseline.runnerSha256);
const prefixBytes = fs.readFileSync(`${root}/world-followup-prefix.json`);
const preflight = read('docs/audits/2026-10-17-design71-world-followup-preflight.json');
assert.equal(hash(prefixBytes), preflight.snapshotSha256);
const run = JSON.parse(prefixBytes).runs.find(run => run.input.area === 'world');
assert.equal(run.scheduleVersion, 32);
const inputBytes = fs.readFileSync(`${root}/inputs.json`);
assert.equal(hash(inputBytes), baseline.inputsSha256);
const input = JSON.parse(inputBytes).world;
const frozen = await import(pathToFileURL(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`));
const { JsonDesignPlanner: FrozenPlanner } = await import(pathToFileURL(`${binding.runtimePath}/packages/planner/src/index.ts`));
function capture(Planner, calls) {
  return class extends Planner {
    constructor(client) {
      super({ complete: async request => { calls.push(request); return client.complete(request); } });
    }
  };
}
const oldCalls = [], newCalls = [];
const oldReplay = await replayDesignReviewPrefix(run, input, { ...frozen, JsonDesignPlanner: capture(FrozenPlanner, oldCalls) });
const newReplay = await replayDesignReviewPrefix(run, input, { ...current, JsonDesignPlanner: capture(JsonDesignPlanner, newCalls) });
assert.deepEqual(newReplay, oldReplay, 'Saved responses, conclusions, and pending schedule must replay identically');
assert.deepEqual(newCalls, oldCalls, 'Every actual model request, including prompts and anchors, must be unchanged');
const comparedStages = [];
for (const stage of run.stages) {
  const before = JSON.stringify(frozen.designReviewStageInput(run, stage));
  const after = JSON.stringify(current.designReviewStageInput(run, stage));
  assert.equal(after, before, stage.id);
  comparedStages.push({ stageId: stage.id, inputSha256: hash(after), completed: !!stage.result });
  if (!stage.result) break;
}
const sourceFiles = ['novel-service-core/src/design-review-run.ts', 'novel-service-core/src/design-review.ts',
  'packages/planner/src/index.ts', 'packages/planner/src/design-review-evidence.ts'];
const proof = { observedAt: new Date().toISOString(), inputHash: run.input.inputHash, runId: run.id,
  snapshotSha256: hash(prefixBytes), frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  currentSourceHashes: Object.fromEntries(sourceFiles.map(path => [path, hash(fs.readFileSync(path))])),
  identicalModelRequests: newCalls.length, requestsSha256: hash(JSON.stringify(newCalls)),
  comparedStages, responseReplay: newReplay, modelCalls: 0, productionWrites: 0, formalAcceptance: false,
  limitation: 'Verifies v32 prefix compatibility only. New v33 chaining has automated fixture coverage, not a live model evaluation. No saved finding is changed or approved.' };
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ identicalModelRequests: newCalls.length, identicalStageInputs: comparedStages.length,
  responsesReplayed: newReplay.responsesReplayed, modelCalls: 0, formalAcceptance: false }));
