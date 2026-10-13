import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonDesignPlanner, PlanningParseError } from '../src/index.ts';
import { designReviewInput } from '../../../novel-service-core/src/design-review.ts';
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
