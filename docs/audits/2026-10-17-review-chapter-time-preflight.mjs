// Construct requests from real frozen inputs, without model calls, verdicts,
// saved new runs, or changes to the live schedule-31 worker.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDesignReviewRun, designReviewStageInput } from '../../novel-service-core/src/design-review-run.ts';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file));
const control = 'data/audit-runtimes/design70-review';
const baseline = read(`${control}/baseline.json`), bindingPath = 'data/audit-runtimes/design70-runtime-bound.json';
assert.equal(sha(fs.readFileSync(bindingPath)), baseline.runtimeBindingSha256);
const binding = read(bindingPath);
for (const [file, expected] of Object.entries(binding.sourceHashes)) assert.equal(sha(fs.readFileSync(`${binding.runtimePath}/${file}`)), expected);
const inputBytes = fs.readFileSync(`${control}/inputs.json`);
assert.equal(sha(inputBytes), baseline.inputsSha256);
assert.equal(sha(fs.readFileSync('scripts/run-design70-review.mjs')), baseline.runnerSha256);
const inputs = JSON.parse(inputBytes);
const frozen = await import(`${binding.runtimePath}/novel-service-core/src/design-review-run.ts`);
const rows = [], references = [];
for (const [area, input] of Object.entries(inputs)) {
  const previous = frozen.createDesignReviewRun(input, '2026-10-17T00:00:00.000Z', 31);
  const next = createDesignReviewRun(input, previous.createdAt);
  assert.equal(next.scheduleVersion, 32);
  assert.deepEqual(next.units, previous.units);
  assert.deepEqual(next.stages, previous.stages);
  for (const stage of next.stages.filter(stage => stage.kind !== 'synthesis')) {
    const request = designReviewStageInput(next, stage);
    const oldRequest = frozen.designReviewStageInput(previous, previous.stages.find(item => item.id === stage.id));
    assert.deepEqual(request.sources, oldRequest.sources);
    const sourceCharacters = JSON.stringify(request.sources).length;
    const metadataCharacters = JSON.stringify(request.stage.coverage).length;
    assert.ok(sourceCharacters <= 240000 && metadataCharacters <= 40000);
    rows.push({ area, stageId: stage.id, sourceCharacters, metadataCharacters,
      timeEntries: request.stage.coverage.chapterTimes?.length ?? 0,
      timesOmitted: request.stage.coverage.chapterTimesOmitted ?? null,
      requestSha256: sha(JSON.stringify(request)) });
    if (area === 'story' && stage.id === 'batch-5') {
      const times = request.stage.coverage.chapterTimes;
      assert.ok(times);
      for (const chapterNumber of [39, 42, 44]) {
        const row = times.find(item => item.sourceId === `plan/chapters/${chapterNumber}`);
        assert.ok(row);
        assert.equal(row.storyTime, JSON.parse(input.sources.find(source => source.id === row.sourceId).text).storyTime);
        references.push(row);
      }
      assert.equal(references[0].storyTime, '第229日至第230日');
      assert.equal(references[1].storyTime, '第239日至第243日');
      assert.ok(!request.stage.sourceMap.some(unit => unit.sourceId === 'plan/chapters/42'), 'Navigation must not pretend the missing chapter was read');
    }
  }
  assert.ok(next.stages.every(stage => !stage.result), 'No fabricated verdicts in this preflight');
}
// Compare selected real saved v31 requests through the new code and the
// immutable old runtime, including actual followup and synthesis metadata.
const checkpoint = read(`${control}/result.json`), legacy = [];
for (const run of checkpoint.runs) {
  const ready = run.stages.filter(stage => stage.kind !== 'synthesis' || stage.children.every(id => run.stages.find(child => child.id === id)?.result));
  const selected = [...new Set([
    ready.find(stage => stage.kind === 'batch'), ready.find(stage => stage.id === 'batch-5'),
    ready.find(stage => stage.kind === 'cross' && !stage.followupFor), ready.find(stage => stage.followupFor),
    ready.findLast(stage => stage.kind === 'synthesis'),
  ].filter(Boolean))];
  for (const stage of selected) {
    const actual = designReviewStageInput(run, stage);
    assert.deepEqual(actual, frozen.designReviewStageInput(run, stage));
    legacy.push({ area: run.input.area, stageId: stage.id, requestSha256: sha(JSON.stringify(actual)) });
  }
}
const sourceFiles = ['novel-service-core/src/design-review.ts', 'novel-service-core/src/design-review-run.ts',
  'novel-service-core/src/design-review-scope.ts', 'packages/planner/src/index.ts'];
const proof = { kind: 'chapter_time_navigation_real_input_preflight', observedAt: new Date().toISOString(),
  inputsSha256: baseline.inputsSha256, frozenSourceFilesVerified: Object.keys(binding.sourceHashes).length,
  currentSourceHashes: Object.fromEntries(sourceFiles.map(file => [file, sha(fs.readFileSync(file))])),
  requests: rows, chapterReferenceWitness: references, existingV31RequestsUnchanged: legacy,
  maxSourceCharacters: Math.max(...rows.map(row => row.sourceCharacters)),
  maxMetadataCharacters: Math.max(...rows.map(row => row.metadataCharacters)),
  modelCalls: 0, productionWrites: 0, fabricatedResults: 0, formalAcceptance: false,
  limitation: 'Request construction and old-version compatibility only. No model behavior claim. Dynamic v32 followups and synthesis require their actual future reports; the live review remains v31.' };
fs.writeFileSync('docs/audits/2026-10-17-review-chapter-time-preflight.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ requests: rows.length, legacyRequests: legacy.length,
  maxSourceCharacters: proof.maxSourceCharacters, maxMetadataCharacters: proof.maxMetadataCharacters,
  referenceWitness: references, formalAcceptance: false }));
