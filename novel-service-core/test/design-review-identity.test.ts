import test from 'node:test';
import assert from 'node:assert/strict';
import { designReviewChapterCast } from '../src/design-review-scope.ts';
import { createDesignReviewRun, designReviewStageInput, acceptDesignReviewStage } from '../src/design-review-run.ts';
import type { DesignReviewInput, DesignReviewResult } from '../src/design-review.ts';

const source = (id: string, value: unknown) => ({ id, text: JSON.stringify(value) });
const input = (): DesignReviewInput => ({ area: 'characters', scope: { worldPackRevision: 1, storyBibleRevision: 1, planRevisionId: 'plan-1', planRevision: 1 }, inputHash: 'a'.repeat(64), rubric: { agency: '核人物的独立选择' }, sources: [
  source('story/characters/brother', { id: 'brother', name: '陆沉舟' }),
  source('story/characters/younger', { id: 'younger', name: '陆沉川' }),
  source('plan/chapters/37', { chapterNumber: 37, characterIds: ['younger'], summary: '弟弟自行爬出，哥哥尚未到场。' }),
  source('plan/chapters/44', { chapterNumber: 44, characterIds: ['brother'], summary: '哥哥护账离去，不能写成弟弟的选择。' }),
  source('story/chapterPlans/mirror-37', { chapterNumber: 37, characterIds: ['brother'], summary: '此镜像与细纲不一致，导航不能替它作裁决。' }),
] });
const pass = (request: DesignReviewInput): DesignReviewResult => ({ summary: 'Test fixture', checks: Object.keys(request.rubric).map(criterion => ({
  criterion, verdict: 'pass', explanation: 'Fixture for schedule restoration only', evidence: [{ sourceId: request.sources[0].id, quote: request.sources[0].text.slice(0, 40) }], revisionAdvice: '',
})) });

test('chapter cast keeps sibling IDs and conflicting declarations separate without interpreting prose', () => {
  const original = input(), before = JSON.stringify(original);
  const cast = designReviewChapterCast(original);
  assert.deepEqual(cast.chapters, [
    { sourceId: 'plan/chapters/37', chapterNumber: 37, characterIds: ['younger'] },
    { sourceId: 'plan/chapters/44', chapterNumber: 44, characterIds: ['brother'] },
    { sourceId: 'story/chapterPlans/mirror-37', chapterNumber: 37, characterIds: ['brother'] },
  ]);
  assert.deepEqual(cast.characters, { brother: { sourceId: 'story/characters/brother', name: '陆沉舟' }, younger: { sourceId: 'story/characters/younger', name: '陆沉川' } });
  cast.chapters[0].characterIds.push('brother');
  assert.equal(JSON.stringify(original), before);
});

test('ambiguous and mismatched profiles cannot assign names; chapter numbers and cast are never guessed', () => {
  const original = input();
  original.sources.push(
    source('settings/characters/brother', { id: 'brother', name: '另一名字' }),
    source('story/characters/wrong-path', { id: 'stranger', name: '不可猜测' }),
    source('plan/chapters/99', { chapterNumber: 12, characterIds: ['stranger', 'unknown'] }),
    source('plan/chapters/88', { characterIds: ['brother'] }),
    source('plan/chapters/invalid-number', { chapterNumber: 0, characterIds: ['brother'] }),
    source('plan/chapters/mixed', { chapterNumber: 45, characterIds: ['brother', null] }),
    { id: 'plan/chapters/broken', text: '{invalid' },
  );
  const cast = designReviewChapterCast(original);
  assert.deepEqual(cast.characters, { younger: { sourceId: 'story/characters/younger', name: '陆沉川' } });
  assert.deepEqual(cast.chapters.at(-1), { sourceId: 'plan/chapters/99', chapterNumber: 12, characterIds: ['stranger', 'unknown'] });
  assert.equal(cast.chapters.length, 4);
});

test('v31 cast navigation survives raw and synthesis restoration; saved v30 remains unchanged', () => {
  const original = input();
  original.sources.push({ id: 'large', text: '其他完整原文。'.repeat(45000) });
  const old = createDesignReviewRun(original, undefined, 30), run = createDesignReviewRun(original, old.createdAt);
  assert.deepEqual(run.units, old.units);
  assert.deepEqual(run.stages, old.stages);
  const oldFirst = designReviewStageInput(old, old.stages[0]);
  assert.equal(oldFirst.stage!.coverage!.chapterCast, undefined);
  for (const stage of run.stages) {
    const request = designReviewStageInput(run, stage);
    assert.deepEqual(request.stage!.coverage!.chapterCast, designReviewChapterCast(original));
    const restored = JSON.parse(JSON.stringify(run));
    assert.deepEqual(designReviewStageInput(restored, restored.stages.find((item: { id: string }) => item.id === stage.id)), request);
    assert.ok(JSON.stringify(request.sources).length <= 240000);
    assert.ok(JSON.stringify(request.stage!.coverage).length <= 40000);
    acceptDesignReviewStage(run, stage, pass(request));
  }
  assert.deepEqual(designReviewStageInput(old, old.stages[0]), oldFirst);
});

test('oversized cast navigation is omitted whole without dropping declared IDs or source text', () => {
  const original = input();
  const ids = Array.from({ length: 5000 }, (_, index) => `character-long-id-${index}`);
  original.sources.push(source('plan/chapters/100', { chapterNumber: 100, characterIds: ids }));
  const run = createDesignReviewRun(original), request = designReviewStageInput(run, run.stages[0]);
  assert.equal(request.stage!.coverage!.chapterCast, undefined);
  assert.equal(request.stage!.coverage!.chapterCastOmitted, 'capacity');
  for (const raw of original.sources) {
    const units = run.units.filter(unit => unit.sourceId === raw.id);
    assert.equal(units.map(unit => raw.text.slice(unit.start, unit.end)).join(''), raw.text);
    assert.ok(units.every(unit => run.stages.some(stage => stage.kind === 'batch' && stage.unitIds.includes(unit.id))));
  }
});
