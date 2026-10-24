import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/server.ts';
import { InMemoryWorkRepository, type WorkRepository } from '../../../packages/application/src/index.ts';
import { Work } from '../../../novel-service-core/src/core.ts';
import { minimalStoryBible, minimalWorldPack } from '../../../packages/application/test/fixtures.ts';

for (const direct of [false, true]) test(`metadata/design responses preserve auth, freshness and 404 with ${direct ? 'targeted' : 'aggregate'} reads`, async t => {
  const work = new Work('三界😀', 'work');
  const repository: WorkRepository = new InMemoryWorkRepository();
  await repository.save(work);
  let reads = 0;
  const summary = () => ({ id: work.id, title: work.title, stateRevision: work.stateRevision, constraintRevision: work.constraintRevision, covenant: work.covenant });
  const design = () => ({ worldPack: work.worldPack, storyBible: work.storyBible, constraintRevision: work.constraintRevision });
  if (direct) {
    repository.get = async () => { throw new Error('Must not load the full aggregate'); };
    repository.getWorkSummary = async id => { reads++; return id === work.id ? structuredClone(summary()) : undefined; };
    repository.getDesignSnapshot = async id => { reads++; return id === work.id ? structuredClone(design()) : undefined; };
  } else {
    const get = repository.get.bind(repository);
    repository.get = async id => { reads++; return get(id); };
  }
  repository.save = () => { throw new Error('Reads must never save'); };
  repository.transaction = async () => { throw new Error('Reads must never mutate'); };
  const { app } = createApiServer({ repository, authToken: 'test-token',
    provider: { generateChapter: () => { throw new Error('Reads must never invoke a model'); } },
  });
  t.after(() => app.close());
  const headers = { authorization: 'Bearer test-token' };
  for (const suffix of ['', '/design']) {
    assert.equal((await app.inject({ method: 'GET', url: `/works/work${suffix}` })).statusCode, 401);
  }
  assert.equal(reads, 0, 'authentication must precede reads');
  for (const revision of [0, 1]) {
    work.title = `新名称${revision}`;
    work.constraintRevision = revision;
    if (revision) {
      work.worldPack = minimalWorldPack();
      work.storyBible = minimalStoryBible(work.worldPack);
    }
    for (const [suffix, expected] of [['', summary()], ['/design', { ...design(), atomicCandidateSave: true }]] as const) {
      const response = await app.inject({ method: 'GET', url: `/works/work${suffix}`, headers });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), JSON.parse(JSON.stringify(expected)));
      assert.equal((await app.inject({ method: 'GET', url: `/works/missing${suffix}`, headers })).statusCode, 404);
    }
  }
  assert.equal(work.versions.size, 0);
  assert.equal(work.designContentReviews.size, 0);
});
