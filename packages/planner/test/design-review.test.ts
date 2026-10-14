import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonDesignPlanner, PlanningParseError } from '../src/index.ts';
import { prepareDesignReviewEvidence } from '../src/design-review-evidence.ts';
import { DesignReviewCitationError, designReviewInput, validateDesignReview } from '../../../novel-service-core/src/design-review.ts';
import { ChapterWorkflow, InMemoryWorkRepository } from '../../application/src/index.ts';
import { createReadyWork, fixtureDesignReview } from '../../application/test/fixtures.ts';

async function input() {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), { generateChapter: () => ({ content: '', proposedEvents: [] }) });
  return designReviewInput(await createReadyWork(workflow), 'power');
}
function anchored(request: Awaited<ReturnType<typeof input>>) {
  const { sources, requestId } = prepareDesignReviewEvidence(request);
  const result = fixtureDesignReview(request);
  return { ...result, requestId, checks: result.checks.map((check) => ({ ...check,
    evidence: check.evidence.map((item) => ({ fragmentId: sources.find((s) => s.id === item.sourceId)!.fragments[0].id })),
  })) };
}

test('content reviewer selects exact request-bound fragments using the reviewing role', async () => {
  const request = await input();
  const response = anchored(request);
  const planner = new JsonDesignPlanner({ complete: async (call) => {
    assert.equal(call.role, 'reviewing');
    assert.equal(call.maxOutputTokens, 8000);
    assert.match(call.system, /100章可以是百万字项目的阶段验收/);
    const body = JSON.parse(call.user);
    assert.equal(body.area, 'power');
    assert.equal(body.evaluationStage, 'design_proposal');
    assert.equal(body.requestId, prepareDesignReviewEvidence(request).requestId);
    assert.deepEqual(body.scope, request.scope);
    assert.deepEqual(body.sources, prepareDesignReviewEvidence(request).sources);
    assert.deepEqual(body.rubric, request.rubric);
    return JSON.stringify(response);
  } });
  const result = await planner.reviewDesignContent(request);
  assert.deepEqual(result, { ...prepareDesignReviewEvidence(request).resolve(response), modelResponses: [JSON.stringify(response)] });
  validateDesignReview(request, result);
});

test('entity mentions reach the model as navigation and never turn a negative prerequisite into a pass', async () => {
  const request = await input();
  request.stage = { kind: 'batch', label: '能力前置', totalBatches: 2, sourceMap: [], coverage: {
    mode: 'local_sources', sourceLengths: { ...Object.fromEntries(request.sources.map(s => [s.id, s.text.length])), 'plan/chapters/18': 100 },
    entityMentions: { 'world/techniques/tech_04': ['plan/chapters/18'] },
  } };
  const before = structuredClone(request), response = anchored(request);
  Object.assign(response.checks[0], { verdict: 'insufficient', explanation: '需要补读具体训练与实测', revisionAdvice: '补读18章', awaitingSources: ['plan/chapters/18'] });
  const planner = new JsonDesignPlanner({ complete: async call => {
    const body = JSON.parse(call.user);
    assert.deepEqual(body.stage.coverage.entityMentions, request.stage!.coverage!.entityMentions);
    assert.match(call.system, /否定句也会被列出/);
    assert.deepEqual(body.sources, prepareDesignReviewEvidence(request).sources);
    return JSON.stringify(response);
  } });
  const result = await planner.reviewDesignContent(request);
  assert.equal(result.checks[0].verdict, 'insufficient');
  assert.deepEqual(result.checks[0].awaitingSources, ['plan/chapters/18']);
  assert.deepEqual(request, before);
});

