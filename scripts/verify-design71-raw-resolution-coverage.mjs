// Actual v32 evidence and hypothetical v34 source eligibility; no model call or resolution.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as current from '../novel-service-core/src/design-review-run.ts';
import { replayDesignReviewPrefix } from './audit-design-reviews.mjs';
import { prepareDesignReviewEvidence } from '../packages/planner/src/design-review-evidence.ts';
const read = file => JSON.parse(fs.readFileSync(file));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash = file => hash(fs.readFileSync(file));
const proofPath = 'docs/audits/2026-10-17-design71-raw-resolution-coverage.json';
assert.ok(!fs.existsSync(proofPath), 'Preserve prior proof');
const candidate = read('docs/audits/2026-10-17-design71-world-candidate.json');
assert.equal(fileHash(candidate.snapshotPath), candidate.snapshotSha256);
const run = read(candidate.snapshotPath).runs.find(r => r.input.area === 'world');
const before = hash(JSON.stringify(run));
const baseline = read('data/audit-runtimes/design71-review/baseline.json');
const inputsPath = 'data/audit-runtimes/design71-review/inputs.json';
assert.equal(fileHash(inputsPath), baseline.inputsSha256);
const input = read(inputsPath).world;
const bindingPath = 'data/audit-runtimes/design71-runtime-bound.json', binding = read(bindingPath);
assert.equal(fileHash(bindingPath), baseline.runtimeBindingSha256);
assert.equal(fileHash('scripts/run-design71-review.mjs'), baseline.runnerSha256);
for (const [file, expected] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(`${binding.runtimePath}/${file}`), expected, file);
const frozen = await import(pathToFileURL(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`));
assert.equal(run.scheduleVersion, 32);
const replay = await replayDesignReviewPrefix(run, input);
const unchangedInputs = [];
for (const stage of run.stages) {
  const old = JSON.stringify(frozen.designReviewStageInput(run, stage));
  const next = JSON.stringify(current.designReviewStageInput(run, stage));
  assert.equal(next, old, stage.id);
  unchangedInputs.push({ stageId: stage.id, inputSha256: hash(next) });
  if (!stage.result) break;
}

const origin = run.stages.find(s => s.id === 'cross-2-4');
const pendingId = `${origin.id}/geography`, originalCheck = origin.result.checks.find(c => c.criterion === 'geography');
const later = run.stages.find(s => s.id === 'cross-2-5');
assert.equal(originalCheck.verdict, 'insufficient');
assert.deepEqual(originalCheck.awaitingSources, ['plan/chapters/31']);
const expectedBasis = [...new Set(originalCheck.evidence.map(e => run.units.find(u => u.id === e.sourceId).sourceId))];
assert.ok(!origin.unitIds.every(id => later.unitIds.includes(id)));
const requests = {};
for (const version of [33, 34]) {
  const hypothetical = current.createDesignReviewRun(input, run.createdAt, version);
  assert.deepEqual(hypothetical.units, run.units);
  // Copy only one historical question to inspect coverage eligibility. These
  // are not replayed model judgments for v34 and no report is completed/saved.
  hypothetical.stages.find(s => s.id === origin.id).result = structuredClone(origin.result);
  const stage = hypothetical.stages.find(s => s.id === later.id);
  assert.deepEqual(stage.unitIds, later.unitIds);
  requests[version] = current.designReviewStageInput(hypothetical, stage);
}
assert.ok(!requests[33].stage.coverage.pendingChecks?.some(p => p.id === pendingId));
const question = requests[34].stage.coverage.pendingChecks.find(p => p.id === pendingId);
assert.ok(question); assert.deepEqual(question.priorSourceIds, expectedBasis);
assert.deepEqual(question.requiredSourceIds, originalCheck.awaitingSources);
const sourceRecords = [];
for (const id of [...expectedBasis, ...originalCheck.awaitingSources, 'plan/chapters/32']) {
  const request = requests[34], source = input.sources.find(s => s.id === id);
  const units = request.stage.sourceMap.filter(u => u.sourceId === id).sort((a, b) => a.start - b.start);
  assert.ok(units.length, id);
  assert.equal(units[0].start, 0); assert.equal(units.at(-1).end, source.text.length);
  units.slice(1).forEach((unit, i) => assert.equal(unit.start, units[i].end));
  assert.equal(units.map(u => request.sources.find(s => s.id === u.id).text).join(''), source.text);
  sourceRecords.push({ id, characters: source.text.length, sha256: hash(source.text) });
}
const requirements = prepareDesignReviewEvidence(requests[34]).pendingCitationRequirements.find(p => p.checkId === pendingId);
assert.deepEqual(requirements.requiredSources.map(s => s.sourceId), [question.questionSourceId, ...expectedBasis, ...originalCheck.awaitingSources]);
assert.ok(requirements.requiredSources.every(s => s.units.length && s.units.every(u => u.fragmentIds.length)));
assert.equal(hash(JSON.stringify(run)), before);
const proof = { observedAt: new Date().toISOString(), inputHash: input.inputHash, runId: run.id,
  sourceSnapshot: candidate.snapshotPath, sourceSnapshotSha256: candidate.snapshotSha256,
  frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  currentSchedulerSha256: fileHash('novel-service-core/src/design-review-run.ts'),
  unchangedV32Inputs: unchangedInputs, v32ResponseReplay: replay,
  originalQuestion: { stageId: origin.id, check: originalCheck }, laterStageId: later.id,
  originalFullBatchCovered: false, completeBasisAndRequestedSources: sourceRecords,
  v33ExposesQuestion: false, v34ExposesQuestion: true, v34PendingQuestion: question,
  v34RequestSha256: hash(JSON.stringify(requests[34])), v34CitationRequirements: requirements,
  modelCalls: 0, productionWrites: 0, questionsResolved: 0, formalAcceptance: false,
  limitation: 'v34 eligibility demonstration only. Original responses were produced under v32. No old pass is retroactively interpreted as resolving this question, and the later revise remains intact. New reviewer instructions require explicit resolution and every required citation.' };
fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ actualV32ResponsesReplayed: replay.responsesReplayed, unchangedV32Inputs: unchangedInputs.length,
  hypotheticalV34QuestionExposed: true, completeRelevantSources: sourceRecords.length, questionsResolved: 0, modelCalls: 0 }));
