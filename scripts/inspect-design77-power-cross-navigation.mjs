// Read-only diagnosis of call 29's source-navigation classification. The
// original judgment stays unchanged; candidates are not quality acceptance.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const directory = 'data/audit-runtimes/design77-formal-continuation';
const read = p => JSON.parse(fs.readFileSync(p));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const requestPath = `${directory}/model-calls/00029.started.json`, responsePath = `${directory}/model-calls/00029.response.json`;
const request = read(requestPath), response = read(responsePath), sent = JSON.parse(request.request.user), answer = JSON.parse(response.response.text);
assert.equal(request.step.area, 'power'); assert.equal(request.step.stageId, 'cross-1-2');
assert.equal(sent.requestId, answer.requestId);
const checkpoint = read(`${directory}/segment-2.json`), run = checkpoint.runs.find(r => r.id === request.step.runId);
assert.ok(run);
const sourceMap = new Map(run.input.sources.map(s => [s.id, s]));
const coverage = sent.stage.coverage;
const fragments = new Map(sent.sources.flatMap(source => source.fragments.map(fragment => [fragment.id, source.origin.sourceId])));
const originalSourceIds = [...new Set(sent.stage.sourceMap.map(unit => unit.sourceId))];
const ranges = { tiers: [[73, 87]], costs: [[51, 100]], counters: [[61, 66], [88, 100]] };
const sourceEnvelopeCharacters = ids => JSON.stringify(run.units.filter(unit => ids.has(unit.sourceId)).map(unit => ({
  id: unit.id, text: sourceMap.get(unit.sourceId).text.slice(unit.start, unit.end),
}))).length;
const rows = Object.entries(ranges).map(([criterion, chapterRanges]) => {
  const check = answer.checks.find(item => item.criterion === criterion);
  assert.equal(check?.verdict, 'insufficient'); assert.equal(check.insufficiencyReason, 'unlocatable_sources');
  assert.equal(check.awaitingSources, undefined);
  const candidates = coverage.planRanges.filter(item => item.sourceId.startsWith('plan/milestones/') && chapterRanges.some(([start, end]) => item.startChapter <= end && item.endChapter >= start));
  for (const [start, end] of chapterRanges) for (let n = start; n <= end; n++) assert.ok(candidates.some(item => item.startChapter <= n && item.endChapter >= n), `No macro candidate for chapter ${n}`);
  const candidateSources = candidates.map(item => {
    const source = sourceMap.get(item.sourceId); assert.ok(source);
    assert.equal(coverage.sourceLengths[item.sourceId], source.text.length);
    assert.ok(!originalSourceIds.includes(item.sourceId), 'Candidate was already supplied');
    const value = JSON.parse(source.text), quote = value.setup[0];
    assert.ok(typeof quote === 'string' && quote.length > 4 && source.text.includes(quote));
    return { ...item, characters: source.text.length, exactQuote: quote };
  });
  const citedSourceIds = [...new Set(check.evidence.map(e => { const id = fragments.get(e.fragmentId); assert.ok(id); return id; }))];
  const candidateIds = candidateSources.map(item => item.sourceId);
  return { criterion, originalCheck: check, requestedChapterRanges: chapterRanges, candidateSources, citedSourceIds,
    originalFullBatchPlusCandidateCharacters: sourceEnvelopeCharacters(new Set([...originalSourceIds, ...candidateIds])),
    citedFullSourcesPlusCandidateCharacters: sourceEnvelopeCharacters(new Set([...citedSourceIds, ...candidateIds])),
    capacityCaveat: 'Serialized raw-source envelope only; a formal recheck also needs its question and annotation context. These sizes do not authorize dropping other material.' };
});
const proof = { inspectedAt: new Date().toISOString(), requestPath, requestSha256: sha(requestPath), responsePath, responseSha256: sha(responsePath),
  runId: run.id, inputHash: run.input.inputHash, stageId: request.step.stageId, model: request.request.model,
  originalRequestContainedSourceLengthsAndPlanRanges: true, rows,
  finding: 'The specified chapter ranges have existing macro source IDs in the directory delivered to this call, but their text was not supplied. The unlocatable classification needs an evidenced navigation recheck.',
  limitation: 'This proves source location and preserves exact excerpts, not sufficiency, completeness of all dependencies, or narrative quality. It does not replace the original model judgment or resolve any check.',
  verdictChanges: 0, modelCalls: 0, productionWrites: 0, formalAcceptance: false };
const output = 'docs/audits/2026-10-20-design77-power-cross-source-navigation.json';
fs.writeFileSync(output, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx', flush: true });
console.log(JSON.stringify({ verifiedSourceLocation: true, rows: rows.map(row => ({ criterion: row.criterion,
  candidates: row.candidateSources.map(item => item.sourceId), originalFullBatchPlusCandidateCharacters: row.originalFullBatchPlusCandidateCharacters,
  citedFullSourcesPlusCandidateCharacters: row.citedFullSourcesPlusCandidateCharacters })), formalAcceptance: false }));
