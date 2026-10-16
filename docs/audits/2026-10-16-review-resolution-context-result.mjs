import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { JsonDesignPlanner } from '../../packages/planner/src/index.ts';
const read = path => JSON.parse(fs.readFileSync(path));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const preflight = read('docs/audits/2026-10-16-review-resolution-context-preflight.json');
const resultPath = 'data/audit-runtimes/design68-resolution-context-probe/result.json';
const bytes = fs.readFileSync(resultPath), run = JSON.parse(bytes);
assert.equal(run.status, 'completed');
assert.equal(run.runtimeUnchanged, true);
assert.equal(run.modelCalls, 1);
assert.equal(sha(fs.readFileSync(preflight.inputPath)), preflight.inputSha256);
assert.equal(sha(fs.readFileSync('data/audit-runtimes/design68-review/result.json')), preflight.checkpointSha256);
for (const [path, expected] of Object.entries(preflight.runtimeSourceHashes)) assert.equal(sha(fs.readFileSync(path)), expected, path);
let calls = 0;
const planner = new JsonDesignPlanner({ complete: async () => {
  assert.ok(calls < run.result.modelResponses.length);
  return run.result.modelResponses[calls++];
} });
assert.deepEqual(await planner.reviewDesignContent(read(preflight.inputPath)), run.result);
assert.equal(calls, run.result.modelResponses.length);
const timeline = run.result.checks.find(check => check.criterion === 'timeline');
assert.equal(timeline.verdict, 'pass');
assert.ok(timeline.explanation.includes('等待补读得到解决'));
const directEvidence = timeline.evidence.filter(item => item.sourceId === preflight.contextSourceId);
assert.ok(directEvidence.some(item => item.quote.includes('plan/chapters/43') && item.quote.includes('resolutionExplanation')));
const proof = {
  kind: 'isolated_quotable_resolution_context_model_probe', observedAt: run.finishedAt,
  preflightPath: 'docs/audits/2026-10-16-review-resolution-context-preflight.json',
  inputSha256: preflight.inputSha256, resultPath, resultSha256: sha(bytes), model: run.model,
  modelCalls: run.modelCalls, responsesReplayed: calls, replayModelCalls: 0,
  original: { stageId: 'synthesis-22', criterion: 'timeline', verdict: preflight.originalTimelineCheck.verdict,
    explanation: preflight.originalTimelineCheck.explanation },
  revisedProbe: timeline,
  checks: run.result.checks.map(({ evidence, ...check }) => ({ ...check, evidenceCount: evidence.length })),
  formalCheckpointUnchanged: true, productionWrites: 0, formalAcceptance: false,
  limitation: 'One current-model experiment added only validated resolution context to the frozen synthesis-22 request. The reviewer cited that context and no longer reopened the historical wait in this sample. This is not a replacement formal report, full v29 run, proof against all semantic errors, or approval of the proposed design.',
};
fs.writeFileSync('docs/audits/2026-10-16-review-resolution-context-result.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ original: proof.original.verdict, probe: timeline.verdict, directlyCitedResolution: true,
  modelCalls: run.modelCalls, responsesReplayed: calls, productionWrites: 0, formalAcceptance: false }));
