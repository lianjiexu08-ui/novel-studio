import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonDesignPlanner, PlanningParseError } from '../src/index.ts';
import { DesignReviewCitationError, designReviewInput, validateDesignReview } from '../../../novel-service-core/src/design-review.ts';
import { ChapterWorkflow, InMemoryWorkRepository } from '../../application/src/index.ts';
import { createReadyWork, fixtureDesignReview } from '../../application/test/fixtures.ts';

async function input() {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), { generateChapter: () => ({ content: '', proposedEvents: [] }) });
  return designReviewInput(await createReadyWork(workflow), 'power');
}

test('content reviewer uses the reviewing role and one area with exact sources', async () => {
  const request = await input();
  const planner = new JsonDesignPlanner({ complete: async (call) => {
    assert.equal(call.role, 'reviewing');
    assert.equal(call.maxOutputTokens, 8000);
    assert.match(call.system, /100章可以是百万字项目的阶段验收/);
    const body = JSON.parse(call.user);
    assert.equal(body.area, 'power');
    assert.deepEqual(body.sources, request.sources);
    assert.deepEqual(body.rubric, request.rubric);
    return JSON.stringify(fixtureDesignReview(request));
  } });
  assert.deepEqual(await planner.reviewDesignContent(request), fixtureDesignReview(request));
});

test('fabricated citations receive one repair attempt then fail closed', async () => {
  const request = await input();
  let calls = 0;
  const result = fixtureDesignReview(request);
  result.checks[0].evidence[0].quote = '源材料里没有的引文';
  const planner = new JsonDesignPlanner({ complete: async (call) => {
    calls += 1;
    if (calls === 2) {
      const repair = JSON.parse(call.user);
      assert.match(repair.problems, /引用不在原文/);
      assert.equal(repair.citationProblem.rejectedQuote, '源材料里没有的引文');
      assert.equal(repair.citationProblem.criterion, result.checks[0].criterion);
      assert.equal(repair.citationProblem.evidenceIndex, 0);
      assert.equal(repair.citationProblem.sourceText, request.sources.find((source) => source.id === result.checks[0].evidence[0].sourceId)!.text);
    }
    return JSON.stringify(result);
  } });
  await assert.rejects(() => planner.reviewDesignContent(request), PlanningParseError);
  assert.equal(calls, 2);
});

test('citation repair can replace a paraphrase with a verified continuous source quote', async () => {
  const request = await input();
  const expected = fixtureDesignReview(request);
  const invalid = structuredClone(expected);
  invalid.checks[0].evidence[0].quote = '把原文概括成另一句话';
  let calls = 0;
  const planner = new JsonDesignPlanner({ complete: async (call) => {
    calls += 1;
    if (calls === 1) return JSON.stringify(invalid);
    const repair = JSON.parse(call.user);
    assert.equal(call.role, 'reviewing');
    assert.match(repair.instruction, /重新核对全部引文/);
    assert.ok(repair.citationProblem.sourceText.includes(expected.checks[0].evidence[0].quote));
    assert.deepEqual(repair.originalRequest.sources, request.sources);
    return JSON.stringify(expected);
  } });
  assert.deepEqual(await planner.reviewDesignContent(request), expected);
  assert.equal(calls, 2);
});

test('one repair receives every invalid citation across criteria and exact source matches', async () => {
  const request = await input();
  const expected = fixtureDesignReview(request);
  const invalid = structuredClone(expected);
  invalid.checks[0].evidence[0].sourceId = 'invented/chapter-object-id';
  invalid.checks[1].evidence[0].quote = '这是不存在于任何来源的概括而非引文';
  let calls = 0;
  const planner = new JsonDesignPlanner({ complete: async (call) => {
    calls += 1;
    if (calls === 1) return JSON.stringify(invalid);
    const repair = JSON.parse(call.user);
    assert.equal(repair.citationProblems.length, 2);
    assert.equal(repair.citationProblems[0].criterion, expected.checks[0].criterion);
    assert.equal(repair.citationProblems[0].sourceText, undefined);
    assert.ok(repair.citationProblems[0].matchingSourceIds.includes(expected.checks[0].evidence[0].sourceId));
    assert.equal(repair.citationProblems[1].criterion, expected.checks[1].criterion);
    assert.deepEqual(repair.citationProblems[1].matchingSourceIds, []);
    assert.deepEqual(repair.citationProblem, repair.citationProblems[0]);
    return JSON.stringify(expected);
  } });
  assert.deepEqual(await planner.reviewDesignContent(request), expected);
  assert.equal(calls, 2);
  assert.equal(invalid.checks[0].evidence[0].sourceId, 'invented/chapter-object-id');
});

test('matching source suggestions never accept a wrong source or ambiguous quotation', async () => {
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
