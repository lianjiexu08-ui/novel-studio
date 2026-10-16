import test from 'node:test';
import assert from 'node:assert/strict';
import { Work, contextManifestFor, emptyUsage, type ChapterVersion, type StoryEvent } from '../../../novel-service-core/src/core.ts';
import { OpenAICompatibleChapterProvider } from '../src/index.ts';
import { eventOrderFixture } from '../../../novel-service-core/test/event-order-fixture.ts';

function fixture() {
  const work = new Work('跨卷记忆');
  for (let chapter = 1; chapter <= 30; chapter++) {
    const version: ChapterVersion = { id: `v${chapter}`, workId: work.id, chapterNumber: chapter, revision: 1, content: `第${chapter}章已采用正文`, status: 'adopted', stale: false, createdAt: '2026-10-15T00:00:00Z' };
    work.versions.set(version.id, version);
  }
  const facts = [
    ['resource_change', 'medicine', 'remaining', 0], ['artifact_change', 'sword', 'holder', 'rival'],
    ['relationship_change', 'alliance', 'trust', '已决裂'], ['promise_payoff', 'promise', 'status', { status: 'paid' }],
    ['thread_resolution', 'mystery', 'status', { status: 'resolved' }], ['secret_reveal', 'secret', 'truth', '秘密已向在场者揭示'],
    ['character_state', 'hero', 'realm', '凝元'], ['knowledge_belief', 'hero', 'culprit', { belief: '仍然怀疑师父', certainty: 'suspects' }],
  ].map(([eventType, subjectId, predicate, value], index): StoryEvent => ({ id: `fact${index}`, workId: work.id, chapterVersionId: `v${index + 1}`, chapterNumber: index + 1,
    eventType: String(eventType), subjectId: String(subjectId), predicate: String(predicate), value, storyTime: index + 1, evidence: `第${index + 1}章的事实依据`, active: true }));
  facts.forEach(fact => work.events.set(fact.id, fact));
  let sent: any;
  const provider = new OpenAICompatibleChapterProvider('', '', '', 10, 5000, false, { completeWithUsage: async request => {
    sent = JSON.parse(request.user);
    return { text: JSON.stringify({ content: '仅测试请求载荷', proposedEvents: [] }), usage: emptyUsage() };
  } });
  return { work, facts, provider, sent: () => sent };
}

test('writer receives actual long-term facts and provenance, not only event IDs and recent prose', async () => {
  const f = fixture(), context = contextManifestFor(f.work, 31, { maxEvents: 2, maxVersions: 8 });
  await f.provider.generateChapterAsync({ work: f.work, chapterNumber: 31, context });
  const sent = f.sent();
  assert.deepEqual(sent.recentChapters.map((chapter: any) => chapter.chapterNumber), [23, 24, 25, 26, 27, 28, 29, 30]);
  assert.deepEqual(sent.adoptedFacts, f.facts, 'old balances, ownership and resolved promises must be present as evidence');
  assert.deepEqual(sent.adoptedKnowledge, [f.facts.at(-1)]);
});

test('a replacement writer never receives current, future, invalidated or foreign content through extra manifest IDs', async () => {
  const f = fixture();
  f.work.versions.set('stale', { ...f.work.versions.get('v1')!, id: 'stale', stale: true, content: '已失效剧情' });
  f.work.versions.set('foreign', { ...f.work.versions.get('v1')!, id: 'foreign', workId: 'another-work', content: '另一作品剧情' });
  f.work.events.set('inactive', { ...f.facts[0], id: 'inactive', active: false });
  f.work.events.set('foreign', { ...f.facts[0], id: 'foreign', workId: 'another-work' });
  const context = contextManifestFor(f.work, 3);
  context.adoptedVersionIds.push('v3', 'v30', 'stale', 'foreign', 'missing');
  context.includedEventIds.push('fact2', 'fact7', 'inactive', 'foreign', 'missing');
  await f.provider.generateChapterAsync({ work: f.work, chapterNumber: 3, context });
  assert.deepEqual(f.sent().adoptedFacts, f.facts.slice(0, 2));
  assert.deepEqual(f.sent().recentChapters.map((chapter: any) => chapter.chapterNumber), [1, 2]);
  assert.deepEqual(f.sent().adoptedKnowledge, []);
});

for (const maxEvents of [240, 1]) test(`writer preserves verified same-chapter transitions in the selected ${maxEvents}-event context`, async () => {
  const { work } = eventOrderFixture();
  const context = contextManifestFor(work, 2, { maxEvents });
  assert.equal(context.requiredMaterialStatus, 'complete');
  const expected: StoryEvent[] = JSON.parse(JSON.stringify(context.includedEventIds.map(id => work.events.get(id)!)));
  assert.notDeepEqual(expected.map(e => e.id), expected.map(e => e.id).sort(), 'fixture UUID order must differ from narrative order');
  // The manifest selects records; its list order is not an alternate chronology.
  context.includedEventIds.reverse();
  context.includedEventIds.push(context.includedEventIds[0]);
  const before = structuredClone(work);
  let sent: any;
  const provider = new OpenAICompatibleChapterProvider('', '', '', 10, 5000, false, { completeWithUsage: async request => {
    sent = JSON.parse(request.user);
    return { text: JSON.stringify({ content: '续章测试请求', proposedEvents: [] }), usage: emptyUsage() };
  } });
  await provider.generateChapterAsync({ work, chapterNumber: 2, context });
  assert.deepEqual(sent.adoptedFacts, expected, 'recover actual adoption order without expanding the selected context');
  assert.deepEqual(sent.adoptedKnowledge, expected.filter(e => e.eventType === 'knowledge_belief'));
  if (maxEvents === 240) {
    assert.deepEqual(sent.adoptedFacts.filter((e: StoryEvent) => e.subjectId === 'stone').map((e: StoryEvent) => e.value), [10, 8]);
    assert.deepEqual(sent.adoptedKnowledge.map((e: StoryEvent) => (e.value as { belief: string }).belief), ['无辜', '有罪']);
    assert.deepEqual(sent.adoptedFacts.filter((e: StoryEvent) => e.subjectId === 'refund').map((e: StoryEvent) => e.value), [10, 8, 10], 'repeated occurrences must survive');
  }
  assert.deepEqual(structuredClone(work), before, 'generation must not rewrite history to repair its order');
});

for (const corruption of ['missing-candidate', 'changed-event'] as const) test(`writer refuses ${corruption} ordering evidence before spending a model call`, async () => {
  const { work, candidate } = eventOrderFixture();
  const context = contextManifestFor(work, 2);
  if (corruption === 'missing-candidate') work.candidates.delete(candidate.id);
  else [...work.events.values()][0].value = '无依据的新余额';
  const before = structuredClone(work);
  let calls = 0;
  const provider = new OpenAICompatibleChapterProvider('', '', '', 10, 5000, false, { completeWithUsage: async () => {
    calls++;
    return { text: JSON.stringify({ content: '不应生成', proposedEvents: [] }), usage: emptyUsage() };
  } });
  await assert.rejects(provider.generateChapterAsync({ work, chapterNumber: 2, context }), /事件顺序/);
  assert.equal(calls, 0);
  assert.deepEqual(structuredClone(work), before);
});
