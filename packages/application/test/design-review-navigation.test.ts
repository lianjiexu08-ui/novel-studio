import test from 'node:test';
import assert from 'node:assert/strict';
import { designReviewEntityMentions, designReviewPlanCharacters, designReviewPlanNeighbors } from '../../../novel-service-core/src/design-review-scope.ts';
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

test('v19 can locate existing character training without treating mentions as mastery or changing older indexes', () => {
  const input = request();
  input.sources.push(
    source('story/characters/gu', { id: 'gu', identity: '开篇前已由师长指导实测乾元御风剑诀，伤后仍需复诊。' }),
    source('settings/characters/lin', { id: 'lin', background: '尚未学会乾元御风剑诀，不可由境界推断。' }),
    source('story/characters/other', { id: 'other', reference: 'tech_040' }),
    source('story/characters/id-reference', { id: 'id-reference', techniqueId: 'tech_04' }),
    source('story/characters/unnamed', { id: 'unnamed', identity: '剑修，未具名任何功法。' }),
  );
  const old = designReviewEntityMentions(input), current = designReviewEntityMentions(input, true);
  assert.deepEqual(old['world/techniques/tech_04'], ['plan/chapters/18', 'plan/milestones/training']);
  assert.deepEqual(current['world/techniques/tech_04'], [...old['world/techniques/tech_04'], 'story/characters/gu', 'settings/characters/lin', 'story/characters/id-reference']);
  assert.equal(current['world/techniques/tech_04'].includes('story/characters/unnamed'), false);
  assert.equal(current['world/techniques/tech_04'].includes('story/characters/other'), false);
  assert.equal(input.sources.find(s => s.id === 'settings/characters/lin')!.text.includes('尚未学会'), true);
});

test('navigation is recalculated after in-place source edits and returned navigation cannot poison a later read', () => {
  const input = request();
  input.sources.push(source('story/characters/gu', { identity: '开篇前训练乾元御风剑诀。' }));
  const run = createDesignReviewRun(input), stage = run.stages[0];
  const first = designReviewStageInput(run, stage);
  assert.ok(first.stage!.coverage!.entityMentions!['world/techniques/tech_04'].includes('story/characters/gu'));
  first.stage!.coverage!.entityMentions!['world/techniques/tech_04'].push('invented/source');
  run.input.sources.find(s => s.id === 'story/characters/gu')!.text = JSON.stringify({ identity: '不再具名任何功法。' });
  const next = designReviewStageInput(run, stage);
  assert.equal(next.stage!.coverage!.entityMentions!['world/techniques/tech_04'].includes('story/characters/gu'), false);
  assert.equal(next.stage!.coverage!.entityMentions!['world/techniques/tech_04'].includes('invented/source'), false);
});

for (const oversizedProfile of [false, true]) {
  test(`v19 adds complete character skill context only when it fits; oversized=${oversizedProfile}`, () => {
    const input = request();
    input.area = 'power';
    const profile = { id: 'story/characters/gu', text: JSON.stringify({ identity: '顾既有训练涉及乾元御风剑诀，但不表示当前伤情合格。' + (oversizedProfile ? '完整前史不得裁切。'.repeat(30000) : '') }) };
    input.sources = [
      { id: 'world/axioms/shared', text: '规则原文'.repeat(9000) },
      source('plan/chapters/64', { chapterNumber: 64, summary: '顾拟用乾元御风剑诀切普通绳索，须核既有训练及当前条件。' }),
      ...Array.from({ length: 3 }, (_, n) => ({ id: `padding/${n}`, text: '原始材料'.repeat(22000) })),
      source('world/techniques/tech_04', { id: 'tech_04', name: '乾元御风剑诀', requirement: '先训练并实测，不由身份推断。'.repeat(700) }),
      profile,
    ];
    const inputs = [];
    for (const version of [18, 19] as const) {
      const run = createDesignReviewRun(input, undefined, version);
      for (const stage of [...run.stages.filter(s => s.kind !== 'synthesis')]) {
        const staged = designReviewStageInput(run, stage);
        const use = staged.stage!.sourceMap.find(u => u.sourceId === 'plan/chapters/64');
        const quoted = use ? staged.sources.find(s => s.id === use.id)! : staged.sources[0];
        acceptDesignReviewStage(run, stage, { summary: '只核所给原文', checks: Object.keys(staged.rubric).map(criterion => ({ criterion,
          verdict: stage.id === 'batch-1' ? 'insufficient' : 'pass', explanation: '原安排需要核功法条件', revisionAdvice: stage.id === 'batch-1' ? '补读功法规则' : '',
          evidence: [{ sourceId: quoted.id, quote: quoted.text.slice(0, 40) }], ...(stage.id === 'batch-1' ? { awaitingSources: ['world/techniques/tech_04'] } : {}),
        })) });
      }
      const followup = run.stages.find(s => s.followupFor)!;
      const staged = designReviewStageInput(run, followup);
      const units = staged.stage!.sourceMap.filter(u => u.sourceId === profile.id);
      assert.equal(followup.result, undefined, 'navigation never manufactures a passed or resolved review');
      assert.ok(JSON.stringify(staged.sources).length <= 240000);
      const expected = version === 19 && !oversizedProfile;
      assert.equal(units.length > 0, expected);
      if (expected) assert.equal(units.map(u => staged.sources.find(s => s.id === u.id)!.text).join(''), profile.text);
      if (version === 19 && oversizedProfile) assert.ok(staged.stage!.coverage!.relatedSourceContext!.omittedSourceIds.includes(profile.id));
      const mandatory = staged.stage!.sourceMap.filter(u => u.sourceId === 'world/techniques/tech_04');
      assert.ok(mandatory.length > 0, 'optional biography never evicts requested rules');
      assert.equal(run.units.filter(u => u.sourceId === profile.id).map(u => profile.text.slice(u.start, u.end)).join(''), profile.text, 'original full biography stays in the review input');
      inputs.push(staged);
    }
    assert.equal(inputs[0].stage!.coverage!.entityMentions!['world/techniques/tech_04'].includes(profile.id), false);
    assert.equal(inputs[1].stage!.coverage!.entityMentions!['world/techniques/tech_04'].includes(profile.id), true);
  });
}

