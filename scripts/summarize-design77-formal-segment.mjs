// Extract only new stage findings after a verified stopped segment. No verdict
// changes, prose generation, model calls, or automatic issue closure.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const directory = 'data/audit-runtimes/design77-formal-continuation';
const state = read(`${directory}/result.json`), prior = read(`${directory}/segment-${state.segment - 1}.json`);
const verificationPath = `docs/audits/2026-10-18-design77-formal-continuation-segment-${state.segment}.json`, verification = read(verificationPath);
assert.equal(verification.checkpointSha256, sha(`${directory}/result.json`)); assert.equal(verification.workerAbsent, true);
const binding = read('data/audit-runtimes/design77-formal-runtime-bound.json');
const { designReviewStageInput } = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const rows = state.runs.flatMap(run => {
  const original = prior.runs.find(item => item.id === run.id); assert.ok(original);
  return run.stages.filter(stage => stage.result && !original.stages.find(old => old.id === stage.id)?.result).map(stage => {
    const input = designReviewStageInput(run, stage), sourceIds = [...new Set(input.stage.sourceMap.map(unit => unit.sourceId))];
    return { area: run.input.area, runId: run.id, stageId: stage.id, summary: stage.result.summary, sourceCharacters: JSON.stringify(input.sources).length,
      chapters: sourceIds.filter(id => id.startsWith('plan/chapters/')).map(id => Number(id.split('/').at(-1))),
      sourceIds, checks: stage.result.checks.map(check => ({ ...check, evidence: check.evidence.map(evidence => {
        const unit = input.stage.sourceMap.find(unit => unit.id === evidence.sourceId);
        return { ...evidence, originalSourceId: unit?.sourceId ?? evidence.sourceId, unitStart: unit?.start };
      }) })) };
  });
});
assert.equal(rows.length, state.completedThisSegment);
const proof = { verificationPath, verificationSha256: sha(verificationPath), checkpointSha256: verification.checkpointSha256,
  segment: state.segment, completedThisSegment: rows.length, newCalls: state.totalCalls - state.previousCalls, rows,
  modelCalls: 0, productionWrites: 0, formalAcceptance: false,
  limitation: 'Verbatim new local findings with source identity; not an independent semantic validation or final domain verdict.' };
const out = `docs/audits/2026-10-18-design77-formal-continuation-segment-${state.segment}-findings.json`;
fs.writeFileSync(out, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx', flush: true });
console.log(JSON.stringify({ completedThisSegment: rows.length, newCalls: proof.newCalls, findings: rows.map(row => ({ area: row.area, stage: row.stageId, chapters: row.chapters, checks: row.checks.map(check => ({ criterion: check.criterion, verdict: check.verdict, awaitingSources: check.awaitingSources })) })), formalAcceptance: false }));
