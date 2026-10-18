import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApiServer } from '../src/server.ts';
import { ChapterWorkflow } from '../../../packages/application/src/index.ts';
import { JsonWorkRepository } from '../../../packages/persistence/src/json-repository.ts';
import { createReadyWork, fixtureDesignReview } from '../../../packages/application/test/fixtures.ts';
import { annotationWriter } from '../../../packages/application/test/review-annotation-fixture.ts';
import { designReviewCheckHash } from '../../../novel-service-core/src/design-review-annotations.ts';
import { designReviewStageInput } from '../../../novel-service-core/src/design-review-run.ts';
import type { DesignReviewInput } from '../../../novel-service-core/src/design-review.ts';

// Public API + ordinary worker failure/reconnect path. The temporary JSON
// repository is retained so a failed assertion remains inspectable.
test('queued formal reconsideration survives reconnect and failure, is idempotent and never changes design', async t => {
  const file = join(mkdtempSync(join(tmpdir(), 'novel-formal-recheck-')), 'state.json');
  let repository = new JsonWorkRepository(file), fail = true;
  const provider = {
    generateWorldPack: async () => { throw Error('unused'); }, generateStoryBible: async () => { throw Error('unused'); },
    reviewDesignContent: async (input: DesignReviewInput) => {
      const result = fixtureDesignReview(input);
      if (!input.stage?.reconsiderationFor) {
        result.checks[0] = { ...result.checks[0], verdict: 'revise', explanation: '误称规则没有代价。', revisionAdvice: '请补全代价。' };
      } else {
        if (fail) throw Object.assign(new Error('模型连接临时失败'), { modelResponses: ['保存失败回答，不覆盖历史'] });
        const pending = input.stage.coverage!.pendingChecks![0];
        result.checks[0].resolves = [pending.id];
        const ids = [pending.questionSourceId, ...new Set([...pending.priorSourceIds!, ...pending.requiredSourceIds].map(id => input.stage!.sourceMap.find(unit => unit.sourceId === id)!.id))];
        result.checks[0].evidence = ids.map(id => ({ sourceId: id, quote: input.sources.find(source => source.id === id)!.text.slice(0, 40) }));
        result.modelResponses = ['正式复核完整回答'];
      }
      return result;
    },
  };
  const workflow = new ChapterWorkflow(repository, annotationWriter, provider);
  const work = await createReadyWork(workflow, '正式复核恢复测试');
  await repository.transaction(work.id, ({ work }) => {
    for (const chapter of work.plans.get(work.activePlanId!)!.plan.chapters.slice(0, 4)) chapter.summary += '有偿检查不可免费施术。'.repeat(7000);
  });
  let run = await workflow.startDesignReview(work.id, 'power');
  run = await workflow.stepDesignReview(work.id, run.id);
  const original = run.stages[0], beforeRequest = designReviewStageInput(run, original);
  const note = await workflow.addDesignReviewAnnotation(work.id, { requestKey: 'recheck', runId: run.id, stageId: original.id, criterion: original.result!.checks[0].criterion,
    expectedInputHash: run.input.inputHash, expectedCheckHash: designReviewCheckHash(original.result!.checks[0]), claimQuote: '误称规则没有代价', explanation: '完整原文包含明确代价。', evidence: [{ sourceId: 'world/axioms/axiom', quote: '力量必须支付代价' }] });
  const before = (await repository.get(work.id))!;
  let app = createApiServer({ repository, provider: annotationWriter, designProvider: provider }).app;
  t.after(() => app.close());
  const url = `/works/${work.id}/design/review-runs/${run.id}/reconsider`, payload = { annotationId: note.id, expectedInputHash: run.input.inputHash };
  assert.equal((await app.inject({ method: 'POST', url, payload: { ...payload, verdict: 'pass' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url, payload: { ...payload, expectedInputHash: '0'.repeat(64) } })).statusCode, 409);
  const queued = await app.inject({ method: 'POST', url, payload }); assert.equal(queued.statusCode, 200, queued.body);
  const revision = (await repository.get(work.id))!.constraintRevision;
  assert.deepEqual((await app.inject({ method: 'POST', url, payload })).json(), queued.json());
  assert.equal((await repository.get(work.id))!.constraintRevision, revision);
  await app.close();
  repository = new JsonWorkRepository(file);
  app = createApiServer({ repository, provider: annotationWriter, designProvider: provider }).app;
  const stageId = queued.json().stageId;
  const detail = await app.inject({ method: 'GET', url: `/works/${work.id}/design/review-runs/${run.id}/stages/${stageId}` });
  assert.equal(detail.statusCode, 200, detail.body); assert.equal(detail.json().input.stage.reconsiderationFor, `${original.id}/${note.criterion}`);
  const step = `/works/${work.id}/design/review-runs/${run.id}/step`;
  assert.equal((await app.inject({ method: 'POST', url: step })).statusCode, 500);
  const afterFailure = (await repository.get(work.id))!.designReviewRuns.get(run.id)!;
  assert.equal(afterFailure.status, 'failed'); assert.equal(afterFailure.leaseToken, undefined);
  assert.equal(afterFailure.stages[1].failures!.length, 1);
  assert.deepEqual(afterFailure.stages[1].failures![0].modelResponses, ['保存失败回答，不覆盖历史']);
  fail = false;
  assert.equal((await app.inject({ method: 'POST', url: step })).statusCode, 200);
  const after = (await new JsonWorkRepository(file).get(work.id))!, completed = after.designReviewRuns.get(run.id)!;
  assert.equal(completed.stages[1].attempts, 2); assert.equal(completed.stages[1].failures!.length, 1);
  assert.deepEqual(completed.stages[1].result!.checks[0].resolves, [`${original.id}/${note.criterion}`]);
  assert.deepEqual(completed.stages[0], JSON.parse(JSON.stringify(original)));
  assert.deepEqual(designReviewStageInput(completed, completed.stages[0]), beforeRequest);
  assert.equal(completed.status, 'ready'); assert.equal(completed.reportId, undefined);
  const listed = (await app.inject({ method: 'GET', url: `/works/${work.id}/design/review-annotations?runId=${run.id}` })).json();
  assert.equal(listed.reconsiderations[0].resolved, true);
  for (const key of Object.keys(before) as Array<keyof typeof before>) {
    if (key !== 'designReviewRuns' && key !== 'constraintRevision') assert.equal(JSON.stringify(after[key], (_, value) => value instanceof Map ? [...value] : value), JSON.stringify(before[key], (_, value) => value instanceof Map ? [...value] : value), key);
  }
});
