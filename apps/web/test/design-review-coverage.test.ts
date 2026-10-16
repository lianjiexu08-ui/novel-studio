import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewSourceCoverage, type ReviewSourceInput } from '../src/design-review-coverage.ts';

test('report mentions never imply direct original-source coverage, even for complete synthesis', () => {
  const input: ReviewSourceInput = { sources: [{ id: 'review-result/child', text: 'plan/milestones/voyage: 航程已核验' }], stage: {
    sourceMap: [], coverage: { mode: 'reports_with_context', sourceLengths: { 'plan/milestones/voyage': 40 },
      synthesis: { scope: 'complete_reports', coveredStageIds: ['batch-1'], totalStages: 1 } },
  } };
  const before = structuredClone(input);
  assert.equal(reviewSourceCoverage(input)![0].status, 'absent');
  assert.deepEqual(input, before);
  assert.equal(reviewSourceCoverage({ sources: [] }), undefined, 'legacy missing metadata is not verified empty coverage');
});

test('source completeness requires all actual fragments with no missing interval or invalid envelope', () => {
  const input: ReviewSourceInput = { sources: [{ id: 'b', text: '乙😀' }, { id: 'a', text: '甲' }], stage: {
    sourceMap: [{ id: 'b', sourceId: 'original', start: 1, end: 4 }, { id: 'a', sourceId: 'original', start: 0, end: 1 }],
    coverage: { mode: 'local_sources', sourceLengths: { original: 4 }, sourceNames: { original: '旅程' } },
  } };
  const row = reviewSourceCoverage(input)![0];
  assert.equal(row.status, 'complete'); assert.equal(row.name, '旅程');
  assert.deepEqual(row.fragments.map(f => f.text), ['甲', '乙😀']);
  const partial = structuredClone(input); partial.stage!.sourceMap.shift();
  assert.equal(reviewSourceCoverage(partial)![0].status, 'partial');
  const gap = structuredClone(input); gap.stage!.sourceMap.pop();
  assert.equal(reviewSourceCoverage(gap)![0].status, 'partial');
  for (const defect of ['missing', 'truncated', 'duplicate', 'overlap'] as const) {
    const damaged = structuredClone(input);
    if (defect === 'missing') damaged.sources.pop();
    if (defect === 'truncated') damaged.sources[0].text = '乙';
    if (defect === 'duplicate') damaged.sources.push(damaged.sources[0]);
    if (defect === 'overlap') damaged.stage!.sourceMap.push(damaged.stage!.sourceMap[0]);
    assert.equal(reviewSourceCoverage(damaged)![0].status, 'unknown', defect);
  }
});

test('direct unsplit sources require an exact declared length, including an empty original', () => {
  const input: ReviewSourceInput = { sources: [{ id: 'original', text: '' }], stage: { sourceMap: [], coverage: { mode: 'whole_input', sourceLengths: { original: 0 } } } };
  assert.equal(reviewSourceCoverage(input)![0].status, 'complete');
  input.stage!.coverage!.sourceLengths.original = 20;
  assert.equal(reviewSourceCoverage(input)![0].status, 'unknown');
});

test('navigation labels use saved range titles and chapter numbers without implying source contents', () => {
  const input: ReviewSourceInput = { sources: [], stage: { sourceMap: [], coverage: { mode: 'local_sources',
    sourceLengths: { 'plan/chapters/18': 25, 'plan/milestones/voyage': 50 },
    planRanges: [{ sourceId: 'plan/milestones/voyage', title: '付费北航', startChapter: 54, endChapter: 60 }],
  } } };
  const rows = reviewSourceCoverage(input)!;
  assert.deepEqual(rows.map(row => row.name), ['第18章章纲', '付费北航']);
  assert.ok(rows.every(row => row.status === 'absent'));
});

test('relationship labels retain direction and distinct IDs without implying that unread material was supplied', () => {
  const input: ReviewSourceInput = { sources: [], stage: { sourceMap: [], coverage: { mode: 'local_sources',
    sourceLengths: { 'story/relationships/r1': 100, 'story/relationships/r2': 90, 'story/relationships/legacy': 40 },
    sourceRelationships: {
      'story/relationships/r1': { fromCharacterId: 'a', toCharacterId: 'b', fromName: '林辰', toName: '林辰', kind: 'trust' },
      'story/relationships/r2': { fromCharacterId: 'b', toCharacterId: 'unknown', fromName: '林辰' },
    },
  } } };
  const before = structuredClone(input), rows = reviewSourceCoverage(input)!;
  assert.deepEqual(rows.map(row => row.name), ['林辰（a） → 林辰（b）', '林辰（b） → unknown', undefined]);
  assert.ok(rows.every(row => row.status === 'absent' && row.fragments.length === 0));
  assert.deepEqual(input, before);
});
