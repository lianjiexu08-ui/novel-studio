import test from 'node:test';
import assert from 'node:assert/strict';
import type { DesignReviewInput } from '../../../novel-service-core/src/design-review.ts';
import { designReviewHorizon } from '../src/design-review-horizon.ts';

function request(numbers = Array.from({ length: 50 }, (_, i) => i + 1), target = 100, through = 50): DesignReviewInput {
  return { area: 'world', scope: { worldPackRevision: 1, storyBibleRevision: 1, planRevisionId: 'p', planRevision: 1 }, inputHash: 'a'.repeat(64), rubric: { geography: '核通行' },
    sources: [{ id: 'plan/overview', text: JSON.stringify({ targetChapterCount: target, detailedThroughChapter: through, outlinedChapterNumbers: numbers }) }] };
}

test('horizon separates the actual fifty-chapter outline from the hundred-chapter target without filling gaps', () => {
  assert.deepEqual(designReviewHorizon(request()), { sourceId: 'plan/overview', targetChapterCount: 100, detailedThroughChapter: 50,
    detailedChapterRanges: [{ startChapter: 1, endChapter: 50 }], undetailedChapterRanges: [{ startChapter: 51, endChapter: 100 }] });
  assert.deepEqual(designReviewHorizon(request([1, 3, 4, 8], 10, 1)), { sourceId: 'plan/overview', targetChapterCount: 10, detailedThroughChapter: 1,
    detailedChapterRanges: [{ startChapter: 1, endChapter: 1 }, { startChapter: 3, endChapter: 4 }, { startChapter: 8, endChapter: 8 }],
    undetailedChapterRanges: [{ startChapter: 2, endChapter: 2 }, { startChapter: 5, endChapter: 7 }, { startChapter: 9, endChapter: 10 }] });
});

test('only complete contiguous overview slices establish a horizon', () => {
  const input = request(), expected = designReviewHorizon(input), text = input.sources[0].text;
  input.sources = [{ id: 'unit/second', text: text.slice(80) }, { id: 'unit/first', text: text.slice(0, 80) }];
  input.stage = { kind: 'batch', label: '切片', totalBatches: 2, sourceMap: [
    { id: 'unit/second', sourceId: 'plan/overview', start: 80, end: text.length }, { id: 'unit/first', sourceId: 'plan/overview', start: 0, end: 80 },
  ], coverage: { mode: 'local_sources', sourceLengths: { 'plan/overview': text.length } } };
  const before = structuredClone(input);
  assert.deepEqual(designReviewHorizon(input), expected);
  assert.deepEqual(input, before);
  const missing = structuredClone(input); missing.sources.pop();
  assert.equal(designReviewHorizon(missing), undefined);
  const overlap = structuredClone(input); overlap.stage!.sourceMap[0].start--;
  assert.equal(designReviewHorizon(overlap), undefined);
  const truncated = request(); truncated.stage = { ...input.stage, sourceMap: [], coverage: { mode: 'local_sources', sourceLengths: { 'plan/overview': text.length + 10 } } };
  assert.equal(designReviewHorizon(truncated), undefined);
});

test('legacy, inconsistent or absent overview data never invents a planning horizon', () => {
  for (const value of [{ targetChapterCount: 100 }, { targetChapterCount: 5, detailedThroughChapter: 3, outlinedChapterNumbers: [1, 3] },
    { targetChapterCount: 5, detailedThroughChapter: 1, outlinedChapterNumbers: [1, 1] }, { targetChapterCount: 5, detailedThroughChapter: 1, outlinedChapterNumbers: [1, 8] }]) {
    const input = request(); input.sources[0].text = JSON.stringify(value);
    assert.equal(designReviewHorizon(input), undefined);
  }
  const input = request(); input.sources[0].id = 'review-result/summary';
  assert.equal(designReviewHorizon(input), undefined);
});
