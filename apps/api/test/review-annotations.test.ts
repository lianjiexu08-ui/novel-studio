import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/server.ts';
import { InMemoryWorkRepository } from '../../../packages/application/src/index.ts';
import { annotationFixture, annotationWriter } from '../../../packages/application/test/review-annotation-fixture.ts';
import { designReviewHash, designReviewOverview } from '../../../novel-service-core/src/design-review.ts';
import { designReviewAnnotationSchema } from 'novel-studio-contracts';

// Exercise the public boundary as well as append-only semantics and writing gates.
test('annotations retain exact original evidence without modifying verdicts, design or gates', async t => {
  const repository = new InMemoryWorkRepository();
  const { workflow, workId, run, input } = await annotationFixture(repository);
  const { app } = createApiServer({ repository, provider: annotationWriter });
  t.after(() => app.close());
  const path = `/works/${workId}/design/review-annotations`;
  const post = (payload: unknown) => app.inject({ method: 'POST', url: path, payload });
  const work = (await repository.get(workId))!;
  const before = structuredClone(work), beforeHash = designReviewHash(work), beforeGate = designReviewOverview(work);
  assert.equal(beforeGate.ready, false);
  const response = await post(input);
  assert.equal(response.statusCode, 201, response.body);
  const note = designReviewAnnotationSchema.parse(response.json().annotation);
  assert.deepEqual(note.scope, run.input.scope);
  assert.deepEqual((await post(input)).json().annotation, note, 'retries do not create duplicates');
  assert.equal((await post({ ...input, explanation: '不同的说明不能覆盖旧记录' })).statusCode, 409);
  const after = structuredClone(await repository.get(workId));
  after!.designReviewAnnotations.clear();
  assert.deepEqual(after, before);
  assert.equal(designReviewHash(work), beforeHash);
  assert.deepEqual(designReviewOverview(work), beforeGate);

  for (const patch of [
    { runId: 'missing' }, { stageId: 'missing' }, { criterion: 'missing' },
    { expectedInputHash: '0'.repeat(64) }, { expectedCheckHash: '0'.repeat(64) },
    { claimQuote: '评审没有说过的话' },
    { evidence: [{ sourceId: 'missing', quote: '力量必须支付代价' }] },
    { evidence: [{ sourceId: input.evidence[0].sourceId, quote: '伪造的原文引述' }] },
  ]) {
    assert.equal((await post({ ...input, requestKey: 'invalid', ...patch })).statusCode, 409, JSON.stringify(patch));
  }
  for (const patch of [{ verdict: 'pass' }, { scope: run.input.scope }, { evidence: [] }, { explanation: '  ' }, { evidence: [{ ...input.evidence[0], override: true }] }]) {
    assert.equal((await post({ ...input, ...patch })).statusCode, 400);
  }
  assert.equal(work.designReviewAnnotations.size, 1);

  await repository.transaction(workId, ({ work }) => { work.worldPack!.axioms[0].content = '后来修改过的规则'; });
  const second = await post({ ...input, requestKey: 'historical-note' });
  assert.equal(second.statusCode, 201, second.body);
  const detail = await app.inject({ method: 'GET', url: `${path}/${note.id}` });
  assert.equal(detail.statusCode, 200);
  assert.deepEqual(detail.json().sources, run.input.sources.filter(source => source.id === input.evidence[0].sourceId));
  assert.equal((await app.inject({ method: 'GET', url: `${path}?runId=${run.id}&stageId=${input.stageId}` })).json().annotations.length, 2);
  const other = await workflow.createWork('其他作品');
  for (const url of [`${path}/${note.id}`.replace(workId, other.id), `${path}?runId=${run.id}`.replace(workId, other.id), `${path}?runId=${run.id}&stageId=missing`, `${path}/missing`]) {
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 404);
  }
  assert.equal((await app.inject({ method: 'POST', url: path.replace(workId, other.id), payload: input })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: path.replace(workId, 'missing'), payload: input })).statusCode, 404);
  assert.deepEqual(work.designReviewRuns.get(run.id), run, 'original model record remains intact after historical annotation');
});

test('advice annotations bind the exact advice field while legacy notes keep explanation semantics', async t => {
  const repository = new InMemoryWorkRepository();
  const { workId, input, run } = await annotationFixture(repository);
  const { app } = createApiServer({ repository, provider: annotationWriter });
  t.after(() => app.close());
  const path = `/works/${workId}/design/review-annotations`;
  const post = (payload: unknown) => app.inject({ method: 'POST', url: path, payload });
  const before = structuredClone((await repository.get(workId))!);
  const legacyResponse = await post(input);
  assert.equal(legacyResponse.statusCode, 201);
  assert.equal(Object.hasOwn(legacyResponse.json().annotation, 'claimField'), false, 'do not rewrite legacy note bytes with a default field');
  const advice = { ...input, requestKey: 'advice-1', claimField: 'revisionAdvice', claimQuote: '补充力量代价。',
    explanation: '原文已有具体代价，应先核对实际规则，不能因错误建议重复增设。' };
  const response = await post(advice);
  assert.equal(response.statusCode, 201, response.body);
  const note = designReviewAnnotationSchema.parse(response.json().annotation);
  assert.equal(note.claimField, 'revisionAdvice');
  assert.deepEqual((await post(advice)).json().annotation, note);
  for (const payload of [
    { ...advice, requestKey: 'default-target', claimField: undefined },
    { ...advice, requestKey: 'wrong-target', claimField: 'explanation' },
    { ...advice, requestKey: 'wrong-quote', claimQuote: input.claimQuote },
    { ...advice, requestKey: 'stale-check', expectedCheckHash: '0'.repeat(64) },
    { ...advice, claimField: 'explanation', claimQuote: input.claimQuote },
  ]) assert.equal((await post(payload)).statusCode, 409);
  assert.equal((await post({ ...advice, requestKey: 'unknown-field', claimField: 'verdict' })).statusCode, 400);
  const detail = await app.inject({ method: 'GET', url: `${path}/${note.id}` });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().annotation.claimField, 'revisionAdvice');
  assert.deepEqual(detail.json().sources, run.input.sources.filter(s => s.id === input.evidence[0].sourceId));
  const after = structuredClone((await repository.get(workId))!);
  assert.equal(after.designReviewAnnotations.size, 2);
  after.designReviewAnnotations.clear();
  assert.deepEqual(after, before, 'annotations never edit advice, verdict, design, histories or writing gates');
});
