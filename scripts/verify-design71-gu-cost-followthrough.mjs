// Trace a known explanation error through the completed, independently replayed
// power review. Exact text occurrences are navigation evidence, not a general
// semantic correctness test or a reason to overwrite an original model answer.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } }, strict: true });
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const fileHash = file => sha(fs.readFileSync(file));
const originalPath = 'docs/audits/2026-10-17-design71-gu-cost-reading.json';
const completionPath = 'docs/audits/2026-10-17-design71-power-complete.json';
const outputPath = 'docs/audits/2026-10-17-design71-gu-cost-followthrough.json';
const saved = values.check ? read(outputPath) : undefined;
if (!values.check) assert.ok(!fs.existsSync(outputPath), 'Preserve prior follow-through evidence; use --check to verify it');
assert.ok(fs.existsSync(completionPath), 'Wait for the completed power area integrity proof');
const original = read(originalPath), completion = read(completionPath);
assert.equal(fileHash(original.snapshotPath), original.snapshotSha256);
assert.equal(completion.replay.verification, 'verified');
assert.equal(completion.replay.responseReplay, 'verified');
assert.equal(completion.replay.reportVerification, 'verified');
assert.equal(completion.inputHash, original.inputHash);
assert.equal(fileHash(completion.snapshotPath), completion.snapshotSha256);
const checkpoint = read(completion.snapshotPath);
const run = checkpoint.runs.find(item => item.id === completion.runId);
assert.ok(run && run.status === 'completed');
assert.equal(run.id, original.runId);
assert.equal(hash(run), completion.replay.runSha256);
assert.equal(run.stages.filter(stage => stage.result).length, run.stages.length);
const report = checkpoint.reports.find(item => item.id === completion.reportId);
assert.ok(report);
assert.equal(hash(report), completion.replay.reportSha256);
assert.equal(hash(report), completion.report.reportSha256);
for (const prior of original.checks) {
  assert.equal(hash(run.stages.find(stage => stage.id === prior.stageId)), prior.stageSha256);
}
const chapter = run.input.sources.find(source => source.id === 'plan/chapters/25');
assert.ok(chapter);
assert.deepEqual(chapter, original.completeOriginalSources.find(source => source.id === chapter.id));
assert.ok(JSON.parse(chapter.text).cost.includes(original.sourceCostQuote));
assert.equal(original.derivedAccount.totalSpent, 7);
assert.equal(original.derivedAccount.remaining, 3);

const needle = original.incorrectQuote;
function occurrences(result) {
  const rows = [];
  if (result.summary?.includes(needle)) rows.push({ field: 'summary' });
  for (const check of result.checks) {
    for (const field of ['explanation', 'revisionAdvice']) {
      if (check[field]?.includes(needle)) rows.push({ criterion: check.criterion, field });
    }
    check.evidence.forEach((evidence, index) => {
      if (evidence.quote.includes(needle)) rows.push({ criterion: check.criterion,
        field: 'evidence', index, sourceId: evidence.sourceId, quoteSha256: hash(evidence.quote) });
    });
  }
  return rows;
}
const stageOccurrences = run.stages.flatMap(stage => occurrences(stage.result).map(row => ({
  stageId: stage.id, stageKind: stage.kind, stageSha256: hash(stage), ...row,
})));
const reportOccurrences = occurrences(report);
const synthesis = run.stages.filter(stage => stage.kind === 'synthesis');
const synthesisAssertions = stageOccurrences.filter(row => row.stageKind === 'synthesis' && row.field !== 'evidence');
const explicitCorrectStage = run.stages.find(stage => stage.id === 'synthesis-17');
const correctCheck = explicitCorrectStage?.result.checks.find(check => check.criterion === 'costs');
assert.ok(correctCheck?.explanation.includes('局部护罡二成、真光三成、贴身推劲二成'));
assert.ok(correctCheck.explanation.includes('本人0.25元载'));
const root = run.stages.at(-1);
assert.equal(root.kind, 'synthesis');
const proof = {
  observedAt: saved?.observedAt ?? new Date().toISOString(), kind: 'known_model_arithmetic_error_followthrough',
  inputHash: completion.inputHash, runId: run.id, reportId: report.id,
  originalProof: { path: originalPath, sha256: fileHash(originalPath) },
  completionProof: { path: completionPath, sha256: fileHash(completionPath) },
  snapshotPath: completion.snapshotPath, snapshotSha256: completion.snapshotSha256,
  runSha256: hash(run), reportSha256: hash(report),
  originalIncorrectQuote: needle, originalResponsesUnchanged: true,
  unchangedChapter25Sha256: hash(chapter), correctAccount: original.derivedAccount,
  synthesisCount: synthesis.length, stageOccurrences, reportOccurrences,
  synthesisAssertionOccurrenceCount: synthesisAssertions.length,
  explicitCorrectSynthesis: { stageId: explicitCorrectStage.id,
    stageSha256: hash(explicitCorrectStage), check: correctCheck },
  finalChecks: report.checks.map(({ criterion, verdict, explanation, revisionAdvice }) => ({
    criterion, verdict, explanation, revisionAdvice,
  })),
  rootStageId: root.id, rootStageSha256: hash(root),
  modelCalls: 0, productionWrites: 0, chapterEdits: 0, questionsResolved: 0, formalAcceptance: false,
  limitation: 'Exact phrase tracking identifies retained historical quotations and repeated assertions, not paraphrases or all semantic errors. The original chapter and separate arithmetic proof remain the basis for the correct account. A later correct statement does not erase the earlier model error or approve the power design.',
};
if (values.check) assert.deepEqual(proof, saved, 'Stored follow-through evidence differs from reconstructed evidence');
else fs.writeFileSync(outputPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ mode: values.check ? 'read_only_check' : 'write_once', outputPath, synthesisCount: synthesis.length,
  synthesisAssertionOccurrenceCount: synthesisAssertions.length, stageOccurrences,
  reportOccurrences, reportStatus: report.status, formalAcceptance: false }));
