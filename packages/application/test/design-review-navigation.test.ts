import test from 'node:test';
import assert from 'node:assert/strict';
import { designReviewEntityMentions } from '../../../novel-service-core/src/design-review-scope.ts';
import { createDesignReviewRun, designReviewStageInput } from '../../../novel-service-core/src/design-review-run.ts';
import { validateDesignReview, type DesignReviewInput } from '../../../novel-service-core/src/design-review.ts';

const source = (id: string, value: unknown) => ({ id, text: JSON.stringify(value) });
const request = (): DesignReviewInput => ({ area: 'story', inputHash: 'a'.repeat(64), scope: { worldPackRevision: 1, storyBibleRevision: 1, planRevisionId: 'p', planRevision: 1 }, rubric: { causality: '核取得与训练' }, sources: [
  source('world/techniques/tech_04', { id: 'tech_04', name: '乾元御风剑诀' }),
  source('world/artifacts/art_03', { id: 'art_03', name: '赤霞斩铁剑' }),
  source('world/resources/res_09', { id: 'res_09', name: '延寿灵泉' }),
  source('plan/chapters/18', { chapterNumber: 18, scenes: ['练习乾元御风剑诀，失控后停练。'] }),
  source('story/chapterPlans/chapter-plan-18', { chapterNumber: 18, purpose: '领用赤霞斩铁剑。' }),
  source('plan/milestones/training', { notes: '尚未掌握乾元御风剑诀，不能施用。', references: ['tech_04', 'res_09'] }),
  source('plan/chapters/19', { references: ['tech_040', 'art_030', 'res_090'] }),
  source('review-result/old', { summary: '乾元御风剑诀已学成' }),
  { id: 'plan/chapters/20', text: 'not JSON: 乾元御风剑诀' },
  source('world/techniques/invalid', ['不能把数组当条目']),
] });

test('entity navigation finds actual training sources and negative mentions without guessing aliases or ID prefixes', () => {
  const input = request(), before = structuredClone(input);
  assert.deepEqual(designReviewEntityMentions(input), {
    'world/techniques/tech_04': ['plan/chapters/18', 'plan/milestones/training'],
    'world/artifacts/art_03': ['story/chapterPlans/chapter-plan-18'],
    'world/resources/res_09': ['plan/milestones/training'],
  });
  assert.deepEqual(input, before);
});

test('v13 locates unread prerequisites while v12 inputs, raw partitioning and citation requirements remain unchanged', () => {
  const input = request();
  input.sources.splice(3, 0, { id: 'padding', text: '原文。'.repeat(100_000) });
  const run = createDesignReviewRun(input), legacy = createDesignReviewRun(input, undefined, 12);
  assert.deepEqual(run.units, legacy.units);
  assert.deepEqual(run.stages, legacy.stages);
  const staged = designReviewStageInput(run, run.stages[0]);
  const old = designReviewStageInput(legacy, legacy.stages[0]);
  assert.deepEqual(staged.sources, old.sources);
  assert.deepEqual(staged.rubric, old.rubric);
  assert.equal(old.stage!.coverage!.entityMentions, undefined);
  assert.deepEqual(staged.stage!.coverage!.entityMentions!['world/techniques/tech_04'], ['plan/chapters/18', 'plan/milestones/training']);
  assert.ok(!staged.stage!.sourceMap.some(unit => unit.sourceId === 'plan/chapters/18'));
  assert.deepEqual(designReviewStageInput(JSON.parse(JSON.stringify(run)), run.stages[0]), staged);
  assert.throws(() => validateDesignReview(staged, { summary: '不能以索引替代原文', checks: [{ criterion: 'causality', verdict: 'pass', explanation: '只见目录', revisionAdvice: '', evidence: [{ sourceId: 'plan/chapters/18', quote: '乾元御风剑诀' }] }] }), /引用不在原文/);
});

test('oversized optional mention navigation is omitted whole without removing raw sources or the complete source inventory', () => {
  const input = request();
  const names = Array.from({ length: 40 }, (_, n) => `功法名称${n}终`);
  input.sources = [
    ...names.map((name, n) => source(`world/techniques/t${n}`, { id: `t${n}`, name })),
    ...Array.from({ length: 200 }, (_, n) => source(`plan/chapters/${n + 1}`, { names })),
  ];
  const run = createDesignReviewRun(input), staged = designReviewStageInput(run, run.stages[0]);
  assert.equal(staged.stage!.coverage!.entityMentionsOmitted, 'capacity');
  assert.equal(staged.stage!.coverage!.entityMentions, undefined);
  assert.ok(JSON.stringify(staged.stage!.coverage).length <= 40_000);
  assert.deepEqual(staged.sources, input.sources);
  assert.deepEqual(Object.keys(staged.stage!.coverage!.sourceLengths), input.sources.map(s => s.id));
});