test('intermediate synthesis scope reaches the model, binds evidence and does not force a pass', async () => {
  const request = await input();
  request.stage = { kind: 'synthesis', label: '中间汇总', totalBatches: 3, sourceMap: [], coverage: {
    mode: 'reports_with_context', sourceLengths: Object.fromEntries(request.sources.map(s => [s.id, s.text.length])),
    synthesis: { scope: 'partial_reports', coveredStageIds: ['batch-1', 'batch-2'], totalStages: 6 },
  } };
  const before = structuredClone(request), response = anchored(request);
  Object.assign(response.checks[0], { verdict: 'insufficient', explanation: '报告中的具体能力没有门槛依据', revisionAdvice: '补齐能力门槛' });
  const planner = new JsonDesignPlanner({ complete: async call => {
    const sent = JSON.parse(call.user);
    assert.deepEqual(sent.stage.coverage.synthesis, request.stage!.coverage!.synthesis);
    assert.deepEqual(sent.rubric, request.rubric);
    assert.match(call.system, /partial_reports表示中间汇总/);
    assert.match(call.system, /complete_reports才合并全部步骤/);
    assert.match(call.system, /具体返修、普通不足、尚未解决等待/);
    return JSON.stringify(response);
  } });
  const result = await planner.reviewDesignContent(request);
  assert.equal(result.checks[0].verdict, 'insufficient');
  assert.deepEqual(request, before);
  const differentScope = structuredClone(request);
  differentScope.stage!.coverage!.synthesis = { scope: 'complete_reports', coveredStageIds: ['batch-1', 'batch-2', 'batch-3', 'cross-1-2', 'cross-1-3', 'cross-2-3'], totalStages: 6 };
  assert.throws(() => prepareDesignReviewEvidence(differentScope).resolve(response), /请求编号/);
});

test('planning horizon reaches the model without substituting source evidence or clearing a real gap', async () => {
  const request = await input();
  const overview = request.sources.find(s => s.id === 'plan/overview')!;
  overview.text = JSON.stringify({ targetChapterCount: 100, detailedThroughChapter: 50, outlinedChapterNumbers: Array.from({ length: 50 }, (_, i) => i + 1) });
  const before = structuredClone(request), response = anchored(request), prepared = prepareDesignReviewEvidence(request);
  Object.assign(response.checks[0], { verdict: 'insufficient', explanation: '宏观原文尚未说明受限区域的准入责任。', revisionAdvice: '补明实际准入前置。' });
  const planner = new JsonDesignPlanner({ complete: async call => {
    const sent = JSON.parse(call.user);
    assert.deepEqual(sent.planningHorizon, prepared.planningHorizon);
    assert.deepEqual(sent.planningHorizon.undetailedChapterRanges, [{ startChapter: 51, endChapter: 100 }]);
    assert.deepEqual(sent.sources, prepared.sources);
    assert.match(call.system, /宏观原文本身确缺必要前置或存在冲突仍须明确指出/);
    return JSON.stringify(response);
  } });
  const result = await planner.reviewDesignContent(request);
  assert.equal(result.checks[0].verdict, 'insufficient');
  assert.deepEqual(result.checks[0].evidence, prepared.resolve(response).checks[0].evidence);
  assert.deepEqual(request, before);
});

test('invented anchors receive one repair attempt then fail closed', async () => {
  const request = await input();
  let calls = 0;
  const result = anchored(request);
  result.checks[0].evidence[0].fragmentId = 'invented';
  const planner = new JsonDesignPlanner({ complete: async (call) => {
    calls += 1;
    if (calls === 2) {
      const repair = JSON.parse(call.user);
      assert.match(repair.problems, /不属于本次材料/);
      assert.match(repair.problems, /invented/);
      assert.match(repair.instruction, /只返回 fragmentId/);
    }
    return JSON.stringify(result);
  } });
  await assert.rejects(() => planner.reviewDesignContent(request), PlanningParseError);
  assert.equal(calls, 2);
});

test('model transport retains a complete 21-chapter deferral without a format-repair call', async () => {
  const request = await input();
  const unread = Array.from({ length: 21 }, (_, i) => `plan/chapters/${30 + i}`);
  request.stage = { kind: 'batch', label: '航路连续性', totalBatches: 3,
    sourceMap: request.sources.map(s => ({ id: s.id, sourceId: s.id, start: 0, end: s.text.length })),
    coverage: { mode: 'local_sources', sourceLengths: { ...Object.fromEntries(request.sources.map(s => [s.id, s.text.length])), ...Object.fromEntries(unread.map(id => [id, 100])) } } };
  const response = anchored(request);
  Object.assign(response.checks[1], { verdict: 'insufficient', explanation: '需同读30至50章的付款与连续余量。', revisionAdvice: '补读全部连续章纲。', awaitingSources: unread });
  let calls = 0;
  const planner = new JsonDesignPlanner({ complete: async call => {
    calls++;
    assert.match(call.system, /最多64项/);
    assert.match(call.system, /必须列全该具体问题所必需的未读来源/);
    return JSON.stringify(response);
  } });
  const result = await planner.reviewDesignContent(request);
  assert.equal(calls, 1);
  assert.deepEqual(result.checks[1].awaitingSources, unread);
  assert.equal(result.checks[1].verdict, 'insufficient');
  validateDesignReview(request, result);
});

