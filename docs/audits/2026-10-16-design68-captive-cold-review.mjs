import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayDesignReviewPrefix } from '../../scripts/audit-design-reviews.mjs';

const read = path => JSON.parse(fs.readFileSync(path));
const sha = value => createHash('sha256').update(value).digest('hex');
const control = 'data/audit-runtimes/design68-review';
const bytes = fs.readFileSync(`${control}/result.json`);
const checkpoint = JSON.parse(bytes);
const inputs = read(`${control}/inputs.json`);
const baseline = read(`${control}/baseline.json`);
const binding = read('data/audit-runtimes/design68-runtime-bound.json');
assert.equal(checkpoint.inputHash, baseline.inputHash);
assert.equal(sha(fs.readFileSync('scripts/run-design68-review.mjs')), baseline.runnerSha256);
for (const [path, expected] of Object.entries(binding.sourceHashes)) {
  assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
}
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const run = checkpoint.runs.find(run => run.input.area === 'world');
const replay = await replayDesignReviewPrefix(run, inputs.world, { ...runtime, JsonDesignPlanner });
const stage = run.stages.find(stage => stage.id === 'cross-5-6');
const check = stage.result.checks.find(check => check.criterion === 'geography');
assert.equal(check.verdict, 'revise');
const milestone = inputs.world.sources.find(source => source.id === 'plan/milestones/ms_v2_boundary');
assert.ok(milestone.text.includes('七名被扣在普通货舱'));
assert.ok(milestone.text.includes('291行动前'));
assert.ok(milestone.text.includes('近舱港卫推开舱门后先在门内发救助包'));
const snapshotPath = `${control}/captive-cold-prefix.json`;
const sources = inputs.world.sources.filter(source => /七名|七人|7名|7人/.test(source.text)
  && /矿工|货舱/.test(source.text));
const proof = {
  kind: 'design68_captive_cold_negative_review_preserved', observedAt: checkpoint.updatedAt,
  inputHash: checkpoint.inputHash, runId: run.id, snapshotPath, snapshotSha256: sha(bytes),
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  prefixReplay: replay, stageSha256: sha(JSON.stringify(stage)), originalNegative: check,
  relatedSourceInventory: sources.map(source => ({ id: source.id, sha256: sha(source.text) })),
  inventoryLimitation: 'Literal seven-person/miner/cargo search is navigation, not an exhaustive semantic proof of absence.',
  humanDisposition: {
    status: 'repair_candidate_pending_complete_four_area_review',
    acceptedConcern: 'Frozen proposal specifies rescue and shelter after opening the cargo hold, but does not establish the seven captives’ prior cold exposure duration or protection while detained. This needs an explicit account before design acceptance.',
    disputedWording: 'The equipment is purchased before the rescue and issued after opening the hold. Do not rewrite this as procurement only after rescue. Illegal transport/detention need not become legal; distinguish physical survival from evasion or failure of port controls.',
    requiredRepairEvidence: [
      'Actual arrival/transfer and detention interval, with a bounded exposure duration.',
      'Physical protection during transport and detention, including who maintains it and available supplies; or explicit exposure and consistent health consequences.',
      'How detention/transport occurred under existing port controls, without implying rescue officials authorized it or know its full history.',
      'Keep day 291 rescue, seven distinct miners, post-rescue funding, and individual health checks consistent; evaluate any proposed date or cost changes across linked sources.',
    ],
    forbiddenShortcuts: ['Inventing prior heating as an already established fact', 'Charging prior detention costs to the rescue fund without a source', 'Using unrelated local passes to erase this negative review', 'Expanding chapters 51–100 to satisfy this audit'],
  },
  modelCalls: 0, productionWrites: 0, questionsClosed: 0, formalAcceptance: false,
};
fs.writeFileSync(snapshotPath, bytes, { flag: 'wx' });
fs.writeFileSync('docs/audits/2026-10-16-design68-captive-cold-review.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ completed: replay.completedStages, responsesReplayed: replay.responsesReplayed,
  negativeStage: stage.id, verdict: check.verdict, relatedSources: sources.length,
  modelCalls: 0, productionWrites: 0, formalAcceptance: false }));
