import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/server.ts';
import { ChapterWorkflow, InMemoryWorkRepository } from '../../../packages/application/src/index.ts';
import { minimalStoryBible, minimalWorldPack } from '../../../packages/application/test/fixtures.ts';
import { relationshipSnapshotDtoSchema } from 'novel-studio-contracts';

test('chapter relationship snapshots distinguish author settings, future plans and actual evidence', async () => {
  const repository = new InMemoryWorkRepository();
  const provider = { generateChapter: () => ({ content: 'unused', proposedEvents: [] }) };
  const workflow = new ChapterWorkflow(repository, provider), work = await workflow.createWork('关系依据');
  work.worldPack = minimalWorldPack(); work.storyBible = minimalStoryBible(work.worldPack);
  work.storyBible.relationships[0] = { ...work.storyBible.relationships[0], sinceChapter: 3, untilChapter: 8, stages: [
    { sinceChapter: 3, untilChapter: 8, value: '计划结盟', cause: '共同救援', cost: '承担追责' },
  ] };
  work.relationships.set('manual', { id: 'manual', fromCharacterId: 'hero', toCharacterId: 'rival', kind: 'kinship', value: '兄弟', locked: true, layer: 'objective' });
  const { app } = createApiServer({ repository, provider });
  try {
    const read = async (chapter: number) => {
      const response = await app.inject({ method: 'GET', url: `/works/${work.id}/state/${chapter}` });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json().characterNames, { hero: '林渊', rival: '苏晚' }, 'relationship endpoints need readable labels from the current design');
      const rows = response.json().relationships;
      rows.forEach((row: unknown) => relationshipSnapshotDtoSchema.parse(row));
      return rows;
    };
    const first = await read(1);
    assert.equal(first.length, 1);
    assert.equal(first[0].basis, 'author_setting');
    assert.equal(first[0].sourceEventId, undefined);
    const planned = (await read(4)).find((row: any) => row.id === 'rel');
    assert.equal(planned.basis, 'story_plan');
    assert.equal(planned.value, '计划结盟');
    assert.equal(planned.plannedCause, '共同救援');
    assert.equal(planned.plannedCost, '承担追责');
    assert.equal(planned.storyBibleRevision, work.storyBible.revision);
    assert.equal(planned.untilChapter, 8);
    assert.equal(planned.sourceEventId, undefined);
    assert.equal((await read(9)).some((row: any) => row.id === 'rel'), false);

    const event = { id: 'alliance-event', workId: work.id, chapterVersionId: 'adopted-version-4', chapterNumber: 4, eventType: 'relationship_change', subjectId: 'rel', predicate: 'value', value: '救援失败后决裂', evidence: '他撕掉盟书，拒绝继续同行。', active: true };
    work.events.set(event.id, event);
    const before = JSON.stringify(work.storyBible);
    const actual = (await read(9)).find((row: any) => row.id === 'rel');
    assert.equal(actual.basis, 'adopted_event');
    assert.equal(actual.value, event.value, 'actual divergence survives the planned interval ending');
    assert.equal(actual.sourceEventId, event.id);
    assert.equal(actual.sourceChapterVersionId, event.chapterVersionId);
    assert.equal(actual.evidence, event.evidence);
    assert.equal(actual.plannedCause, undefined);
    assert.equal(JSON.stringify(work.storyBible), before, 'reconstruction must not adopt or rewrite the plan');
    event.active = false;
    assert.equal((await read(4)).find((row: any) => row.id === 'rel').basis, 'story_plan', 'invalidated evidence cannot label a plan as an adopted fact');
    assert.equal((await read(9)).some((row: any) => row.id === 'rel'), false);
  } finally { await app.close(); }
});