test('invented future chapter deferrals are repaired from the real inventory without manufacturing outlines', async () => {
  const request = await input();
  const unread = 'plan/milestones/convoy';
  request.stage = { kind: 'batch', label: '局部材料', totalBatches: 2,
    sourceMap: request.sources.map(s => ({ id: s.id, sourceId: s.id, start: 0, end: s.text.length })),
    coverage: { mode: 'local_sources', sourceLengths: { ...Object.fromEntries(request.sources.map(s => [s.id, s.text.length])), [unread]: 100 } } };
  const invalid = anchored(request);
  Object.assign(invalid.checks[1], { verdict: 'insufficient', explanation: '需要核验后期押运安排', revisionAdvice: '补读押运宏观安排', awaitingSources: ['plan/chapters/88'] });
  const repaired = structuredClone(invalid);
  Object.assign(repaired.checks[1], { awaitingSources: [unread] });
  const before = structuredClone(request);
  let calls = 0;
  const planner = new JsonDesignPlanner({ complete: async call => {
    if (++calls === 1) return JSON.stringify(invalid);
    const repair = JSON.parse(call.user);
    assert.equal(repair.invalidSourceId, 'plan/chapters/88');
    assert.deepEqual(repair.availableSourceIds, Object.keys(request.stage!.coverage!.sourceLengths));
    assert.match(repair.instruction, /不要保留这个错误ID/);
    assert.match(repair.instruction, /没有可补读来源时保留普通insufficient/);
    assert.deepEqual(repair.previousOutput, JSON.stringify(invalid));
    return JSON.stringify(repaired);
  } });
  const result = await planner.reviewDesignContent(request);
  assert.equal(calls, 2);
  assert.equal(result.checks[1].verdict, 'insufficient');
  assert.deepEqual(result.checks[1].awaitingSources, [unread]);
  assert.deepEqual(result.modelResponses, [JSON.stringify(invalid), JSON.stringify(repaired)]);
  assert.deepEqual(request, before);
  assert.equal(request.sources.some(s => s.id === 'plan/chapters/88'), false);
  const unrepaired = new JsonDesignPlanner({ complete: async () => JSON.stringify(invalid) });
  await assert.rejects(() => unrepaired.reviewDesignContent(request), /等待补读来源不在完整目录中/);
});

test('one repair receives every invalid anchor and can explicitly select current evidence', async () => {
  const request = await input();
  const expected = anchored(request);
  const invalid = structuredClone(expected);
  invalid.checks[0].evidence[0].fragmentId = 'invented_a';
  invalid.checks[1].evidence[0].fragmentId = 'invented_b';
  let calls = 0;
  const planner = new JsonDesignPlanner({ complete: async (call) => {
    calls += 1;
    if (calls === 1) return JSON.stringify(invalid);
    const repair = JSON.parse(call.user);
    assert.equal(call.role, 'reviewing');
    assert.match(repair.problems, /invented_a/);
    assert.match(repair.problems, /invented_b/);
    assert.deepEqual(repair.originalRequest.sources, prepareDesignReviewEvidence(request).sources);
    return JSON.stringify(expected);
  } });
  assert.deepEqual(await planner.reviewDesignContent(request), { ...prepareDesignReviewEvidence(request).resolve(expected), modelResponses: [JSON.stringify(invalid), JSON.stringify(expected)] });
  assert.equal(calls, 2);
  assert.equal(invalid.checks[0].evidence[0].fragmentId, 'invented_a');
});

test('anchors bind content, source identity and version, including when callers reuse a hash', async () => {
  const request = await input();
  const response = anchored(request);
  for (const change of [
    (next: typeof request) => { next.scope.storyBibleRevision += 1; },
    (next: typeof request) => { next.inputHash = 'different'; },
    (next: typeof request) => { next.sources[0].text += '新设定'; },
    (next: typeof request) => { next.sources[0].id = 'different/source'; },
    (next: typeof request) => { next.stage = { kind: 'batch', label: '局部', totalBatches: 2, sourceMap: [], coverage: { mode: 'local_sources', sourceLengths: { elsewhere: 20 } } }; },
  ]) {
    const next = structuredClone(request);
    change(next);
    assert.throws(() => prepareDesignReviewEvidence(next).resolve(response), /不属于本次材料/);
  }
});

