import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayDesignReviewPrefix } from '../../scripts/audit-design-reviews.mjs';
import { collectDesignReviewInsufficiencies } from '../../scripts/collect-design-review-insufficiencies.mjs';

const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const canonical = v => JSON.parse(JSON.stringify(v));
const binding = read('data/audit-runtimes/design64-runtime-bound.json');
const baseline = read('data/audit-runtimes/design64-control/baseline.json');
const checkpointPath = 'data/audit-runtimes/design64-control/power-completed-checkpoint.json';
if (!process.argv.includes('--use-saved-checkpoint')) {
  fs.copyFileSync('data/audit-runtimes/design64-control/resume-3-result.json', checkpointPath, fs.constants.COPYFILE_EXCL);
}
const checkpoint = read(checkpointPath);
const run = checkpoint.runs.find(r => r.input.area === 'power');
const report = checkpoint.reports.find(r => r.id === run.reportId);
assert.equal(checkpoint.runtimeCommit, binding.commit);
assert.equal(run.input.inputHash, baseline.inputHash);
assert.equal(checkpoint.scope.planId, baseline.planId);
assert.equal(run.status, 'completed');
assert.equal(run.stages.length, 71);
assert.ok(run.stages.every(s => s.result));
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(binding.root + '/' + p), h, p);

// Independently retained earlier snapshot binds the entire input, not only its label.
const prior = read('data/audit-runtimes/design64-control/partial-synthesis-checkpoint.json')
  .runs.find(r => r.id === run.id);
assert.deepEqual(run.input, prior.input);
for (const stage of prior.stages.filter(s => s.result)) {
  assert.deepEqual(run.stages.find(s => s.id === stage.id), stage);
}
const stages = await import(binding.root + '/novel-service-core/src/design-review-run.ts');
const { JsonDesignPlanner } = await import(binding.root + '/packages/planner/src/index.ts');
const before = hash(run), rebuilt = stages.completeDesignReviewRun(run);
const { id, area, inputHash, scope, sources, status, createdAt, runId, ...result } = report;
assert.equal(runId, run.id);
assert.deepEqual({ area, inputHash, scope }, { area: run.input.area, inputHash: run.input.inputHash, scope: run.input.scope });
assert.deepEqual(canonical(sources), canonical(rebuilt.input.sources));
assert.deepEqual(canonical(result), canonical(rebuilt.result));
assert.equal(status, rebuilt.result.checks.some(c => c.verdict === 'revise') ? 'needs_revision'
  : rebuilt.result.checks.some(c => c.verdict === 'insufficient') ? 'inconclusive' : 'passed');
const replay = await replayDesignReviewPrefix(run, prior.input, { ...stages, JsonDesignPlanner });
const insufficiencies = collectDesignReviewInsufficiencies(run, report);
assert.equal(hash(run), before);
const proof = {
  kind: 'completed_power_review_integrity', observedAt: new Date().toISOString(),
  inputHash, runId, reportId: id, status, checkpointPath, checkpointSha256: fileHash(checkpointPath),
  runtimeCommit: binding.commit, sourceFilesVerified: Object.keys(binding.sourceHashes).length,
  priorInputCheckpointSha256: fileHash('data/audit-runtimes/design64-control/partial-synthesis-checkpoint.json'),
  runSha256: before, reportSha256: hash(report), sourceEnvelopeSha256: hash(sources),
  reportChecks: report.checks, resolvedDeferrals: report.resolvedDeferrals,
  replay, insufficiencies,
  negativeFindings: run.stages.flatMap(s => s.result.checks.filter(c => c.verdict === 'revise')
    .map(check => ({ stageId: s.id, originalCheck: check, stageResultSha256: hash(s.result) }))),
  verifierSha256: fileHash('docs/audits/2026-10-16-design64-power-completed-audit.mjs'),
  replayHelperSha256: fileHash('scripts/audit-design-reviews.mjs'),
  insufficiencyCollectorSha256: fileHash('scripts/collect-design-review-insufficiencies.mjs'),
  productionWrites: 0, modelCalls: 0, designApproved: false, questionsResolved: 0,
  limitation: '仅核验已完成力量领域的原始响应、引文、步骤及正式报告一致性；不是语义通过，不替代四领域终检、生产库历史核验和人工争议复评。其他领域仍在运行。',
};
const output = 'docs/audits/2026-10-16-design64-power-completed-audit.json';
fs.writeFileSync(output, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, status, completedStages: replay.completedStages,
  responsesReplayed: replay.responsesReplayed, retainedFailures: replay.failures.length,
  negativeFindings: proof.negativeFindings.length, insufficiencies: insufficiencies.length,
  unresolved: insufficiencies.filter(i => i.disposition === 'unresolved').length,
  resolved: insufficiencies.filter(i => i.disposition === 'resolved_by_raw_review').length,
  ordinary: insufficiencies.filter(i => i.kind === 'ordinary_insufficiency').length,
  unresolvedIds: insufficiencies.filter(i => i.disposition === 'unresolved').map(i => i.checkId) }));
