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
