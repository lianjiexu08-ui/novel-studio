import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/server.ts';
import { ChapterWorkflow, InMemoryWorkRepository } from '../../../packages/application/src/index.ts';
import { createReadyWork, fixtureChapterReview } from '../../../packages/application/test/fixtures.ts';
import { passChecker, emptyUsage } from '../../../novel-service-core/src/core.ts';
import { chapterReviewChecker, restoreChapterReviewRun } from '../../../novel-service-core/src/chapter-review.ts';
import { completeDesignReviewRun } from '../../../novel-service-core/src/design-review-run.ts';
import { OpenAICompatibleChapterProvider } from '../../../packages/planner/src/index.ts';
import { passingStageOutput } from '../../../packages/planner/test/chapter-review-fixture.ts';
import { candidateDtoSchema } from 'novel-studio-contracts';

const policy = { version: 'review-source', required: [chapterReviewChecker] };
const writer = { generateChapter: () => ({ content: '他按住伤口，放弃追击，先将同伴带回城中。', proposedEvents: [], observedEvents: [] }), reviewChapterAsync: fixtureChapterReview };

test('source lookup binds the exact historical check and never substitutes current design', async t => {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, writer, undefined, { checkPolicy: policy });
  const work = await createReadyWork(workflow, '历史原文');
  const candidate = await workflow.generate(work.id, 1, 'first');
  await workflow.check(work.id, candidate.id, [passChecker]);
  const old = candidate.checks.find(check => check.checker === chapterReviewChecker)!;
  const expected = old.chapterReview!.input!.sources.find(source => source.id === 'world')!;
  await repository.transaction(work.id, ({ work }) => { work.worldPack!.summary = '后来修改的世界，不是旧评审原文'; });
  await workflow.check(work.id, candidate.id, [passChecker]);
  const current = candidate.checks.find(check => check.checker === chapterReviewChecker)!;
  const otherCandidate = await workflow.generate(work.id, 1, 'second');
  const { app } = createApiServer({ repository, provider: writer });
  t.after(() => app.close());
  const url = (candidateId: string, checkId: string, sourceId: string) => `/works/${work.id}/candidates/${candidateId}/checks/${checkId}/source?sourceId=${encodeURIComponent(sourceId)}`;
  const before = structuredClone(work);
  const response = await app.inject({ method: 'GET', url: url(candidate.id, old.id!, 'world') });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().source, expected);
  assert.equal(response.json().inputHash, old.chapterReview!.inputHash);
  assert.equal(response.json().kind, 'original');
  const newer = await app.inject({ method: 'GET', url: url(candidate.id, current.id!, 'world') });
  assert.match(newer.json().source.text, /后来修改的世界/);
  for (const endpoint of [url(candidate.id, 'missing', 'world'), url(otherCandidate.id, old.id!, 'world'), url(candidate.id, old.id!, 'nonexistent'), url(candidate.id, old.id!, 'world').replace(work.id, 'missing-work')]) {
    assert.equal((await app.inject({ method: 'GET', url: endpoint })).statusCode, 404);
  }
  const history = (await app.inject({ method: 'GET', url: `/works/${work.id}/state/1?candidateId=${candidate.id}` })).json();
  const dto = candidateDtoSchema.parse(history.quality.candidate);
  assert.ok(dto.checkHistory.find(check => check.id === old.id)?.chapterReview?.inputAvailable);
  assert.equal('input' in history.quality.candidate.checks.find(check => check.id === current.id).chapterReview, false);
  assert.deepEqual(structuredClone(work), before, 'all evidence browsing is read-only');
  delete old.chapterReview!.input;
  const legacy = await app.inject({ method: 'GET', url: url(candidate.id, old.id!, 'world') });
  assert.equal(legacy.statusCode, 404);
  assert.match(legacy.json().error.message, /未保存原材料/);
});

test('staged review citations resolve to their original fragments and intermediate reports', async t => {
  const repository = new InMemoryWorkRepository();
  const reviewer = new OpenAICompatibleChapterProvider('', '', '', 10, 5000, true, { completeWithUsage: async request => ({
    text: passingStageOutput(request), usage: { ...emptyUsage(), calls: 1 },
  }) });
  const provider = { ...writer, reviewChapterAsync: reviewer.reviewChapterAsync.bind(reviewer) };
  const workflow = new ChapterWorkflow(repository, provider, undefined, { checkPolicy: policy });
  const work = await createReadyWork(workflow, '分批所审材料');
  work.worldPack!.summary = '需要保留的完整世界原文。'.repeat(36_000);
  const candidate = await workflow.generate(work.id, 1, 'staged');
  await workflow.check(work.id, candidate.id, [passChecker]);
  const check = candidate.checks.find(item => item.checker === chapterReviewChecker)!;
  assert.equal(check.status, 'passed', check.message);
  const record = check.chapterReview!;
  const run = restoreChapterReviewRun(record.input!, record.result!.stageProof);
  const sources = completeDesignReviewRun(run).input.sources;
  const unit = run.units.find(item => item.sourceId === 'world')!;
  const report = sources.find(item => item.id.startsWith('review-result/'))!;
  assert.ok(report);
  const { app } = createApiServer({ repository, provider }); t.after(() => app.close());
  for (const sourceId of [unit.id, report.id]) {
    const response = await app.inject({ method: 'GET', url: `/works/${work.id}/candidates/${candidate.id}/checks/${check.id}/source?sourceId=${encodeURIComponent(sourceId)}` });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().source, sources.find(item => item.id === sourceId));
    assert.equal(response.json().kind, sourceId === unit.id ? 'original' : 'review_result');
    if (sourceId === unit.id) assert.deepEqual(response.json().original, { sourceId: 'world', start: unit.start, end: unit.end });
  }
});
