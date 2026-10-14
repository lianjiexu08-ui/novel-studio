import test from 'node:test';
import assert from 'node:assert/strict';
import { designReviewEntityMentions } from '../../../novel-service-core/src/design-review-scope.ts';
import { createDesignReviewRun, designReviewStageInput, acceptDesignReviewStage } from '../../../novel-service-core/src/design-review-run.ts';
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
  const run = createDesignReviewRun(input, undefined, 13), legacy = createDesignReviewRun(input, undefined, 12);
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

function prerequisiteFollowup(version: 13 | 14, trainingText = '尚未掌握乾元御风剑诀，不能凭境界施术。') {
  const input = request();
  input.sources = [
    source('world/axioms/shared', { content: '规'.repeat(38_000) }),
    source('plan/chapters/64', { chapterNumber: 64, summary: '以乾元御风剑诀切绳，需核前置。' }),
    ...Array.from({ length: 3 }, (_, n) => ({ id: `padding/${n}`, text: '原始材料'.repeat(22_000) })),
    source('world/techniques/tech_04', { id: 'tech_04', name: '乾元御风剑诀', rules: '原始规则'.repeat(1500) }),
    source('plan/chapters/18', { chapterNumber: 18, summary: trainingText }),
  ];
  const run = createDesignReviewRun(input, undefined, version);
  for (const stage of [...run.stages.filter(s => s.kind !== 'synthesis')]) {
    const staged = designReviewStageInput(run, stage);
    const cited = staged.sources.find(s => staged.stage!.sourceMap.some(u => u.id === s.id && u.sourceId === 'plan/chapters/64')) ?? staged.sources[0];
    const check = { criterion: 'causality', verdict: 'pass' as 'pass' | 'insufficient', explanation: '核对本批', revisionAdvice: '', evidence: [{ sourceId: cited.id, quote: cited.text.slice(0, 40) }] };
    acceptDesignReviewStage(run, stage, { summary: '本批结果', checks: [stage.id === 'batch-1' ? { ...check, verdict: 'insufficient', explanation: '需要功法与训练前置', revisionAdvice: '补读规则及训练', awaitingSources: ['world/techniques/tech_04'] } : check] });
  }
  const followup = run.stages.find(s => s.followupFor === 'batch-1/causality')!;
  return { run, input, followup, staged: designReviewStageInput(run, followup) };
}

test('v14 supplements rule-only followups with complete existing training candidates without auto-resolving them', () => {
  const current = prerequisiteFollowup(14), legacy = prerequisiteFollowup(13);
  assert.ok(!legacy.staged.stage!.sourceMap.some(u => u.sourceId === 'plan/chapters/18'));
  const units = current.staged.stage!.sourceMap.filter(u => u.sourceId === 'plan/chapters/18');
  assert.equal(current.staged.sources.filter(s => units.some(u => u.id === s.id)).map(s => s.text).join(''), current.input.sources.find(s => s.id === 'plan/chapters/18')!.text);
  assert.ok(current.staged.stage!.coverage!.relatedSourceContext!.includedSourceIds.includes('plan/chapters/18'));
  assert.deepEqual(current.staged.stage!.coverage!.relatedSourceContext!.omittedSourceIds, []);
  assert.equal(current.followup.result, undefined);
  const pending = current.staged.stage!.coverage!.pendingChecks!.find(p => p.id === 'batch-1/causality')!;
  assert.deepEqual(pending.requiredSourceIds, ['world/techniques/tech_04']);
  assert.throws(() => validateDesignReview(current.staged, { summary: '不可因附带原文就自动通过', checks: [{ criterion: 'causality', verdict: 'pass', explanation: '只引用索引找到的训练', revisionAdvice: '', resolves: [pending.id], evidence: [{ sourceId: units[0].id, quote: current.staged.sources.find(s => s.id === units[0].id)!.text.slice(0, 40) }] }] }), /必须引用|缺少/);
});

test('oversized related training text stays unresolved and is not truncated or substituted for mandatory followup evidence', () => {
  const { staged } = prerequisiteFollowup(14, '乾元御风剑诀完整训练记录。' + '未完成。'.repeat(65_000));
  assert.ok(JSON.stringify(staged.sources).length <= 240_000);
  assert.ok(!staged.stage!.sourceMap.some(u => u.sourceId === 'plan/chapters/18'));
  assert.deepEqual(staged.stage!.coverage!.relatedSourceContext!.omittedSourceIds, ['plan/chapters/18']);
  assert.ok(staged.stage!.sourceMap.some(u => u.sourceId === 'world/techniques/tech_04'));
  assert.ok(staged.sources.some(s => s.id === 'review-question/batch-1/causality'));
  assert.ok(staged.stage!.sourceMap.some(u => u.sourceId === 'plan/chapters/64'));
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
