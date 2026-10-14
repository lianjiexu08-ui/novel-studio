import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/server.ts';
import { ChapterWorkflow, InMemoryWorkRepository } from '../../../packages/application/src/index.ts';
import { NovelService, passChecker } from '../../../novel-service-core/src/core.ts';
import type { ModelProvider } from '../../../novel-service-core/src/core.ts';
import { createReadyWork } from '../../../packages/application/test/fixtures.ts';

const provider: ModelProvider = { generateChapter: ({ chapterNumber }) => {
  const events = chapterNumber === 10 ? [
    { eventType: 'arc_progress', subjectId: 'arc', predicate: 'status', value: { status: 'resolved' } },
    { eventType: 'volume_progress', subjectId: 'vol-1', predicate: 'status', value: { status: 'resolved' } },
  ] : [];
  return { content: `第${chapterNumber}章原稿`, proposedEvents: events, observedEvents: events };
} };

async function fixture() {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, provider);
  const work = await createReadyWork(workflow, '冻结时的书名');
  await workflow.runUntil(work.id, 10, [passChecker], 'export-fixture');
  const manuscript = await workflow.finalizeManuscript(work.id);
  const { app } = createApiServer({ repository, provider });
  const url = `/works/${work.id}/manuscripts/${manuscript.id}/export`;
  return { work: (await repository.get(work.id))!, manuscript, app, url, workflow };
}

test('historical export survives renaming, covenant edits, later designs and early chapter replacement', async t => {
  const { work, manuscript, app, url, workflow } = await fixture();
  t.after(() => app.close());
  const original = (await app.inject({ method: 'GET', url })).json();
  assert.equal(original.work.metadataStatus, 'frozen');
  assert.equal(original.work.title, '冻结时的书名');
  assert.ok(original.events.length > 0);
  await workflow.finalizeManuscript(work.id); // Lifecycle status may become superseded.
  const core = new NovelService(provider);
  core.works.set(work.id, work);
  core.editAdoptedChapter(work.id, 1, '修订后的第一章', [passChecker]);
  work.title = '后来改名';
  work.covenant.mustKeep = '后来追加的约定'; // Catch shallow snapshot aliasing.
  work.recordCovenant({ ...work.covenant, chapterWords: 5000 });
  work.worldPack!.summary = '后来的世界';
  work.storyBible!.endingDirection = '后来的结局';
  // Even a later entry sharing a numeric revision cannot replace the frozen ID.
  work.recordDesignRevision('world_pack', work.worldPack!);
  work.recordDesignRevision('story_bible', work.storyBible!);
  const response = await app.inject({ method: 'GET', url });
  assert.equal(response.statusCode, 200, response.body);
  const after = response.json();
  assert.equal(after.manuscript.status, 'superseded');
  original.manuscript.status = 'superseded';
  assert.deepEqual(after, original);
  assert.ok([...work.events.values()].some(event => !event.active));
  assert.equal(after.closureCoverage.ready, true);
  work.designHistory.delete(manuscript.exportSnapshot!.worldPackDesignId);
  const missing = await app.inject({ method: 'GET', url });
  assert.equal(missing.statusCode, 409, missing.body);
});

test('legacy export marks unknown metadata instead of inventing a historical title or covenant', async t => {
  const { work, manuscript, app, url } = await fixture();
  t.after(() => app.close());
  delete manuscript.exportSnapshot;
  work.title = '绝不能当作旧书名';
  work.covenant.mustKeep = '绝不能当作旧约定';
  work.worldPack!.revision += 1;
  work.recordDesignRevision('world_pack', work.worldPack!);
  const response = await app.inject({ method: 'GET', url });
  assert.equal(response.statusCode, 200, response.body);
  const exported = response.json();
  assert.deepEqual(exported.work, { id: work.id, title: null, covenant: null, metadataStatus: 'unavailable_legacy' });
  assert.equal(exported.chapters.length, 10);
  assert.ok(exported.designHistory.every((item: { kind: string; revision: number }) => item.kind !== 'world_pack' || item.revision <= manuscript.worldPackRevision));
});
