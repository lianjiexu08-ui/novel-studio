// No model calls: compare saved request semantics and verify exact identity navigation.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDesignReviewRun, designReviewStageInput } from '../../novel-service-core/src/design-review-run.ts';
import { JsonDesignPlanner } from '../../packages/planner/src/index.ts';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(value));
const fileHash = file => sha(fs.readFileSync(file));
async function capture(Planner, input) {
  let captured;
  const sentinel = new Error('Capture request only; no model call');
  const planner = new Planner({ complete: async request => { captured = request; throw sentinel; } });
  await assert.rejects(() => planner.reviewDesignContent(input), error => error === sentinel);
  assert.ok(captured);
  return captured;
}
const comparisons = [];
for (const [label, bindingPath, checkpointPath] of [
  ['proposal68-schedule26', 'data/audit-runtimes/design68-runtime-bound.json', 'data/audit-runtimes/design68-review/result.json'],
  ['proposal69-schedule29', 'data/audit-runtimes/design69-runtime-bound.json', 'data/audit-runtimes/design69-review/result.json'],
  ['proposal69-schedule30', 'data/audit-runtimes/design69-review30-runtime-bound.json', 'data/audit-runtimes/design69-review30/result.json'],
]) {
  const binding = read(bindingPath), checkpoint = fs.readFileSync(checkpointPath), state = JSON.parse(checkpoint);
  for (const [name, expected] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(`${binding.runtimePath}/${name}`), expected);
  const frozen = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
  const { JsonDesignPlanner: FrozenPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
  for (const run of state.runs) {
    const rows = [];
    for (const stage of run.stages.filter(stage => stage.result)) {
      const previous = frozen.designReviewStageInput(run, stage), current = designReviewStageInput(run, stage);
      assert.deepEqual(current, previous);
      const before = await capture(FrozenPlanner, previous), after = await capture(JsonDesignPlanner, current);
      assert.deepEqual(after, before);
      rows.push({ stageId: stage.id, inputSha256: hash(current), modelRequestSha256: hash(after) });
    }
    comparisons.push({ label, area: run.input.area, requests: rows.length, requestHashesSha256: hash(rows), checkpointSha256: sha(checkpoint) });
  }
}
const inputs = read('data/audit-runtimes/design69-preparation/inputs.json'), areas = [];
for (const area of ['world', 'power', 'characters', 'story']) {
  const input = inputs[area], old = createDesignReviewRun(input, undefined, 30), run = createDesignReviewRun(input, old.createdAt);
  assert.equal(run.scheduleVersion, 31);
  assert.deepEqual(run.units, old.units); assert.deepEqual(run.stages, old.stages);
  const requests = run.stages.filter(stage => stage.kind !== 'synthesis').map(stage => {
    const request = designReviewStageInput(run, stage), oldRequest = designReviewStageInput(old, old.stages.find(item => item.id === stage.id));
    assert.deepEqual(request.sources, oldRequest.sources);
    assert.deepEqual(request.stage.sourceMap, oldRequest.stage.sourceMap);
    const sourceCharacters = JSON.stringify(request.sources).length, coverageCharacters = JSON.stringify(request.stage.coverage).length;
    assert.ok(sourceCharacters <= 240000); assert.ok(coverageCharacters <= 40000);
    assert.deepEqual(designReviewStageInput(JSON.parse(JSON.stringify(run)), stage), request);
    const cast = request.stage.coverage.chapterCast;
    if (area === 'characters' || area === 'story') {
      assert.ok(cast);
      for (const chapter of cast.chapters) {
        const raw = JSON.parse(input.sources.find(source => source.id === chapter.sourceId).text);
        assert.equal(chapter.chapterNumber, raw.chapterNumber); assert.deepEqual(chapter.characterIds, raw.characterIds);
      }
      for (const [id, profile] of Object.entries(cast.characters)) {
        const raw = JSON.parse(input.sources.find(source => source.id === profile.sourceId).text);
        assert.equal(raw.id, id); assert.equal(raw.name, profile.name);
      }
      const chapter37 = cast.chapters.find(chapter => chapter.sourceId === 'plan/chapters/37');
      const chapter44 = cast.chapters.find(chapter => chapter.sourceId === 'plan/chapters/44');
      assert.ok(chapter37.characterIds.includes('char_21')); assert.ok(!chapter37.characterIds.includes('char_16'));
      assert.ok(chapter44.characterIds.includes('char_16')); assert.ok(!chapter44.characterIds.includes('char_21'));
      assert.equal(cast.characters.char_16.name, '陆沉舟'); assert.equal(cast.characters.char_21.name, '陆沉川');
    } else assert.deepEqual(request, oldRequest, 'World and power requests are unchanged');
    return { stageId: stage.id, sourceCharacters, coverageCharacters, castChapters: cast?.chapters.length ?? 0 };
  });
  areas.push({ area, requests });
}
const proof = { observedAt: new Date().toISOString(), comparisons,
  oldRequestsAndPromptsCompared: comparisons.reduce((sum, row) => sum + row.requests, 0), areas,
  currentInputHash: inputs.story.inputHash, modelCalls: 0, productionWrites: 0, formalAcceptance: false,
  limitation: 'Navigation copies declarations, not action semantics. No real model behavior or future synthesis quality is validated. Running schedule30 stays on its frozen runtime; schedule31 is not deployed.' };
fs.writeFileSync('docs/audits/2026-10-17-review-chapter-cast-preflight.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ oldRequestsAndPromptsCompared: proof.oldRequestsAndPromptsCompared,
  maxCoverageCharacters: Math.max(...areas.flatMap(area => area.requests.map(request => request.coverageCharacters))),
  newRequests: areas.reduce((sum, area) => sum + area.requests.length, 0), modelCalls: 0, productionWrites: 0 }));
