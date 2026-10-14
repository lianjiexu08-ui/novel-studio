import test from 'node:test';
import assert from 'node:assert/strict';
import { revisionSections, revisionChanges, replaceRevisionField } from '../src/design-revision.ts';
import { minimalWorldPack, minimalStoryBible, minimalPlan } from '../../../packages/application/test/fixtures.ts';
function fixture() { const worldPack = minimalWorldPack(); return { worldPack, storyBible: minimalStoryBible(worldPack), plan: minimalPlan() }; }

test('text revisions preserve multiline list items, other documents and all approval/reference metadata', () => {
  const before = fixture();
  before.worldPack.techniques[0].limitations = ['第一行\n第二行', '另一条'];
  const snapshot = structuredClone(before), path = ['worldPack', 'techniques', 0, 'limitations'];
  const after = replaceRevisionField(before, path, ['第一行\n第二行\n补充条件', '另一条']);
  assert.deepEqual(before, snapshot);
  assert.equal(after.worldPack.techniques[0].limitations.length, 2);
  assert.deepEqual(after.storyBible, before.storyBible);
  assert.deepEqual(after.plan, before.plan);
  const diff = revisionChanges(before, after);
  assert.equal(diff.length, 1);
  assert.deepEqual(diff[0].before, ['第一行\n第二行', '另一条']);
  assert.deepEqual(diff[0].path, path);
  for (const protectedPath of [['worldPack', 'status'], ['worldPack', 'id'], ['worldPack', 'techniques', 0, 'allowedRealmIds'], ['plan', 'chapters', 0, 'source'], ['worldPack', 'factions', 0, 'resources'], ['plan', 'chapters', 0, 'threads']]) {
    assert.throws(() => replaceRevisionField(before, protectedPath, 'locked'), /不是可修订/);
  }
});

test('nested relationship and knowledge text is addressable without changing stage dates or ownership', () => {
  const before = fixture();
  before.storyBible.relationships[0].stages = [{ sinceChapter: 1, untilChapter: 3, value: '戒备', cause: '误会', cost: '错过合作' }];
  const path = ['storyBible', 'relationships', 0, 'stages', 0, 'cause'];
  const after = replaceRevisionField(before, path, '亲见选择后逐渐信任');
  assert.equal(after.storyBible.relationships[0].stages![0].sinceChapter, 1);
  assert.equal(after.storyBible.relationships[0].fromCharacterId, before.storyBible.relationships[0].fromCharacterId);
  const diff = revisionChanges(before, after);
  assert.equal(diff.length, 1);
  assert.match(diff[0].section, /林渊 → 苏晚/);
  assert.match(diff[0].label, /第 1–3 章.*变化原因/);
});

test('empty entity lists do not become editable text lists, and world power sources remain editable', () => {
  const before = fixture(); before.storyBible.arcBeats = [];
  const fields = revisionSections(before).flatMap(section => section.fields);
  assert.ok(!fields.some(field => field.path.join('.') === 'storyBible.arcBeats'));
  assert.ok(fields.some(field => field.path.join('.') === 'plan.keyTurns'));
  const after = replaceRevisionField(before, ['worldPack', 'powerSystems', 0, 'source'], '实际吸收天地灵气');
  assert.equal(after.worldPack.powerSystems[0].source, '实际吸收天地灵气');
});
