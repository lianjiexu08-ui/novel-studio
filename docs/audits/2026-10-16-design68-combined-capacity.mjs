// Offline source-envelope capacity probe; not a formal review or input binding.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
const read = path => JSON.parse(fs.readFileSync(path));
const basePath = 'data/design-candidates/design64-motivation-wording-draft-v11.json';
const candidatePath = 'data/design-candidates/design68-combined-draft-v16.json';
assert.equal(sha(fs.readFileSync(basePath)), 'ec7d90cb870f6d35f9cfc9d1c95cc21169f97bf856940f8ef8bf2a70273c19be');
const candidateBytes = fs.readFileSync(candidatePath);
assert.equal(sha(candidateBytes), '0a8d5884ae8def3e6fedf69d276b047b9ca6499f2e7d3f63841d0e52c941a51c');
const base = read(basePath), candidate = JSON.parse(candidateBytes);
const bindings = [
  ['world/artifacts/art_03', 'worldPack', 'artifacts', 'art_03'],
  ['story/characters/char_04', 'storyBible', 'characters', 'char_04'],
  ['story/chapterPlans/chapter-plan-23', 'storyBible', 'chapterPlans', 'chapter-plan-23'],
  ['plan/chapters/23', 'plan', 'chapters', 'chapter-23'],
  ['plan/milestones/ms_v2_boundary', 'plan', 'milestones', 'ms_v2_boundary'],
];
const restored = structuredClone(candidate), replacements = new Map();
for (const [sourceId, document, group, id] of bindings) {
  const original = base[document][group].find(item => item.id === id);
  const proposed = candidate[document][group].find(item => item.id === id);
  assert.ok(original && proposed);
  assert.notDeepEqual(proposed, original);
  const index = restored[document][group].findIndex(item => item.id === id);
  restored[document][group][index] = original;
  replacements.set(sourceId, { before: JSON.stringify(original, null, 2), after: JSON.stringify(proposed, null, 2) });
}
assert.deepEqual(restored, base, 'All candidate edits must be represented by the five replacement source records');
const binding = read('data/audit-runtimes/design68-runtime-bound.json');
const baseline = read('data/audit-runtimes/design68-review/baseline.json');
const inputBytes = fs.readFileSync('data/audit-runtimes/design68-review/inputs.json');
assert.equal(sha(inputBytes), baseline.inputsSha256);
for (const [path, expected] of Object.entries(binding.sourceHashes)) assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${path}`)), expected, path);
const { createDesignReviewRun, designReviewStageInput, designReviewCapacity } = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const areas = [];
for (const [area, input] of Object.entries(JSON.parse(inputBytes))) {
  const probe = structuredClone(input), changedSources = [];
  for (const source of probe.sources) {
    const replacement = replacements.get(source.id);
    if (!replacement) continue;
    assert.equal(source.text, replacement.before, source.id);
    source.text = replacement.after;
    changedSources.push(source.id);
  }
  assert.equal(changedSources.length, area === 'characters' ? 4 : 5);
  // Deliberately use a synthetic hash: the frozen production hash must not
  // appear to bind changed source text. This is not designReviewHash(work).
  probe.inputHash = sha(JSON.stringify({ purpose: 'capacity-probe-only-v16', area, sources: probe.sources }));
  const run = createDesignReviewRun(probe);
  for (const source of probe.sources) {
    const units = run.units.filter(u => u.sourceId === source.id).sort((a, b) => a.start - b.start);
    assert.equal(units[0].start, 0);
    assert.equal(units.at(-1).end, source.text.length);
    units.slice(1).forEach((unit, i) => assert.equal(unit.start, units[i].end));
    assert.ok(units.every(unit => run.stages.some(stage => stage.kind === 'batch' && stage.unitIds.includes(unit.id))));
  }
  const requests = run.stages.filter(s => s.kind !== 'synthesis').map(stage => {
    const request = designReviewStageInput(run, stage);
    for (const unit of request.stage.sourceMap) {
      const original = probe.sources.find(source => source.id === unit.sourceId);
      assert.ok(original, unit.sourceId);
      assert.equal(request.sources.find(source => source.id === unit.id)?.text, original.text.slice(unit.start, unit.end));
    }
    const sourceCharacters = JSON.stringify(request.sources).length;
    const metadataCharacters = JSON.stringify(request.stage.coverage).length;
    assert.ok(sourceCharacters <= designReviewCapacity);
    assert.ok(metadataCharacters <= 40000);
    return { stageId: stage.id, sourceCharacters, metadataCharacters, sha256: sha(JSON.stringify(request)) };
  });
  areas.push({ area, changedSources, requests, completeOriginalSourceCoverage: true });
}
const proof = {
  kind: 'unapplied_v16_complete_source_replacement_and_initial_capacity_probe',
  candidatePath, candidateSha256: sha(candidateBytes), basePath,
  allEditsCoveredByReplacementSources: true, areas,
  modelCalls: 0, productionWrites: 0, formalAcceptance: false,
  limitation: 'Complete replacement-source accounting and initial request capacity only. Synthetic hashes are not formal design bindings. Settings and author context are frozen; future save/rebinding, dynamic followups, semantic review and actual chapter execution remain unverified.',
};
fs.writeFileSync('docs/audits/2026-10-16-design68-combined-capacity.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ requests: areas.flatMap(a => a.requests).length,
  maxSourceCharacters: Math.max(...areas.flatMap(a => a.requests.map(r => r.sourceCharacters))),
  maxMetadataCharacters: Math.max(...areas.flatMap(a => a.requests.map(r => r.metadataCharacters))),
  formalAcceptance: false, productionWrites: 0 }));