function dependencyInput(extra = ''): DesignReviewInput {
  return { area: 'power', inputHash: 'b'.repeat(64), scope: { worldPackRevision: 1, storyBibleRevision: 1, planRevisionId: 'p', planRevision: 1 }, rubric: { counters: '核反制和行动条件' }, sources: [
    source('plan/overview', { dependencies: [
      { sourceId: 'training', targetId: 'convoy', requiredness: 'must' },
      { sourceId: 'convoy', targetId: 'aftermath', requiredness: 'must' },
      { sourceId: 'missing', targetId: 'training', requiredness: 'must' },
    ] }),
    source('world/axioms/shared', { content: '规则。'.repeat(11000) }),
    source('plan/chapters/80', { id: 'chapter-80', chapterNumber: 80, summary: '后续护罡牵制需核已有训练及对抗条件。' }),
    ...Array.from({ length: 3 }, (_, n) => ({ id: `padding/${n}`, text: '原文。'.repeat(29000) })),
    source('plan/milestones/training', { id: 'training', startChapter: 81, endChapter: 87, setup: '局部护罡训练和实测，不等于能持续挡刀。' }),
    source('plan/milestones/convoy', { id: 'convoy', startChapter: 88, endChapter: 95, setup: '利用车角退步，三次护罡八成减至二成，第三次肩伤后立即退出。' + extra }),
    source('plan/milestones/aftermath', { id: 'aftermath', startChapter: 96, endChapter: 100, setup: '伤后转运，尚未发生。' }),
  ] };
}

function dependencyFollowup(version: 20 | 21, extra = '') {
  const input = dependencyInput(extra), run = createDesignReviewRun(input, undefined, version);
  for (const stage of [...run.stages.filter(s => s.kind !== 'synthesis')]) {
    const staged = designReviewStageInput(run, stage);
    const unit = staged.stage!.sourceMap.find(u => u.sourceId === 'plan/chapters/80');
    const cited = unit ? staged.sources.find(s => s.id === unit.id)! : staged.sources[0];
    acceptDesignReviewStage(run, stage, { summary: '局部核验', checks: [{ criterion: 'counters', verdict: stage.id === 'batch-1' ? 'insufficient' : 'pass', explanation: '需对照实际训练', revisionAdvice: stage.id === 'batch-1' ? '补读训练原文后核验' : '', evidence: [{ sourceId: cited.id, quote: cited.text.slice(0, 40) }], ...(stage.id === 'batch-1' ? { awaitingSources: ['plan/milestones/training'] } : {}) }] });
  }
  const followup = run.stages.find(s => s.followupFor === 'batch-1/counters')!;
  return { run, input, followup, staged: designReviewStageInput(run, followup) };
}

test('plan dependency navigation follows one explicit edge in either direction, excluding dangling and ambiguous IDs', () => {
  const input = dependencyInput();
  assert.deepEqual(designReviewPlanNeighbors(input, ['plan/milestones/training']), ['plan/milestones/convoy']);
  assert.deepEqual(designReviewPlanNeighbors(input, ['plan/milestones/convoy']), ['plan/milestones/training', 'plan/milestones/aftermath']);
  assert.deepEqual(designReviewPlanNeighbors(input, ['plan/overview']), []);
  const unchanged = structuredClone(input);
  designReviewPlanNeighbors(input, ['plan/milestones/training']);
  assert.deepEqual(input, unchanged);
  input.sources.push(source('plan/chapters/99', { id: 'convoy', chapterNumber: 99 }));
  assert.deepEqual(designReviewPlanNeighbors(input, ['plan/milestones/training']), [], 'ambiguous object IDs must not guess a matching source');
  input.sources[0].text = 'invalid overview';
  assert.deepEqual(designReviewPlanNeighbors(input, ['plan/milestones/training']), []);
});

