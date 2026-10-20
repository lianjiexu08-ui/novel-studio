// Validate the new recheck implementation against every saved formal response,
// then prepare detached challenges. No model calls or production DB writes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as runtime from '../novel-service-core/src/design-review-run.ts';
import { designReviewCheckHash } from '../novel-service-core/src/design-review-annotations.ts';
import { JsonDesignPlanner } from '../packages/planner/src/index.ts';
import { replayDesignReviewRecord } from './audit-design-reviews.mjs';
import { sourceNavigationGuidance } from './design-review-source-navigation.mjs';
const read = p => JSON.parse(fs.readFileSync(p));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const control = 'data/audit-runtimes/design77-formal-continuation', statePath = `${control}/result.json`, state = read(statePath);
assert.equal(state.segment, 3); assert.equal(state.status, 'stopped_after_stage_limit');
try { process.kill(state.pid, 0); assert.fail('Worker still live'); } catch (error) { assert.equal(error.code, 'ESRCH'); }
const verificationPath = 'docs/audits/2026-10-18-design77-formal-continuation-segment-3.json', verification = read(verificationPath);
assert.equal(verification.checkpointSha256, sha(statePath)); assert.equal(verification.unsettledCalls, 0);
const oldBinding = read('data/audit-runtimes/design77-formal-runtime-bound.json');
const old = await import(`${oldBinding.runtimePath}/novel-service-core/src/design-review-run.ts`);
for (const [file, digest] of Object.entries(oldBinding.sourceHashes)) assert.equal(sha(`${oldBinding.runtimePath}/${file}`), digest);
const journal = verification.journal.map(item => ({ ...item, start: read(`${control}/model-calls/${String(item.callNumber).padStart(5, '0')}.started.json`) }));
const results = [];
for (const run of state.runs) {
  const accepted = run.stages.filter(stage => stage.result).flatMap(stage => journal.filter(call => call.start.step.runId === run.id && call.start.step.stageId === stage.id && call.responseSha256).slice(-(stage.modelResponses?.length ?? 0)));
  let calls = 0;
  for (const stage of run.stages.filter(stage => stage.result)) assert.deepEqual(runtime.designReviewStageInput(run, stage), old.designReviewStageInput(run, stage));
  class CheckingPlanner extends JsonDesignPlanner {
    constructor(client) { super({ complete: async request => {
      const saved = accepted[calls++]; assert.ok(saved);
      assert.equal(saved.start.request.user, request.user);
      assert.equal(saved.start.request.maxOutputTokens, request.maxOutputTokens);
      if (saved.callNumber === 22) assert.equal(saved.start.request.system, request.system);
      else { assert.ok(saved.start.request.system.startsWith(request.system)); assert.ok(saved.start.request.system.endsWith(sourceNavigationGuidance)); }
      return client.complete(request);
    } }); }
  }
  const result = await replayDesignReviewRecord(run, run.input, state.reports.find(report => report.id === run.reportId), { ...runtime, JsonDesignPlanner: CheckingPlanner });
  assert.equal(calls, accepted.length); results.push({ area: run.input.area, calls, ...result });
}
const diagnosisPath = 'docs/audits/2026-10-20-design77-power-cross-source-navigation.json', diagnosis = read(diagnosisPath);
const run = state.runs.find(run => run.id === diagnosis.runId), original = run.stages.find(stage => stage.id === diagnosis.stageId);
assert.ok(original.result);
const out = path.resolve('data/audit-runtimes/design77-source-navigation');
assert.ok(!fs.existsSync(out), 'Preserve earlier preparation; inspect it before retrying');
fs.mkdirSync(out, { recursive: true });
const createdAt = new Date().toISOString(), proposals = [];
for (const row of diagnosis.rows) {
  const check = original.result.checks.find(check => check.criterion === row.criterion);
  const note = { id: `design77-source-navigation-${row.criterion}`, createdAt, requestKey: `design77-power-cross1-2-navigation-${row.criterion}`,
    runId: run.id, stageId: original.id, criterion: row.criterion, expectedInputHash: run.input.inputHash, expectedCheckHash: designReviewCheckHash(check),
    claimQuote: check.explanation, explanation: '本次原请求的sourceLengths及planRanges已列出对应宏观来源，但该批未携带其原文。请核验整项原不足，不把定位成功当作设计通过；不要求先补51—100章逐章细纲。',
    evidence: row.candidateSources.map(source => ({ sourceId: source.sourceId, quote: source.exactQuote })), scope: structuredClone(run.input.scope) };
  const detached = structuredClone(run), stage = runtime.queueDesignReviewReconsideration(detached, note), input = runtime.designReviewStageInput(detached, stage);
  assert.equal(detached.reconsiderations.at(-1).version, 2); assert.equal(input.stage.reconsiderationKind, 'source_navigation');
  assert.deepEqual(detached.input, run.input);
  for (const stage of run.stages.filter(stage => stage.result)) assert.deepEqual(detached.stages.find(item => item.id === stage.id), stage);
  const proposal = { note, stageId: stage.id, sourceCharacters: JSON.stringify(input.sources).length, pending: input.stage.coverage.pendingChecks.find(item => item.id === stage.reconsiderationFor) };
  fs.writeFileSync(`${out}/${row.criterion}.json`, JSON.stringify({ ...proposal, input }, null, 2) + '\n', { flag: 'wx' });
  proposals.push(proposal);
}
const changedSources = ['novel-service-core/src/design-review-run.ts', 'novel-service-core/src/design-review.ts', 'novel-service-core/src/design-review-report.ts', 'packages/planner/src/index.ts', 'apps/api/src/server.ts', 'apps/web/src/pages/ReviewAnnotations.tsx'];
const proof = { prepared: true, checkpointPath: statePath, checkpointSha256: sha(statePath), verificationPath, verificationSha256: sha(verificationPath),
  diagnosisPath, diagnosisSha256: sha(diagnosisPath), sourceHashes: Object.fromEntries(changedSources.map(file => [file, sha(file)])),
  replays: results, proposals, modelCalls: 0, productionWrites: 0, originalVerdictsUnchanged: true, formalAcceptance: false,
  limitation: 'Three independent detached insertion preflights. No production annotation, queued recheck, new runtime deployment, or model judgment is claimed; execution must bind the then-current checkpoint and run each challenge sequentially.' };
fs.writeFileSync('docs/audits/2026-10-20-design77-source-navigation-preflight.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ prepared: true, replayedResponses: results.reduce((n, result) => n + result.calls, 0), proposals: proposals.map(p => ({ criterion: p.note.criterion, sourceCharacters: p.sourceCharacters })), formalAcceptance: false }));
