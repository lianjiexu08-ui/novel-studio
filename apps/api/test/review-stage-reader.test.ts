import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/server.ts';
import { InMemoryWorkRepository, type WorkRepository } from '../../../packages/application/src/index.ts';
import { Work } from '../../../novel-service-core/src/core.ts';
import { createDesignReviewRun, designReviewStageInput } from '../../../novel-service-core/src/design-review-run.ts';

for (const direct of [false, true]) test(`review stage detail preserves the response with ${direct ? 'targeted' : 'aggregate'} reads`, async t => {
  const work = new Work('证据查看', 'work');
  const run = createDesignReviewRun({ area: 'power', inputHash: '1'.repeat(64),
    scope: { worldPackRevision: 1, storyBibleRevision: 2, planRevisionId: 'plan', planRevision: 3 },
    rubric: { costs: '核对代价' }, sources: [{ id: 'rule', text: '寿储不得预支。' }],
  });
  run.status = 'failed'; run.stages[0].attempts = 1;
  run.stages[0].error = '超时'; run.stages[0].failures = [{ at: run.createdAt, error: '超时', modelResponses: ['失败原文'] }];
  work.designReviewRuns.set(run.id, run);
  const repository: WorkRepository = new InMemoryWorkRepository();
  await repository.save(work);
  let reads = 0;
  if (direct) {
    repository.get = async () => { throw new Error('Must not load the full aggregate for stage evidence'); };
    repository.getDesignReviewRun = async (workId, runId) => {
      reads++;
      return workId === work.id && runId === run.id ? structuredClone(run) : undefined;
    };
  }
  const { app } = createApiServer({ repository, authToken: 'test-token',
    provider: { generateChapter: () => { throw new Error('Evidence reads must never invoke a model'); } },
  });
  t.after(() => app.close());
  const root = `/works/${work.id}/design/review-runs/${run.id}/stages`, headers = { authorization: 'Bearer test-token' };
  assert.equal((await app.inject({ method: 'GET', url: `${root}/batch-1` })).statusCode, 401);
  assert.equal(reads, 0, 'authentication must precede a targeted read');
  const response = await app.inject({ method: 'GET', url: `${root}/batch-1`, headers });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), JSON.parse(JSON.stringify({ stage: run.stages[0], input: designReviewStageInput(run, run.stages[0]) })));
  for (const url of [`${root}/missing`, `${root}/batch-1`.replace('/works/work/', '/works/unknown/'), `${root}/batch-1`.replace(run.id, 'missing')]) {
    assert.equal((await app.inject({ method: 'GET', url, headers })).statusCode, 404);
  }
  run.stages[0].attempts = 2;
  assert.equal((await app.inject({ method: 'GET', url: `${root}/batch-1`, headers })).json().stage.attempts, 2);
  assert.equal(work.versions.size, 0);
  assert.equal(work.designContentReviews.size, 0);
  assert.equal(run.status, 'failed');
});