test('short fragment IDs are unique within a request and cannot authorize a response from other materials', async () => {
  const request = await input();
  request.sources.push({ id: 'many/fragments', text: '复杂设定原文\n'.repeat(3000) });
  const prepared = prepareDesignReviewEvidence(request);
  const ids = prepared.sources.flatMap(source => source.fragments.map(fragment => fragment.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ids.map((_, i) => `e${i + 1}`));
  const response = anchored(request);
  const changed = structuredClone(request);
  changed.sources[0].text = '同一位置已经换成完全不同的规则。';
  const next = prepareDesignReviewEvidence(changed);
  assert.equal(next.sources[0].fragments[0].id, prepared.sources[0].fragments[0].id);
  assert.notEqual(next.requestId, prepared.requestId);
  assert.throws(() => next.resolve(response), /请求编号不属于本次材料/);
  const missingRequest = { ...response, requestId: undefined };
  assert.throws(() => prepared.resolve(missingRequest));
  assert.equal(Object.hasOwn(prepared.resolve(response), 'requestId'), false, 'stored reports use exact source quotations, not transport IDs');
});

test('wrong request binding requires a fresh model selection, with the original output preserved', async () => {
  const request = await input();
  const expected = anchored(request);
  const invalid = { ...structuredClone(expected), requestId: 'review_from_another_request' };
  let calls = 0;
  const planner = new JsonDesignPlanner({ complete: async call => {
    if (++calls === 1) return JSON.stringify(invalid);
    const repair = JSON.parse(call.user);
    assert.match(repair.problems, /请求编号不属于本次材料/);
    assert.equal(repair.originalRequest.requestId, expected.requestId);
    assert.match(repair.instruction, /不能只改 requestId/);
    return JSON.stringify(expected);
  } });
  const result = await planner.reviewDesignContent(request);
  assert.equal(calls, 2);
  assert.deepEqual(result.modelResponses, [JSON.stringify(invalid), JSON.stringify(expected)]);
  assert.deepEqual(result.checks, prepareDesignReviewEvidence(request).resolve(expected).checks);
});

test('fragments preserve all text including escapes, long lines, Unicode and trailing delimiters', async () => {
  const request = await input();
  const original = '第一行："原句\\n不是换行"\n' + '😀法则'.repeat(1100) + '\n}\n';
  request.sources[0].text = original;
  const prepared = prepareDesignReviewEvidence(request);
  assert.equal(prepared.sources[0].fragments.map((p) => p.text).join(''), original);
  assert.ok(prepared.sources[0].fragments.every((p) => p.text.length <= 3000 && p.text.isWellFormed()));
  const response = anchored(request);
  response.checks[0].evidence = prepared.sources[0].fragments.map((p) => ({ fragmentId: p.id }));
  // Later mutation cannot change the material against which this request is resolved.
  request.sources[0].text = '已经被修改的材料';
  const result = prepared.resolve(response);
  assert.equal(result.checks[0].evidence.map((p) => p.quote).join(''), original);
});

test('valid IDs cannot bypass missing criteria, evidence, advice or inject alternate quotes', async () => {
  const request = await input();
  const prepared = prepareDesignReviewEvidence(request);
  const good = anchored(request);
  const missingCriterion = structuredClone(good); missingCriterion.checks.pop();
  assert.throws(() => prepared.resolve(missingCriterion), /全部标准/);
  const missingEvidence = structuredClone(good); missingEvidence.checks[0].evidence = [];
  assert.throws(() => prepared.resolve(missingEvidence), /原文证据/);
  const missingAdvice = structuredClone(good); missingAdvice.checks[0].verdict = 'revise'; missingAdvice.checks[0].revisionAdvice = '';
  assert.throws(() => prepared.resolve(missingAdvice), /返修要求/);
  const injected = structuredClone(good);
  Object.assign(injected.checks[0].evidence[0], { sourceId: 'other', quote: '伪造的引文' });
  assert.throws(() => prepared.resolve(injected));
  request.sources.push(request.sources[0]);
  assert.throws(() => prepareDesignReviewEvidence(request), /来源 ID 重复/);
});

test('stored quotation validation still rejects wrong sources and ambiguous suggestions', async () => {
  const request = await input();
  request.sources.push({ id: 'shared/a', text: '共同的连续引文' }, { id: 'shared/b', text: '共同的连续引文' });
  const result = fixtureDesignReview(request);
  result.checks[0].evidence = [{ sourceId: 'shared/missing', quote: '共同的连续引文' }, { sourceId: 'shared/a', quote: '共同' }];
  assert.throws(() => validateDesignReview(request, result), (error: unknown) => {
    assert.ok(error instanceof DesignReviewCitationError);
    assert.equal(error.citationProblems.length, 2);
    assert.deepEqual(error.citationProblems[0].matchingSourceIds, ['shared/a', 'shared/b']);
    assert.deepEqual(error.citationProblems[1].matchingSourceIds, []);
    return true;
  });
  assert.equal(result.checks[0].evidence[0].sourceId, 'shared/missing');
});

test('follow-up repair identifies the omitted original source without copying every fragment', async () => {
  const request = await input();
  request.rubric = { timeline: '寄出与送达是否相容' };
  request.sources = [
    { id: 'unit/a', text: '第9日寄出，本地递交人留有寄据。' },
    { id: 'unit/b', text: '第10日收信者还不知道信中内容。' },
    { id: 'unit/arrival', text: '第12日才由驿使实际送达收信者。' },
    { id: 'question', text: '需要核验收信人的知情是否早于实际送达。' },
  ];
  request.stage = { kind: 'cross', label: '补读', totalBatches: 3, followupFor: 'batch-1/timeline',
    sourceMap: request.sources.slice(0, 3).map((s, i) => ({ id: s.id, sourceId: ['original/sender', 'original/recipient', 'arrival'][i], start: 0, end: s.text.length })),
    coverage: { mode: 'local_sources', sourceLengths: {}, pendingChecks: [{ id: 'batch-1/timeline', criterion: 'timeline', questionSourceId: 'question', requiredSourceIds: ['arrival'], priorUnitIds: ['unit/a', 'unit/b'], priorSourceIds: ['original/sender', 'original/recipient'] }] },
  };
  const prepared = prepareDesignReviewEvidence(request);
  const good = { requestId: prepared.requestId, summary: '送达前没有预支知情', checks: [{ criterion: 'timeline', verdict: 'pass', explanation: '第10日未知，第12日实际送达，两个时点相容', revisionAdvice: '', resolves: ['batch-1/timeline'], evidence: prepared.sources.map(s => ({ fragmentId: s.fragments[0].id })) }] };
  assert.deepEqual(prepared.sources[1].origin, { sourceId: 'original/recipient', start: 0, end: request.sources[1].text.length });
  assert.deepEqual(prepared.citationRequirements!.sources.find(s => s.sourceId === 'original/recipient')!.units,
    [{ id: 'unit/b', fragmentIds: [prepared.sources[1].fragments[0].id] }]);
  assert.equal(prepared.citationRequirements!.sources.length, 4);
  const first = structuredClone(good);
  first.checks[0].evidence.splice(1, 1);
  let calls = 0;
  const planner = new JsonDesignPlanner({ complete: async call => {
    assert.match(call.system, /evidence最多64个/);
    if (++calls === 1) {
      assert.deepEqual(JSON.parse(call.user).citationRequirements, prepared.citationRequirements);
      return JSON.stringify(first);
    }
    const repair = JSON.parse(call.user);
    assert.match(repair.problems, /缺少来源：original\/recipient/);
    assert.match(repair.problems, /不需穷举其全部片段/);
    assert.deepEqual(repair.previousOutput, JSON.stringify(first));
    assert.deepEqual(repair.originalRequest.sources, prepared.sources);
    return JSON.stringify(good);
  } });
  const result = await planner.reviewDesignContent(request);
  assert.equal(calls, 2);
  assert.equal(result.checks[0].evidence.length, 4);
  assert.deepEqual(result.modelResponses, [JSON.stringify(first), JSON.stringify(good)]);
  assert.deepEqual(result.checks[0].resolves, ['batch-1/timeline']);
});

test('cross checks index every pending question and name a missing required source during repair', async () => {
  const request = await input();
  request.rubric = { timeline: '两次递送均须收到后才知情' };
  request.sources = [
    { id: 'old-a', text: '甲信第1日寄出，第2日尚未收到。' },
    { id: 'old-b', text: '乙信第3日寄出，第4日尚未收到。' },
    { id: 'late-a', text: '甲信第3日实际交收，之后才被阅知。' },
    { id: 'late-b', text: '乙信第5日实际交收，之后才被阅知。' },
    { id: 'question-a', text: '甲信是否在实际送达之前就被收信者知道？' },
    { id: 'question-b', text: '乙信是否在实际送达之前就被收信者知道？' },
  ];
  request.stage = { kind: 'cross', label: '跨批原文', totalBatches: 3,
    sourceMap: request.sources.slice(0, 4).map((s, i) => ({ id: s.id, sourceId: ['letters/a', 'letters/b', 'arrival/a', 'arrival/b'][i], start: 0, end: s.text.length })),
    coverage: { mode: 'local_sources', sourceLengths: {}, pendingChecks: [
      { id: 'batch-1/timeline', criterion: 'timeline', questionSourceId: 'question-a', requiredSourceIds: ['arrival/a'], priorUnitIds: ['old-a', 'old-b'] },
      { id: 'batch-2/timeline', criterion: 'timeline', questionSourceId: 'question-b', requiredSourceIds: ['arrival/b'], priorUnitIds: ['old-b'] },
    ] },
  };
  const prepared = prepareDesignReviewEvidence(request);
  assert.equal(prepared.citationRequirements, undefined);
  assert.deepEqual(prepared.pendingCitationRequirements!.map(r => r.requiredSources.map(s => s.sourceId)), [['question-a', 'arrival/a'], ['question-b', 'arrival/b']]);
  assert.deepEqual(prepared.pendingCitationRequirements![0].oneOfPriorUnits.map(s => s.id), ['old-a', 'old-b']);
  assert.deepEqual(prepared.pendingCitationRequirements![1].requiredSources[1].units, [{ id: 'late-b', fragmentIds: [prepared.sources[3].fragments[0].id] }]);
  const good = { requestId: prepared.requestId, summary: '两信送达后才知情', checks: [{ criterion: 'timeline', verdict: 'pass', explanation: '两个收信时点均在各自交收后', revisionAdvice: '', resolves: ['batch-1/timeline', 'batch-2/timeline'], evidence: prepared.sources.slice(1).map(s => ({ fragmentId: s.fragments[0].id })) }] };
  assert.equal(prepared.resolve(good).checks[0].evidence.length, 5, 'one original unit can support both questions; alternatives do not all become mandatory');
  const missing = structuredClone(good);
  missing.checks[0].evidence = missing.checks[0].evidence.filter(e => e.fragmentId !== prepared.sources[3].fragments[0].id);
  assert.throws(() => prepared.resolve(missing), /新增来源 arrival\/b/);
  let calls = 0;
  const planner = new JsonDesignPlanner({ complete: async call => {
    const sent = JSON.parse(call.user);
    if (++calls === 1) {
      assert.deepEqual(sent.pendingCitationRequirements, prepared.pendingCitationRequirements);
      return JSON.stringify(missing);
    }
    assert.match(sent.problems, /batch-2\/timeline.*新增来源 arrival\/b/);
    assert.deepEqual(sent.originalRequest.pendingCitationRequirements, prepared.pendingCitationRequirements);
    assert.equal(sent.previousOutput, JSON.stringify(missing));
    return JSON.stringify(good);
  } });
  const result = await planner.reviewDesignContent(request);
  assert.equal(calls, 2);
  assert.deepEqual(result.checks[0].resolves, good.checks[0].resolves);
  assert.deepEqual(result.modelResponses, [JSON.stringify(missing), JSON.stringify(good)]);
});

for (const repairedVerdict of ['pass', 'insufficient'] as const) {
  test(`dedicated follow-up cannot finish with a bare pass; repair may return ${repairedVerdict}`, async () => {
    const request = await input();
    request.rubric = { timeline: '实际送达后才能知情' };
    request.sources = [
      { id: 'unit/sender', text: '第9日寄出，第10日接收者还不知道内容。' },
      { id: 'unit/arrival', text: '第12日驿使当面送达，收信人此后才知情。' },
      { id: 'question', text: '原问题是接收者是否在信件送达前已经知情。' },
    ];
    request.stage = { kind: 'cross', label: '补读原问题', totalBatches: 3, followupFor: 'batch-1/timeline',
      sourceMap: request.sources.slice(0, 2).map((s, i) => ({ id: s.id, sourceId: ['sender', 'arrival'][i], start: 0, end: s.text.length })),
      coverage: { mode: 'local_sources', sourceLengths: {}, pendingChecks: [{ id: 'batch-1/timeline', criterion: 'timeline', questionSourceId: 'question', requiredSourceIds: ['arrival'], priorUnitIds: ['unit/sender'], priorSourceIds: ['sender'] }] },
    };
    const prepared = prepareDesignReviewEvidence(request);
    const first = { requestId: prepared.requestId, summary: '本批通过', checks: [{ criterion: 'timeline', verdict: 'pass', explanation: '送达与知情相容', revisionAdvice: '', evidence: prepared.sources.map(s => ({ fragmentId: s.fragments[0].id })) }] };
    assert.throws(() => prepared.resolve(first), /专门补读通过必须显式说明解决原问题/);
    const repaired = { ...first, checks: [{ ...first.checks[0], verdict: repairedVerdict,
      ...(repairedVerdict === 'pass' ? { resolves: ['batch-1/timeline'] } : { explanation: '虽有送达记录，但不能从本批断定角色此前没有别的消息渠道', revisionAdvice: '核验此前全部实际消息来源后再判断' }),
    }] };
    let calls = 0;
    const planner = new JsonDesignPlanner({ complete: async call => {
      if (++calls === 1) return JSON.stringify(first);
      const repair = JSON.parse(call.user);
      assert.match(repair.problems, /batch-1\/timeline/);
      assert.match(repair.problems, /不能仅补上编号/);
      assert.equal(repair.previousOutput, JSON.stringify(first));
      assert.deepEqual(repair.originalRequest.sources, prepared.sources);
      return JSON.stringify(repaired);
    } });
    const result = await planner.reviewDesignContent(request);
    assert.equal(calls, 2);
    assert.equal(result.checks[0].verdict, repairedVerdict);
    assert.deepEqual(result.checks[0].resolves, repairedVerdict === 'pass' ? ['batch-1/timeline'] : undefined);
    assert.deepEqual(result.modelResponses, [JSON.stringify(first), JSON.stringify(repaired)]);
    assert.equal(Object.hasOwn(first.checks[0], 'resolves'), false, 'never mutate the original output into a resolution');
    if (repairedVerdict === 'pass') {
      const withoutQuestion = structuredClone(repaired);
      withoutQuestion.checks[0].evidence.pop();
      assert.throws(() => prepared.resolve(withoutQuestion), /必须引用原问题/);
    }
  });
}

test('v16 uses bounded smaller citation anchors without dropping text or changing legacy fragments', async () => {
  const request = await input();
  request.sources = [{ id: 'long-source', text: '开篇原文。' + '😀人物关系不得凭空变化。'.repeat(400) + '末尾' }];
  const legacy = { ...request, stage: { kind: 'cross' as const, label: '旧任务', totalBatches: 3, sourceMap: [{ id: 'long-source', sourceId: 'original', start: 0, end: request.sources[0].text.length }] } };
  const previous = prepareDesignReviewEvidence(legacy);
  const current = prepareDesignReviewEvidence({ ...legacy, stage: { ...legacy.stage, evidenceLimit: 96 } });
  assert.ok(previous.sources[0].fragments.some(f => f.text.length > 600));
  assert.ok(current.sources[0].fragments.every(f => f.text.length <= 603)); // A tiny tail may merge into its predecessor.
  for (const prepared of [previous, current]) {
    const fragments = prepared.sources[0].fragments;
    assert.equal(fragments.map(f => f.text).join(''), request.sources[0].text);
    assert.ok(fragments.every(f => !/[\uD800-\uDBFF]$/.test(f.text) && !/^[\uDC00-\uDFFF]/.test(f.text)));
  }
  assert.deepEqual(prepareDesignReviewEvidence(JSON.parse(JSON.stringify(legacy))).sources, previous.sources);
  assert.notEqual(current.requestId, previous.requestId);
});
