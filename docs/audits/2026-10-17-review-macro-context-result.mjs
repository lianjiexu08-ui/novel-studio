// Offline model-response replay and an independent, read-only production check.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const fileHash = file => sha(fs.readFileSync(file));
const preflight = read('docs/audits/2026-10-17-review-macro-context-preflight.json');
const stopped = read('docs/audits/2026-10-17-design69-review-stopped.json');
const baseline = read('data/audit-runtimes/design69-review/baseline.json');
const resultPath = 'data/audit-runtimes/design69-macro-context-probe/result.json';
const experiment = read(resultPath), input = read(preflight.inputPath);
assert.equal(experiment.status, 'completed');
assert.equal(experiment.usage.calls, 1);
assert.equal(experiment.runtimeUnchanged, true);
assert.equal(fileHash(preflight.inputPath), preflight.inputSha256);
assert.equal(fileHash('data/audit-runtimes/design69-review/result.json'), stopped.checkpointSha256);
assert.equal(stopped.checkpointSha256, preflight.stoppedCheckpointSha256);
for (const [name, expected] of Object.entries(preflight.sourceHashes)) assert.equal(fileHash(`${preflight.runtimePath}/${name}`), expected);
const { JsonDesignPlanner } = await import(`${preflight.runtimePath}/packages/planner/src/index.ts`);
let responsesReplayed = 0;
const planner = new JsonDesignPlanner({ complete: async () => {
  assert.ok(responsesReplayed < experiment.result.modelResponses.length);
  return experiment.result.modelResponses[responsesReplayed++];
} });
assert.deepEqual(await planner.reviewDesignContent(input), experiment.result);
// Verify every resolved quote against the delivered raw units, not a summary.
for (const check of experiment.result.checks) for (const evidence of check.evidence) {
  assert.ok(input.sources.find(source => source.id === evidence.sourceId)?.text.includes(evidence.quote));
}
const geography = experiment.result.checks.find(check => check.criterion === 'geography');
const citedSourceIds = [...new Set(geography.evidence.map(evidence => input.stage.sourceMap.find(unit => unit.id === evidence.sourceId)?.sourceId))];
for (const id of ['world/locations/loc_21', 'plan/milestones/ms_v2_voyage', 'plan/milestones/ms_v2_boundary', 'plan/milestones/ms_v3_return']) assert.ok(citedSourceIds.includes(id));
assert.equal(geography.verdict, 'pass');
const { PrismaWorkRepository } = await import(`${preflight.runtimePath}/packages/persistence/src/prisma-repository.ts`);
const prisma = new PrismaClient({ datasources: { db: { url: `file:${process.cwd()}/data/novel-studio.db` } } });
let production;
try {
  production = await prisma.$transaction(async tx => {
    const work = await new PrismaWorkRepository(tx).get(stopped.scope.workId);
    assert.ok(work);
    const protectedHash = hash({ world: work.worldPack, bible: work.storyBible, plans: [...work.plans], activePlanId: work.activePlanId,
      versions: [...work.versions], events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] });
    assert.equal(protectedHash, stopped.protectedHash);
    for (const [id, expected] of baseline.oldRuns) assert.equal(hash(work.designReviewRuns.get(id)), expected);
    for (const [id, expected] of baseline.oldReports) assert.equal(hash(work.designContentReviews.get(id)), expected);
    const checkpoint = read('data/audit-runtimes/design69-review/result.json');
    for (const run of checkpoint.runs) assert.deepEqual(work.designReviewRuns.get(run.id), run);
    assert.equal(work.designReviewRuns.size, stopped.counts.runs);
    assert.equal(work.designContentReviews.size, stopped.counts.reports);
    return { protectedHash, runs: work.designReviewRuns.size, reports: work.designContentReviews.size,
      oldRunsUnchanged: baseline.oldRuns.length, oldReportsUnchanged: baseline.oldReports.length, stoppedRunsUnchanged: checkpoint.runs.length };
  });
} finally { await prisma.$disconnect(); }
const proof = { observedAt: new Date().toISOString(), kind: 'world_macro_context_bounded_probe',
  resultPath, resultSha256: fileHash(resultPath), inputSha256: preflight.inputSha256, inputHash: preflight.inputHash,
  model: experiment.model, fallback: experiment.fallback, actualModelCalls: experiment.usage.calls,
  verificationModelCalls: 0, responsesReplayed, allQuotesInDeliveredSources: true,
  checks: experiment.result.checks.map(({ criterion, verdict, explanation }) => ({ criterion, verdict, explanation })),
  geographyCitedSourceIds: citedSourceIds, production, productionWrites: 0, formalAcceptance: false,
  limitation: 'Actual v30 batch-1 differs in scheduling and guidance from v29; this is not a one-variable experiment. Three local criteria passing does not validate other batches, dynamic followups, synthesis, other domains, detailed outlines or prose. Original revise remains preserved.' };
const output = 'docs/audits/2026-10-17-review-macro-context-result.json';
assert.ok(!fs.existsSync(output), 'Keep previous verification evidence');
fs.writeFileSync(output, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ responsesReplayed, quotesVerified: true, checks: proof.checks.map(({ criterion, verdict }) => ({ criterion, verdict })), production }));
