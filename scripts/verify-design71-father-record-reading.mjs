// Preserve a review explanation that upgrades an explicit copy to an original.
// This does not change the model answer, the plan, or the question disposition.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { replayDesignReviewRecord } from './audit-design-reviews.mjs';

parseArgs({ options: {}, strict: true });
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const fileHash = file => sha(fs.readFileSync(file));
const control = 'data/audit-runtimes/design71-review';
const snapshotPath = `${control}/father-record-reading-prefix.json`;
const outputPath = 'docs/audits/2026-10-17-design71-father-record-reading.json';
for (const file of [snapshotPath, outputPath]) assert.ok(!fs.existsSync(file), `Preserve prior evidence: ${file}`);
const baseline = read(`${control}/baseline.json`);
const inputPath = `${control}/inputs.json`;
assert.equal(fileHash(inputPath), baseline.inputsSha256);
const inputs = read(inputPath);
const bytes = fs.readFileSync(`${control}/result.json`);
const checkpoint = JSON.parse(bytes);
assert.equal(checkpoint.inputHash, baseline.inputHash);
assert.equal(fileHash('scripts/run-design71-review.mjs'), baseline.runnerSha256);
const run = checkpoint.runs.find(item => item.input.area === 'characters');
assert.ok(run);
assert.deepEqual(run.input, inputs.characters);
const bindingPath = 'data/audit-runtimes/design71-runtime-bound.json';
assert.equal(fileHash(bindingPath), baseline.runtimeBindingSha256);
const binding = read(bindingPath);
for (const [file, expected] of Object.entries(binding.sourceHashes)) {
  assert.equal(fileHash(`${binding.runtimePath}/${file}`), expected, file);
}
const runtime = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const replay = await replayDesignReviewRecord(run, inputs.characters,
  checkpoint.reports.find(report => report.id === run.reportId), { ...runtime, JsonDesignPlanner });
const stage = run.stages.find(item => item.id === 'followup-batch-5/knowledge');
assert.ok(stage?.result && stage.modelResponses?.length);
const check = stage.result.checks.find(item => item.criterion === 'knowledge');
const incorrectQuote = '第85章三份原件仅确认守门参与与外山掩案';
assert.ok(check?.explanation.includes(incorrectQuote));
assert.ok(stage.modelResponses.some(response => response.includes(incorrectQuote)));
const request = runtime.designReviewStageInput(run, stage);
const sourceIds = ['story/secrets/sec_01', 'plan/milestones/ms_v3_advancement'];
const sources = sourceIds.map(id => {
  const source = inputs.characters.sources.find(item => item.id === id);
  assert.ok(source, id);
  const units = request.stage.sourceMap.filter(unit => unit.sourceId === id).sort((a, b) => a.start - b.start);
  assert.equal(units.map(unit => request.sources.find(item => item.id === unit.id).text).join(''), source.text, id);
  return source;
});
const secret = JSON.parse(sources[0].text), milestone = JSON.parse(sources[1].text);
const lin66 = secret.knowledgeStages.find(item => item.characterId === 'char_01' && item.sinceChapter === 66);
const lin85 = secret.knowledgeStages.find(item => item.characterId === 'char_01' && item.sinceChapter === 85);
const su85 = secret.knowledgeStages.find(item => item.characterId === 'char_02' && item.sinceChapter === 85);
assert.ok(lin66.belief.includes('巡查副本，与已有旧图相符'));
assert.ok(lin85.belief.includes('三份原始记录'));
assert.ok(lin85.trigger.includes('与第18章旧图及北境副本对照'));
// Preserve this wording too: examining an original in the scene does not mean
// that all three compared records are originals.
assert.ok(su85.trigger.includes('在场核对原件'));
const sourceQuote = milestone.setup.find(text => text.includes('与林第18章旧图和夜带来的副本逐项对照'));
assert.ok(sourceQuote?.includes('移交存根'));
const proof = {
  observedAt: new Date().toISOString(), kind: 'model_explanation_document_provenance_mismatch',
  inputHash: baseline.inputHash, inputPath, inputsSha256: baseline.inputsSha256,
  runId: run.id, snapshotPath, snapshotSha256: sha(bytes), runtimeBindingSha256: fileHash(bindingPath),
  prefixReplay: replay, stageId: stage.id, stageSha256: hash(stage),
  requestSha256: hash(request), completeRequiredSourcesWereProvided: true,
  check, modelResponses: stage.modelResponses, incorrectQuote,
  completeOriginalSources: sources, sourceQuote,
  relevantKnowledgeStages: { lin66, lin85, su85 },
  correction: '第85章对照移交存根、第18章旧图和夜带来的巡档副本；至少巡档材料明确为副本，不能将三份材料一概称为原件。苏在场核对原件的表述并不将北境副本转换为原件。',
  scope: 'This identifies an overstatement of document provenance in a model explanation. It does not establish a conflict in the supplied plan, invalidate all other knowledge findings, or prove the eventual prose.',
  requiredFollowup: 'Inspect later syntheses and the final report for this provenance overstatement. Keep the original pass, resolution record and model response intact; use the actual source descriptions when adjudicating the design and later chapter evidence.',
  modelCalls: 0, productionWrites: 0, chapterEdits: 0, questionsResolved: 0, formalAcceptance: false,
};
fs.writeFileSync(snapshotPath, bytes, { flag: 'wx' });
fs.writeFileSync(outputPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ outputPath, completedStages: replay.completedStages,
  responsesReplayed: replay.responsesReplayed, completeRequiredSourcesWereProvided: true,
  modelCalls: 0, productionWrites: 0, formalAcceptance: false }));
