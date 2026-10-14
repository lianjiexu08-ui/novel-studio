import test from 'node:test';
import assert from 'node:assert/strict';
import { Work, contextManifestFor, type StoryEvent } from '../src/core.ts';

function event(work: Work, id: string, chapterNumber: number, eventType: string, value: unknown): StoryEvent {
  return { id, workId: work.id, chapterVersionId: `version-${chapterNumber}`, chapterNumber, eventType, subjectId: `${eventType}-subject`, predicate: 'state', value, evidence: '已采用正文中的变化', active: true };
}

test('long context retains old resource, artifact, relationship and story-state evidence beyond the recent event window', () => {
  const work = new Work('长期事实');
  const kinds = ['resource_change', 'artifact_change', 'relationship_change', 'arc_progress', 'secret_reveal', 'promise_payoff', 'thread_resolution', 'volume_progress', 'plot_progress'];
  for (const [index, kind] of kinds.entries()) work.events.set(kind, event(work, kind, index + 1, kind, { status: 'paid', remaining: 2 }));
  for (let chapter = 20; chapter <= 30; chapter++) work.events.set(`power-${chapter}`, event(work, `power-${chapter}`, chapter, 'character_state', chapter));
  const manifest = contextManifestFor(work, 31, { maxEvents: 2 });
  for (const kind of kinds) assert.ok(manifest.includedEventIds.includes(kind), `must retain ${kind} even if its prose is no longer recent`);
  assert.ok(manifest.includedEventIds.includes('power-30'));
  assert.ok(!manifest.includedEventIds.includes('power-20'));
  assert.ok(manifest.omittedOptionalMaterial.length);
  const tooSmall = contextManifestFor(work, 31, { maxEvents: 2, contextBudget: 1 });
  assert.equal(tooSmall.requiredMaterialStatus, 'needs_split');
  assert.deepEqual(tooSmall.includedEventIds, manifest.includedEventIds, 'mandatory facts are never silently dropped to meet the budget');
});

test('latest fact selection is deterministic when persisted rows are loaded out of order', () => {
  const work = new Work('乱序读取');
  const records = [event(work, 'new', 20, 'character_state', '凝元'), event(work, 'old', 1, 'character_state', '淬体')];
  records.forEach(record => work.events.set(record.id, record));
  const reversed = contextManifestFor(work, 21, { maxEvents: 1 });
  assert.deepEqual(reversed.includedEventIds, ['new']);
  work.events.clear(); records.reverse().forEach(record => work.events.set(record.id, record));
  const sorted = contextManifestFor(work, 21, { maxEvents: 1 });
  assert.deepEqual(sorted.includedEventIds, reversed.includedEventIds);
  assert.equal(sorted.stateHash, reversed.stateHash);
});

test('chapter boundaries exclude current, future, foreign and invalidated events', () => {
  const work = new Work('重写边界');
  for (const record of [event(work, 'before', 2, 'resource_change', 2), event(work, 'same', 3, 'resource_change', 100), event(work, 'future', 4, 'artifact_change', '神剑'),
    { ...event(work, 'inactive', 1, 'relationship_change', '盟友'), active: false },
    { ...event(work, 'foreign', 1, 'secret_reveal', '真相'), workId: 'another-work' }]) work.events.set(record.id, record);
  assert.deepEqual(contextManifestFor(work, 3).includedEventIds, ['before']);
});
