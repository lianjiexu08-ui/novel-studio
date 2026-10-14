import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/server.ts';
import { ChapterWorkflow, InMemoryWorkRepository } from '../../../packages/application/src/index.ts';
import { createReadyWork } from '../../../packages/application/test/fixtures.ts';
const provider = { generateChapter: () => { throw new Error('No model calls expected'); } };

test('whole-design API rejects raw unknown content, exports a baseline, and saves once with stale conflicts', async t => {
  const repository = new InMemoryWorkRepository(), workflow = new ChapterWorkflow(repository, provider);
  const work = await createReadyWork(workflow, '整体编辑接口');
  const { app } = createApiServer({ repository, provider }); t.after(() => app.close());
  const url = `/works/${work.id}/design/candidate`;
  const read = await app.inject({ method: 'GET', url }); assert.equal(read.statusCode, 200);
  const body = read.json(), malformed = structuredClone(body), before = structuredClone(work);
  malformed.candidate.plan.unrecognized = '不能删除';
  const invalid = await app.inject({ method: 'PUT', url, payload: malformed });
  assert.equal(invalid.statusCode, 400, invalid.body);
  assert.equal(invalid.json().error.code, 'VALIDATION_FAILED');
  assert.deepEqual(structuredClone(work), before);
  // A long novel's combined design can exceed Fastify's default 1 MiB.
  body.candidate.worldPack.summary += '完整设定不得截断。'.repeat(50_000);
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 1024 * 1024);
  const saved = await app.inject({ method: 'PUT', url, payload: body });
  assert.equal(saved.statusCode, 201, saved.body);
  assert.equal(saved.json().storyBible.worldPackRevision, saved.json().worldPack.revision);
  assert.equal(saved.json().plan.status, 'proposed');
  assert.equal(saved.json().worldPack.summary, body.candidate.worldPack.summary);
  assert.equal(saved.json().contentReview.ready, false);
  assert.equal((await app.inject({ method: 'PUT', url, payload: body })).statusCode, 409);
  assert.equal((await app.inject({ method: 'GET', url: '/works/missing-work/design/candidate' })).statusCode, 404);
});
