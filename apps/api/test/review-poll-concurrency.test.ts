import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createApiServer } from '../src/server.ts';
import { ChapterWorkflow, InMemoryWorkRepository } from '../../../packages/application/src/index.ts';
import { createReadyWork } from '../../../packages/application/test/fixtures.ts';

const provider = { generateChapter() { throw new Error('Polling must not call a model'); } };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

test('simultaneous review polls share a read but keep client tokens and refresh after changes', { timeout: 10_000 }, async t => {
  const repository = new InMemoryWorkRepository();
  const work = await createReadyWork(new ChapterWorkflow(repository, provider), '并发刷新');
  const { app } = createApiServer({ repository, provider });
  t.after(() => app.close());
  const url = `/works/${work.id}/design/content-reviews?view=summary`;
  const release = deferred(), arrived = deferred();
  let arrivals = -1, reads = 0; // Initial token read precedes the concurrent group.
  app.addHook('preHandler', async () => { if (++arrivals === 3) arrived.resolve(); });
  const first = (await app.inject({ method: 'GET', url })).json();
  const get = repository.get.bind(repository);
  t.mock.method(repository, 'get', async (id: string) => { reads++; await release.promise; return get(id); });
  const requests = [url, `${url}&since=${first.revisionToken}`, `${url}&since=old`]
    .map(url => app.inject({ method: 'GET', url }).then(response => response));
  await arrived.promise;
  await setImmediate();
  assert.equal(reads, 1, 'three simultaneous tabs must not queue three history loads');
  release.resolve();
  const responses = await Promise.all(requests);
  assert.ok(responses.every(r => r.statusCode === 200));
  assert.deepEqual(responses[0].json(), first);
  assert.deepEqual(responses[1].json(), { unchanged: true, revisionToken: first.revisionToken });
  assert.deepEqual(responses[2].json(), first);
  work.worldPack!.summary += ' 新的世界约束。';
  await repository.save(work);
  const changed = (await app.inject({ method: 'GET', url: `${url}&since=${first.revisionToken}` })).json();
  assert.equal(reads, 2, 'settled snapshots must not be cached');
  assert.notEqual(changed.revisionToken, first.revisionToken);
  assert.equal(changed.unchanged, undefined);
});

test('concurrent review reads remain isolated by work, plan selection and response view', { timeout: 10_000 }, async t => {
  const repository = new InMemoryWorkRepository(), workflow = new ChapterWorkflow(repository, provider);
  const first = await createReadyWork(workflow, '第一本'), second = await createReadyWork(workflow, '第二本');
  const { app } = createApiServer({ repository, provider });
  t.after(() => app.close());
  const release = deferred(), arrived = deferred();
  let arrivals = 0, reads = 0;
  app.addHook('preHandler', async () => { if (++arrivals === 8) arrived.resolve(); });
  const get = repository.get.bind(repository);
  t.mock.method(repository, 'get', async (id: string) => { reads++; await release.promise; return get(id); });
  const base = `/works/${first.id}/design/content-reviews`;
  const urls = [`${base}?view=summary`, base,
    `/works/${second.id}/design/content-reviews?view=summary`, `${base}?view=summary&planId=missing-plan`];
  const requests = [...urls, ...urls].map(url => app.inject({ method: 'GET', url }).then(response => response));
  await arrived.promise;
  await setImmediate();
  assert.equal(reads, 4);
  release.resolve();
  const responses = await Promise.all(requests);
  for (let i = 0; i < 4; i++) assert.deepEqual(responses[i].json(), responses[i + 4].json());
  assert.ok(responses.slice(0, 3).every(r => r.statusCode === 200));
  assert.equal(responses[3].statusCode, 404, 'unknown plan must not reuse the default plan response');
  assert.notEqual(responses[0].json().revisionToken, responses[1].json().revisionToken);
  assert.notEqual(responses[0].json().selectedPlan.id, responses[2].json().selectedPlan.id);
});

test('a failed shared review read is discarded so the next refresh can recover', { timeout: 10_000 }, async t => {
  const repository = new InMemoryWorkRepository();
  const work = await createReadyWork(new ChapterWorkflow(repository, provider), '读取恢复');
  const { app } = createApiServer({ repository, provider });
  t.after(() => app.close());
  const release = deferred(), arrived = deferred();
  let arrivals = 0, reads = 0, fail = true;
  app.addHook('preHandler', async () => { if (++arrivals === 2) arrived.resolve(); });
  const get = repository.get.bind(repository);
  t.mock.method(repository, 'get', async (id: string) => {
    reads++; await release.promise;
    if (fail) throw new Error('Temporary history read failure');
    return get(id);
  });
  const url = `/works/${work.id}/design/content-reviews?view=summary`;
  const requests = [url, url].map(url => app.inject({ method: 'GET', url }).then(response => response));
  await arrived.promise;
  await setImmediate();
  assert.equal(reads, 1);
  release.resolve();
  const responses = await Promise.all(requests);
  assert.ok(responses.every(r => r.statusCode === 500));
  fail = false;
  assert.equal((await app.inject({ method: 'GET', url })).statusCode, 200);
  assert.equal(reads, 2);
});
