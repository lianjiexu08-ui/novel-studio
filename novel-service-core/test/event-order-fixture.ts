import assert from 'node:assert/strict';
import { NovelService, passChecker, characterStateAt, knowledgeAt, relationshipAt, resourceStateAt, artifactStateAt, storyArcAt, storyPromiseAt, storyThreadAt, storyVolumeAt, rebuildCharacterStates, contextManifestFor, type EventDraft, type Work } from '../src/core.ts';

export function eventOrderFixture() {
  const drafts: EventDraft[] = [
    { eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: 10 },
    { eventType: 'knowledge_belief', subjectId: 'hero', predicate: 'traitor', value: { subjectId: 'rival', belief: '无辜' } },
    { eventType: 'relationship_change', subjectId: 'rel', predicate: 'trust', value: '信任' },
    { eventType: 'resource_change', subjectId: 'stone', predicate: 'balance', value: 10 },
    { eventType: 'artifact_change', subjectId: 'sword', predicate: 'owner', value: 'hero' },
    ...['arc_progress', 'promise_payoff', 'thread_resolution', 'volume_progress', 'plot_progress'].map(eventType => ({ eventType, subjectId: eventType, predicate: 'status', value: { status: 'open' } })),
    { eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: 8 },
    { eventType: 'knowledge_belief', subjectId: 'hero', predicate: 'traitor', value: { belief: '有罪', subjectId: 'rival' } },
    { eventType: 'relationship_change', subjectId: 'rel', predicate: 'trust', value: '决裂' },
    { eventType: 'resource_change', subjectId: 'stone', predicate: 'balance', value: 8 },
    { eventType: 'artifact_change', subjectId: 'sword', predicate: 'owner', value: 'rival' },
    ...['arc_progress', 'promise_payoff', 'thread_resolution', 'volume_progress', 'plot_progress'].map(eventType => ({ eventType, subjectId: eventType, predicate: 'status', value: { status: eventType === 'promise_payoff' ? 'paid' : eventType === 'plot_progress' ? 'realized' : 'resolved' } })),
    // Identical occurrences separated by a different value must not collapse.
    ...[10, 8, 10].map(value => ({ eventType: 'resource_change', subjectId: 'refund', predicate: 'balance', value })),
  ];
  const service = new NovelService({ generateChapter: ({ chapterNumber }) => ({ content: `第${chapterNumber}章：收到十枚，花掉两枚。`, proposedEvents: structuredClone(drafts), observedEvents: structuredClone(drafts) }) });
  const work = service.createWork('同章连续变化');
  work.relationships.set('rel', { id: 'rel', fromCharacterId: 'hero', toCharacterId: 'rival', kind: 'trust', value: '同门', locked: false, layer: 'objective' });
  const candidate = service.generateCandidate(work.id, 1, 'sequence-1');
  service.runChecks(work.id, candidate.id, [passChecker]);
  const version = service.adoptCandidate(work.id, candidate.id);
  const records = [...work.events.values()];
  work.events.clear();
  records.forEach((event, index) => { event.id = `event-${String(records.length - index).padStart(3, '0')}`; });
  // Both UUID-like ID order and database insertion order oppose narrative order.
  records.reverse().forEach(event => work.events.set(event.id, event));
  return { service, work, candidate, version, drafts };
}

export function assertEventOrderStates(work: Work) {
  rebuildCharacterStates(work);
  assert.equal(work.states.get('hero|power')?.value, 8);
  assert.equal(characterStateAt(work, 'hero', 'power', 1)?.value, 8);
  assert.equal(knowledgeAt(work, 'hero', 'traitor', 1)?.belief, '有罪');
  assert.equal(relationshipAt(work, 'rel', 1)?.value, '决裂');
  assert.equal(resourceStateAt(work, 'stone', 'balance', 1)?.value, 8);
  assert.equal(resourceStateAt(work, 'refund', 'balance', 1)?.value, 10);
  assert.equal(artifactStateAt(work, 'sword', 'owner', 1)?.value, 'rival');
  assert.equal(storyArcAt(work, 'arc_progress', 1)?.status, 'resolved');
  assert.equal(storyPromiseAt(work, 'promise_payoff', 1)?.status, 'paid');
  assert.equal(storyThreadAt(work, 'thread_resolution', 1)?.status, 'resolved');
  assert.equal(storyVolumeAt(work, 'volume_progress', 1)?.status, 'resolved');
  const context = contextManifestFor(work, 2, { maxEvents: 1 });
  assert.equal(context.requiredMaterialStatus, 'complete');
  assert.ok(context.includedEventIds.includes(resourceStateAt(work, 'stone', 'balance', 1)!.sourceEventId));
  assert.equal(context.includedEventIds.length, 15);
  for (const event of work.events.values()) if (event.active && ['resource_change', 'artifact_change'].includes(event.eventType)) {
    assert.ok(context.includedEventIds.includes(event.id), 'limited context retains usage occurrences and custody history');
  }
}
