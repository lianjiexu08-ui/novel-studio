import test from 'node:test';
import assert from 'node:assert/strict';
import { eventOrderFixture, assertEventOrderStates } from './event-order-fixture.ts';
import { orderedStoryEvents, resolveStoryEventOrder } from '../src/event-order.ts';
import { contextManifestFor, passChecker, ReadinessError, Work, closureCoverageFor, observedEventsChecker, AdoptionBlocked } from '../src/core.ts';
import { chapterReviewInput } from '../src/chapter-review.ts';

test('same-chapter state and context use retained adoption order, including duplicate occurrences', () => {
  const { work, drafts, candidate } = eventOrderFixture();
  const before = JSON.stringify([...work.events.values()]);
  assertEventOrderStates(work);
  assert.deepEqual(orderedStoryEvents(work).map(event => event.value), drafts.map(event => event.value));
  assert.deepEqual(resolveStoryEventOrder(work).issues, []);
  const input = chapterReviewInput(work, { ...candidate, chapterNumber: 2 });
  const facts = input.sources.find(source => source.id === 'facts');
  assert.deepEqual(JSON.parse(facts!.text).map((event: { value: unknown }) => event.value), drafts.map(event => event.value));
  assert.equal(JSON.stringify([...work.events.values()]), before, 'projections never rewrite the event ledger');
});

test('reordered object keys and omitted evidence still match persisted drafts', () => {
  const { work } = eventOrderFixture();
  for (const event of work.events.values()) if (event.value && typeof event.value === 'object') event.value = Object.fromEntries(Object.entries(event.value).reverse());
  assertEventOrderStates(work);
  assert.deepEqual(resolveStoryEventOrder(work).issues, []);
});

test('early content edit retains semantic sequence and invalidates downstream facts without deleting history', () => {
  const { work, service, version } = eventOrderFixture();
  const second = service.generateCandidate(work.id, 2, 'sequence-2');
  service.runChecks(work.id, second.id, [passChecker]);
  const downstream = service.adoptCandidate(work.id, second.id);
  const oldIds = [...work.events.keys()];
  service.editAdoptedChapter(work.id, 1, '收到十枚灵石，花掉两枚，余八枚。', [passChecker]);
  assert.equal(version.status, 'superseded');
  assert.equal(downstream.stale, true);
  for (const id of oldIds) assert.equal(work.events.get(id)?.active, false);
  assertEventOrderStates(work);
  for (const old of [version, downstream]) assert.deepEqual(resolveStoryEventOrder(work, [...work.events.values()].filter(event => event.chapterVersionId === old.id)).issues, [], 'superseded candidates still prove their original event sequence');
});

test('missing or mismatched order evidence blocks writing, review and closure instead of certifying ID order', () => {
  for (const corrupt of ['missing-candidate', 'wrong-binding', 'changed-event', 'missing-event', 'changed-content'] as const) {
    const { work, service, candidate } = eventOrderFixture();
    const next = service.generateCandidate(work.id, 2, 'already-generated');
    service.runChecks(work.id, next.id, [passChecker]);
    if (corrupt === 'missing-candidate') work.candidates.delete(candidate.id);
    if (corrupt === 'wrong-binding') candidate.adoptedVersionId = 'wrong';
    if (corrupt === 'changed-event') [...work.events.values()][0].value = 999;
    if (corrupt === 'missing-event') work.events.delete([...work.events.keys()][0]);
    if (corrupt === 'changed-content') candidate.content += '篡改';
    assert.ok(resolveStoryEventOrder(work).issues.length, corrupt);
    assert.equal(contextManifestFor(work, 2).requiredMaterialStatus, 'blocked', corrupt);
    assert.throws(() => service.generateCandidate(work.id, 2, 'new-attempt'), ReadinessError, corrupt);
    assert.throws(() => service.adoptCandidate(work.id, next.id), ReadinessError, corrupt);
    assert.throws(() => chapterReviewInput(work, next), /事件顺序/);
    assert.throws(() => service.editAdoptedChapter(work.id, 1, '改字', [passChecker]), /顺序/);
    assert.equal(closureCoverageFor(work, 1).ready, false);
  }
});

test('legacy single changes remain readable but conflicting same-chapter changes are explicitly uncertain', () => {
  const { work, version } = eventOrderFixture();
  delete version.sourceCandidateId;
  const records = [...work.events.values()].filter(e => e.eventType === 'resource_change' && e.subjectId === 'stone');
  work.events.clear();
  work.events.set(records[0].id, records[0]);
  assert.deepEqual(resolveStoryEventOrder(work).issues, []);
  work.events.set(records[1].id, records[1]);
  assert.match(resolveStoryEventOrder(work).issues.join(), /同章多次变化/);
  assert.equal(contextManifestFor(work, 2).requiredMaterialStatus, 'blocked');
  records[1].active = false;
  assert.equal(contextManifestFor(work, 2).requiredMaterialStatus, 'complete');
  const other = new Work('foreign');
  assert.deepEqual(orderedStoryEvents(other, records), []);
});

test('independent extraction cannot reverse transitions or silently omit duplicate occurrences', () => {
  for (const mode of ['reverse', 'deduplicate']) {
    const { work, service } = eventOrderFixture();
    const candidate = service.generateCandidate(work.id, 2, mode);
    if (mode === 'reverse') candidate.observedEvents!.reverse();
    else candidate.observedEvents!.pop();
    assert.equal(observedEventsChecker.check({ work, candidate }).status, 'failed');
    service.runChecks(work.id, candidate.id, [passChecker]);
    assert.throws(() => service.adoptCandidate(work.id, candidate.id), AdoptionBlocked);
  }
  const { work, service } = eventOrderFixture();
  const candidate = service.generateCandidate(work.id, 2, 'regrouped');
  candidate.observedEvents!.sort((a, b) => a.subjectId.localeCompare(b.subjectId));
  assert.equal(observedEventsChecker.check({ work, candidate }).status, 'passed', 'independent subjects may be grouped differently');
});
