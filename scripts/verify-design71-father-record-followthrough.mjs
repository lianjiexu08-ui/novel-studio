// Trace a known provenance overstatement after the character review completes.
// This preserves model answers and never changes a review or design decision.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } }, strict: true });
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const fileHash = file => sha(fs.readFileSync(file));
const originalPath = 'docs/audits/2026-10-17-design71-father-record-reading.json';
const completionPath = 'docs/audits/2026-10-17-design71-characters-complete.json';
const outputPath = 'docs/audits/2026-10-17-design71-father-record-followthrough.json';
const saved = values.check ? read(outputPath) : undefined;
if (!values.check) assert.ok(!fs.existsSync(outputPath), 'Preserve prior evidence; use --check to verify it');
assert.ok(fs.existsSync(completionPath), 'Wait for the completed character area integrity proof');
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
assert.equal(hash(run.stages.find(stage => stage.id === original.stageId)), original.stageSha256);
for (const source of original.completeOriginalSources) {
  assert.deepEqual(run.input.sources.find(item => item.id === source.id), source);
}

// The shorter phrase catches reuse in a different sentence. It still cannot
// detect paraphrases, nor distinguish an assertion from an explicit correction.
const needle = '三份原件';
function occurrences(result) {
  const rows = [];
  function add(text, position) {
    if (!text?.includes(needle)) return;
    const index = text.indexOf(needle);
    rows.push({ ...position, textSha256: hash(text),
      excerpt: text.slice(Math.max(0, index - 100), index + needle.length + 100) });
  }
  add(result.summary, { field: 'summary' });
  for (const check of result.checks) {
    for (const field of ['explanation', 'revisionAdvice']) add(check[field], { criterion: check.criterion, field });
    check.evidence.forEach((evidence, index) => add(evidence.quote, {
      criterion: check.criterion, field: 'evidence', index, sourceId: evidence.sourceId,
    }));
  }
  return rows;
}
const stageOccurrences = run.stages.flatMap(stage => occurrences(stage.result).map(row => ({
  stageId: stage.id, stageKind: stage.kind, stageSha256: hash(stage), ...row,
})));
const reportOccurrences = occurrences(report);
const synthesisOccurrences = stageOccurrences.filter(row => row.stageKind === 'synthesis' && row.field !== 'evidence');
const proof = {
  observedAt: saved?.observedAt ?? new Date().toISOString(), kind: 'known_model_document_provenance_error_followthrough',
  inputHash: completion.inputHash, runId: run.id, reportId: report.id,
  originalProof: { path: originalPath, sha256: fileHash(originalPath) },
  completionProof: { path: completionPath, sha256: fileHash(completionPath) },
  snapshotPath: completion.snapshotPath, snapshotSha256: completion.snapshotSha256,
  runSha256: hash(run), reportSha256: hash(report),
  originalIncorrectQuote: original.incorrectQuote, searchPhrase: needle,
  originalResponsesUnchanged: true, originalSourcesUnchanged: true,
  correction: original.correction,
  synthesisCount: run.stages.filter(stage => stage.kind === 'synthesis').length,
  stageOccurrences, reportOccurrences, synthesisNonEvidenceOccurrenceCount: synthesisOccurrences.length,
  finalChecks: report.checks.map(({ criterion, verdict, explanation, revisionAdvice }) => ({
    criterion, verdict, explanation, revisionAdvice,
  })),
  modelCalls: 0, productionWrites: 0, chapterEdits: 0, questionsResolved: 0, formalAcceptance: false,
  limitation: 'Phrase occurrences locate explanations and retained historical quotations for independent reading. They do not prove absence of paraphrased errors or general semantic correctness. Original sources remain authoritative; neither this trace nor a later correct statement changes the original answer or approves the design.',
};
if (values.check) assert.deepEqual(proof, saved, 'Stored follow-through evidence differs from reconstructed evidence');
else fs.writeFileSync(outputPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ mode: values.check ? 'read_only_check' : 'write_once', outputPath,
  synthesisCount: proof.synthesisCount, synthesisNonEvidenceOccurrenceCount: synthesisOccurrences.length,
  stageOccurrences, reportOccurrences, reportStatus: report.status, formalAcceptance: false }));
