// Prepare independently checked observations; this script cannot write to a work.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { annotationSources, designReviewCheckHash } from '../novel-service-core/src/design-review-annotations.ts';
import { addDesignReviewAnnotationSchema } from '../packages/contracts/src/design-review.ts';

const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } }, strict: true });
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const control = 'data/audit-runtimes/design71-review';
const outputPath = `${control}/review-annotation-inputs.json`;
const proofPath = 'docs/audits/2026-10-17-design71-review-annotation-inputs.json';
const baseline = read(`${control}/baseline.json`);
const inputBytes = fs.readFileSync(`${control}/inputs.json`);
assert.equal(sha(inputBytes), baseline.inputsSha256);
const inputs = JSON.parse(inputBytes);
const checkpoint = read(`${control}/result.json`);
assert.equal(checkpoint.inputHash, baseline.inputHash);
const evidenceFiles = ['gu-cost-reading', 'father-record-reading', 'barge-balance-reading'].map(name => `docs/audits/2026-10-17-design71-${name}.json`);
const records = evidenceFiles.map(file => {
  const proof = read(file);
  assert.equal(proof.inputHash, baseline.inputHash);
  assert.equal(proof.inputsSha256, baseline.inputsSha256);
  assert.equal(sha(fs.readFileSync(proof.snapshotPath)), proof.snapshotSha256);
  const run = checkpoint.runs.find(run => run.id === proof.runId);
  assert.ok(run);
  assert.deepEqual(run.input, inputs[run.input.area]);
  for (const source of proof.completeOriginalSources) assert.deepEqual(run.input.sources.find(s => s.id === source.id), source);
  return { proof, run };
});
const [gu, father, barge] = records;
function note(record, stageId, criterion, requestKey, claimQuote, explanation, evidence) {
  const stage = record.run.stages.find(stage => stage.id === stageId);
  const expectedStageHash = record.proof.stageSha256 ?? record.proof.checks.find(check => check.stageId === stageId).stageSha256;
  assert.equal(hash(stage), expectedStageHash);
  const check = stage.result.checks.find(check => check.criterion === criterion);
  const input = addDesignReviewAnnotationSchema.parse({ requestKey, runId: record.run.id, stageId, criterion,
    expectedInputHash: record.run.input.inputHash, expectedCheckHash: designReviewCheckHash(check),
    claimQuote, explanation, evidence });
  annotationSources({ designReviewRuns: new Map([[record.run.id, record.run]]) }, input);
  return input;
}
const guNote = note(gu, 'followup-batch-3/counters', 'counters', 'design71-gu-cost-reading', gu.proof.incorrectQuote,
  '第25章顾峤的局部护罡两成、真光三成、贴身推劲两成共支出七成元罡，十成起点后余三成；另付0.25元载，不能把元罡和寿储混账。受伤后可用上限下修至六成，不会把实际三成补满。此处是评语合计误读，不修改正确章纲，也不解除本轮其他力量返修。',
  [{ sourceId: 'plan/chapters/25', quote: gu.proof.sourceCostQuote },
    { sourceId: 'plan/chapters/25', quote: '随后可用上限下修至六成，实际仍只有三成' }]);
const fatherNote = note(father, father.proof.stageId, father.proof.check.criterion, 'design71-father-record-reading', father.proof.incorrectQuote,
  `${father.proof.correction} 本记录只纠正材料性质的转述，不改变原人物评审通过及补读处置。最终人物报告的部分历史引文仍引用了该错误说法，不能把历史报告转述当作故事原文。`,
  [{ sourceId: 'plan/milestones/ms_v3_advancement', quote: father.proof.sourceQuote },
    { sourceId: 'story/secrets/sec_01', quote: '与第18章旧图及北境副本对照' }]);
const bargeNotes = read(barge.proof.annotationPath);
assert.equal(hash(bargeNotes), barge.proof.annotationInputsSha256);
for (const input of bargeNotes) {
  addDesignReviewAnnotationSchema.parse(input);
  assert.equal(input.runId, barge.run.id);
  annotationSources({ designReviewRuns: new Map([[barge.run.id, barge.run]]) }, input);
  assert.equal(hash(barge.run.stages.find(stage => stage.id === input.stageId)), barge.proof.stageSha256);
}
const annotations = [guNote, fatherNote, ...bargeNotes];
const output = { workId: baseline.workId, annotations };
const proof = { kind: 'prepared_independent_review_annotations', inputHash: baseline.inputHash,
  inputsSha256: baseline.inputsSha256, outputPath, outputSha256: hash(output),
  sourceProofs: evidenceFiles.map(file => ({ path: file, sha256: sha(fs.readFileSync(file)) })),
  count: annotations.length, checks: annotations.map(note => ({ runId: note.runId, stageId: note.stageId,
    criterion: note.criterion, expectedCheckHash: note.expectedCheckHash, sourceIds: [...new Set(note.evidence.map(e => e.sourceId))] })),
  productionWrites: 0, modelCalls: 0, verdictChanges: 0, questionsResolved: 0, formalAcceptance: false,
  deploymentGate: 'Finish and terminal-verify the original worker, migrate the annotation field and deploy matching API/UI before production import. Revalidate every bound original check and quote at import. Retain original verdicts and pending questions.' };
if (values.check) {
  assert.deepEqual(read(outputPath), output);
  assert.deepEqual(read(proofPath), proof);
} else {
  for (const file of [outputPath, proofPath]) assert.ok(!fs.existsSync(file), `Preserve prior preparation: ${file}`);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ verified: true, preparedAnnotations: annotations.length, outputPath, productionWrites: 0, modelCalls: 0 }));