test('v21 co-reads complete direct plan dependencies in followups without expanding to transitive plans or changing v20', () => {
  const old = dependencyFollowup(20), current = dependencyFollowup(21);
  assert.ok(!old.staged.stage!.sourceMap.some(u => u.sourceId === 'plan/milestones/convoy'));
  assert.deepEqual(old.staged.stage!.coverage!.relatedSourceContext, undefined);
  const ids = current.staged.stage!.sourceMap.filter(u => u.sourceId === 'plan/milestones/convoy').map(u => u.id);
  assert.equal(current.staged.sources.filter(s => ids.includes(s.id)).map(s => s.text).join(''), current.input.sources.find(s => s.id === 'plan/milestones/convoy')!.text);
  assert.ok(current.staged.stage!.coverage!.relatedSourceContext!.includedSourceIds.includes('plan/milestones/convoy'));
  assert.ok(!current.staged.stage!.sourceMap.some(u => u.sourceId === 'plan/milestones/aftermath'));
  assert.equal(current.followup.result, undefined, 'supplying evidence never resolves the question automatically');
  assert.deepEqual(current.staged.stage!.coverage!.pendingChecks![0].requiredSourceIds, ['plan/milestones/training']);
  assert.deepEqual(current.run.stages.filter(s => !s.followupFor && s.kind !== 'synthesis'), old.run.stages.filter(s => !s.followupFor && s.kind !== 'synthesis'));
  assert.deepEqual(designReviewStageInput(JSON.parse(JSON.stringify(old.run)), old.followup), old.staged);
});

test('v21 never truncates an oversized optional dependency or evicts required sources', () => {
  const { input, staged, followup } = dependencyFollowup(21, '完整对抗条件不能截断。'.repeat(30000));
  assert.ok(JSON.stringify(staged.sources).length <= 240000);
  assert.ok(!staged.stage!.sourceMap.some(u => u.sourceId === 'plan/milestones/convoy'));
  assert.deepEqual(staged.stage!.coverage!.relatedSourceContext!.omittedSourceIds, ['plan/milestones/convoy']);
  for (const id of ['plan/chapters/80', 'plan/milestones/training']) {
    const ids = staged.stage!.sourceMap.filter(u => u.sourceId === id).map(u => u.id);
    assert.equal(staged.sources.filter(s => ids.includes(s.id)).map(s => s.text).join(''), input.sources.find(s => s.id === id)!.text);
  }
  assert.ok(staged.sources.some(s => s.id === 'review-question/batch-1/counters'));
  assert.equal(followup.result, undefined);
});


test('chapter cast navigation uses exact unique profile bindings without inferring training or following relationships', () => {
  const input = dependencyInput();
  input.sources.push(
    source('plan/chapters/25', { characterIds: ['gu', 'missing', 'ambiguous', 'mismatch', 10], summary: '未列入出场的林也被提到。' }),
    source('story/characters/gu', { id: 'gu', identity: '尚未完成护罡实测，不能使用。', relatedCharacterIds: ['lin'] }),
    source('story/characters/lin', { id: 'lin', identity: '关系人不应递归补读。' }),
    source('story/characters/ambiguous', { id: 'ambiguous' }),
    source('settings/characters/ambiguous', { id: 'ambiguous' }),
    source('story/characters/wrong', { id: 'mismatch' }),
    { id: 'plan/chapters/26', text: 'invalid JSON' },
    source('plan/chapters/27', { characterIds: 'gu' }),
  );
  const before = structuredClone(input);
  assert.deepEqual(designReviewPlanCharacters(input, ['plan/chapters/25', 'plan/chapters/26', 'plan/chapters/27']), ['story/characters/gu']);
  assert.deepEqual(designReviewPlanCharacters(input, ['plan/overview']), []);
  assert.deepEqual(input, before);
});

