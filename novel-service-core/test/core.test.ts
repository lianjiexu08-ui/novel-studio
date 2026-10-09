import test from 'node:test';
import assert from 'node:assert/strict';
import { AdoptionBlocked, LockedConstraintError, NovelService, passChecker, unavailableChecker } from '../src/core.ts';
import type { ModelProvider } from '../src/core.ts';

const provider: ModelProvider = {
  generateChapter: ({ chapterNumber, context }) => {
    const power = Number([...context.includedEventIds].length) + chapterNumber;
    const event = { eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: power, storyTime: chapterNumber, evidence: `paragraph ${chapterNumber}` };
    return { content: `第${chapterNumber}章：主角突破。`, proposedEvents: [event], observedEvents: [event] };
  },
};

test('candidate events stay isolated until adoption', () => {
  const service = new NovelService(provider);
  const work = service.createWork('玄幻试作');
  const candidate = service.generateCandidate(work.id, 1, 'run-1');
  assert.equal(work.events.size, 0);
  service.runChecks(work.id, candidate.id, [passChecker]);
  service.adoptCandidate(work.id, candidate.id);
  assert.equal(work.events.size, 1);
  assert.equal(work.states.get('hero|power')?.value, 1);
});

test('unavailable required checker blocks adoption', () => {
  const service = new NovelService(provider);
  const work = service.createWork('质量门');
  const candidate = service.generateCandidate(work.id, 1);
  service.runChecks(work.id, candidate.id, [passChecker, unavailableChecker]);
  assert.throws(() => service.adoptCandidate(work.id, candidate.id), AdoptionBlocked);
  assert.equal(work.versions.size, 0);
});

test('locked relationship cannot be changed by a candidate', () => {
  let relationshipId = '';
  const lockedProvider: ModelProvider = {
    generateChapter: () => ({ content: '关系变化', proposedEvents: [{ eventType: 'relationship_change', subjectId: relationshipId, predicate: 'value', value: '敌对' }], observedEvents: [{ eventType: 'relationship_change', subjectId: relationshipId, predicate: 'value', value: '敌对' }] }),
  };
  const service = new NovelService(lockedProvider);
  const work = service.createWork('锁定关系');
  const relationship = service.addRelationship(work.id, { fromCharacterId: 'a', toCharacterId: 'b', kind: 'identity', value: '兄妹', locked: false });
  relationshipId = relationship.id;
  service.lockRelationship(work.id, relationship.id);
  const candidate = service.generateCandidate(work.id, 1);
  service.runChecks(work.id, candidate.id, [passChecker]);
  assert.throws(() => service.adoptCandidate(work.id, candidate.id), LockedConstraintError);
});

test('early edit invalidates later context and rebuilds active state', () => {
  const service = new NovelService(provider);
  const work = service.createWork('版本失效');
  service.runUntil(work.id, 4, [passChecker], 'run-4');
  assert.equal(work.adoptedVersions().length, 4);
  service.editAdoptedChapter(work.id, 2, '第二章修订', [passChecker]);
  assert.equal(work.currentVersion(2)?.content, '第二章修订');
  assert.equal(work.currentVersion(3), undefined);
  assert.deepEqual(work.impacts[0].affectedChapterNumbers, [3, 4]);
  assert.equal(service.contextFor(work, 4).adoptedVersionIds.length, 2);
});

test('run checkpoint is idempotent for a completed run', () => {
  const service = new NovelService(provider);
  const work = service.createWork('恢复');
  const first = service.runUntil(work.id, 3, [passChecker], 'same-run');
  const ids = [...work.versions.values()].map((version) => version.id);
  const second = service.runUntil(work.id, 3, [passChecker], 'same-run');
  assert.equal(first.phase, 'complete');
  assert.equal(second.phase, 'complete');
  assert.deepEqual([...work.versions.values()].map((version) => version.id), ids);
});