function castFollowup(version: 21 | 22, oversized = false) {
  const input = dependencyInput();
  input.sources.find(s => s.id === 'plan/chapters/80')!.text = JSON.stringify({ id: 'chapter-80', characterIds: ['gu'], summary: '顾拟用局部护罡，必须核对既有训练和当前伤情。' });
  // The requested chapter and the cited chapter each contribute an explicit cast.
  input.sources.push(
    source('plan/chapters/83', { id: 'chapter-83', characterIds: ['lin'], summary: '林准备训练。' }),
    source('story/characters/gu', { id: 'gu', identity: '开篇前已指导、低负荷接触实测和复诊；伤后仍需停术。' + (oversized ? '完整档案不得截断。'.repeat(40000) : '') }),
    source('story/characters/lin', { id: 'lin', identity: '尚未完成护罡训练，不能凭晋阶自动掌握。' }),
    source('story/characters/unrelated', { id: 'unrelated', identity: '未参与本次待核行动。' }),
  );
  const run = createDesignReviewRun(input, undefined, version);
  for (const stage of [...run.stages.filter(s => s.kind !== 'synthesis')]) {
    const staged = designReviewStageInput(run, stage);
    const unit = staged.stage!.sourceMap.find(u => u.sourceId === 'plan/chapters/80');
    const cited = unit ? staged.sources.find(s => s.id === unit.id)! : staged.sources[0];
    acceptDesignReviewStage(run, stage, { summary: '局部核验', checks: [{ criterion: 'counters', verdict: stage.id === 'batch-1' ? 'insufficient' : 'pass', explanation: '需核动作规则与角色资格', revisionAdvice: stage.id === 'batch-1' ? '补读训练原文' : '', evidence: [{ sourceId: cited.id, quote: cited.text.slice(0, 40) }], ...(stage.id === 'batch-1' ? { awaitingSources: ['plan/milestones/training', 'plan/chapters/83'] } : {}) }] });
  }
  const followup = run.stages.find(s => s.followupFor === 'batch-1/counters')!;
  return { run, input, followup, staged: designReviewStageInput(run, followup) };
}

test('v22 co-reads complete cast biographies for requested and cited chapters while preserving v21 and unresolved findings', () => {
  const old = castFollowup(21), current = castFollowup(22);
  for (const id of ['story/characters/gu', 'story/characters/lin']) {
    assert.ok(!old.staged.stage!.sourceMap.some(u => u.sourceId === id));
    const units = current.staged.stage!.sourceMap.filter(u => u.sourceId === id);
    assert.ok(units.length);
    assert.equal(units.map(u => current.staged.sources.find(s => s.id === u.id)!.text).join(''), current.input.sources.find(s => s.id === id)!.text);
    assert.ok(current.staged.stage!.coverage!.relatedSourceContext!.includedSourceIds.includes(id));
  }
  assert.ok(!current.staged.stage!.sourceMap.some(u => u.sourceId === 'story/characters/unrelated'));
  assert.equal(current.followup.result, undefined);
  assert.deepEqual(current.staged.stage!.coverage!.pendingChecks![0].requiredSourceIds, ['plan/milestones/training', 'plan/chapters/83']);
  assert.deepEqual(current.run.units, old.run.units);
  assert.deepEqual(current.run.stages.filter(s => !s.followupFor && s.kind !== 'synthesis'), old.run.stages.filter(s => !s.followupFor && s.kind !== 'synthesis'));
  assert.deepEqual(designReviewStageInput(JSON.parse(JSON.stringify(old.run)), old.followup), old.staged);
  assert.deepEqual(designReviewStageInput(JSON.parse(JSON.stringify(current.run)), current.followup), current.staged);
  const profile = current.staged.stage!.sourceMap.find(u => u.sourceId === 'story/characters/gu')!;
  assert.throws(() => validateDesignReview(current.staged, { summary: '仅有档案不等于通过', checks: [{ criterion: 'counters', verdict: 'pass', explanation: '不能跳过待核问题和规则', revisionAdvice: '', resolves: ['batch-1/counters'], evidence: [{ sourceId: profile.id, quote: current.staged.sources.find(s => s.id === profile.id)!.text.slice(0, 40) }] }] }), /必须引用|缺少/);
});

test('v22 omits oversized optional biographies whole and retains mandatory sources and pending question', () => {
  const { staged, input, followup } = castFollowup(22, true);
  assert.ok(JSON.stringify(staged.sources).length <= 240000);
  assert.ok(!staged.stage!.sourceMap.some(u => u.sourceId === 'story/characters/gu'));
  assert.ok(staged.stage!.coverage!.relatedSourceContext!.omittedSourceIds.includes('story/characters/gu'));
  for (const id of ['plan/chapters/80', 'plan/milestones/training', 'plan/chapters/83']) {
    const units = staged.stage!.sourceMap.filter(u => u.sourceId === id);
    assert.equal(units.map(u => staged.sources.find(s => s.id === u.id)!.text).join(''), input.sources.find(s => s.id === id)!.text);
  }
  assert.ok(staged.sources.some(s => s.id === 'review-question/batch-1/counters'));
  assert.equal(followup.result, undefined);
});
