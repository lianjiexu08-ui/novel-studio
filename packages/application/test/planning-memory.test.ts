import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChapterWorkflow, InMemoryWorkRepository, type AdoptedFacts } from '../src/index.ts';
import { JsonWorkRepository } from '../../persistence/src/json-repository.ts';
import { JsonBookPlanner } from '../../planner/src/index.ts';
import { passChecker, type ModelProvider, type Work } from '../../../novel-service-core/src/core.ts';
import { chapterBody, createReadyWork, minimalOutline, minimalPlan } from './fixtures.ts';

function capturingPlanner() {
  const requests: Array<{ task: string; adoptedFacts: AdoptedFacts }> = [];
  const planner = new JsonBookPlanner({ complete: async ({ user }) => {
    const input = JSON.parse(user);
    requests.push(input);
    if (input.task === 'generate_book_plan') {
      const { chapters, ...skeleton } = minimalPlan();
      return JSON.stringify(skeleton);
    }
    return JSON.stringify({ chapters: Array.from({ length: input.to - input.from + 1 }, (_, i) => ({
      ...minimalOutline(input.from + i), location: '矿口', storyTime: `第${input.from + i}日`,
      scenes: ['主角核对欠款后交付已付费的药材。'],
    })) });
  } });
  return { planner, requests };
}

function writer(replacement = false): ModelProvider {
  return { generateChapter: ({ chapterNumber }) => {
    const events = chapterNumber === 2 ? Array.from({ length: 205 }, (_, i) => ({
      eventType: 'character_state', subjectId: 'hero', predicate: `record-${i}`, value: i,
      evidence: '灵气在经脉里缓慢流转', storyTime: 20,
    })) : [{ eventType: 'character_state', subjectId: 'hero', predicate: 'funds',
      value: replacement ? 60 : chapterNumber === 1 ? 100 : 20,
      evidence: '灵气在经脉里缓慢流转', storyTime: chapterNumber * 10 }];
    return { content: chapterBody(chapterNumber) + (replacement ? '重新核定药费。' : ''), proposedEvents: events, observedEvents: events };
  } };
}

async function adopt(workflow: ChapterWorkflow, work: Work, chapter: number, runId: string) {
  const candidate = await workflow.generate(work.id, chapter, runId);
  await workflow.check(work.id, candidate.id, [passChecker]);
  return workflow.adopt(work.id, candidate.id, work.stateRevision);
}

for (const mode of ['plan', 'outlines'] as const) test(`${mode} model request retains early facts and provenance beyond 200 later events`, async () => {
  const { planner, requests } = capturingPlanner();
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer(), undefined, { planProvider: planner });
  const work = await createReadyWork(workflow, '长篇规划不能丢早期账目');
  for (let chapter = 1; chapter <= 3; chapter++) await adopt(workflow, work, chapter, `write-${chapter}`);
  const history = structuredClone({ versions: [...work.versions], events: [...work.events], candidates: [...work.candidates] });
  if (mode === 'plan') await workflow.generatePlan(work.id, { targetChapterCount: 10, volumeCount: 1 });
  else await workflow.generateOutlines(work.id, { baseRevisionId: work.activePlanId!, from: 4, to: 5 });
  assert.ok(requests.some(r => r.task === 'generate_chapter_outlines'));
  for (const { adoptedFacts: facts } of requests) {
    assert.equal(facts.reachedChapter, 3);
    assert.equal(facts.eventSelection, 'all_active_events');
    assert.equal(facts.events.length, 207);
    assert.equal(facts.events[0].value, 100, 'early funds must not disappear behind 200 later records');
    assert.equal(facts.events.at(-1)!.value, 20);
    assert.equal(facts.events[0].storyTime, 10);
    assert.deepEqual(facts.events.map(e => e.id), [...work.events.keys()]);
    assert.equal(facts.events[0].chapterVersionId, work.currentVersion(1)!.id);
    assert.deepEqual(facts.events.slice(1, -1).map(e => e.value), Array.from({ length: 205 }, (_, i) => i), 'keep actual adoption order');
    assert.ok(facts.recentChapters.every(c => c.excerptTruncated && c.excerpt.length === 400));
    assert.deepEqual(facts.recentChapters.map(c => c.versionId), work.adoptedVersions().map(v => v.id));
  }
  assert.deepEqual(structuredClone({ versions: [...work.versions], events: [...work.events], candidates: [...work.candidates] }), history);
});

test('after replacing an early chapter and restarting, planning retains history but sends only current facts', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'novel-planning-memory-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'work.json'), { planner, requests } = capturingPlanner();
  const repository = new JsonWorkRepository(file);
  const workflow = new ChapterWorkflow(repository, writer(), undefined, { planProvider: planner });
  const created = await createReadyWork(workflow, '替换后规划');
  for (let chapter = 1; chapter <= 3; chapter++) await adopt(workflow, (await repository.get(created.id))!, chapter, `old-${chapter}`);
  const old = (await repository.get(created.id))!;
  workflow.applyModelProviders(writer(true), undefined, planner);
  await adopt(workflow, old, 1, 'replacement');
  const restartedRepository = new JsonWorkRepository(file);
  const restarted = new ChapterWorkflow(restartedRepository, writer(true), undefined, { planProvider: planner });
  const current = (await restartedRepository.get(created.id))!;
  await restarted.generateOutlines(current.id, { baseRevisionId: current.activePlanId!, from: 2, to: 3 });
  const facts = requests.at(-1)!.adoptedFacts;
  assert.equal(facts.reachedChapter, 1);
  assert.deepEqual(facts.events.map(e => e.value), [60]);
  assert.deepEqual(facts.recentChapters.map(c => c.chapterNumber), [1]);
  assert.equal(facts.events[0].chapterVersionId, current.currentVersion(1)!.id);
  const saved = (await restartedRepository.get(created.id))!;
  assert.equal(saved.versions.size, 4);
  assert.equal(saved.events.size, 208);
  assert.equal([...saved.events.values()].filter(e => !e.active).length, 207);
  assert.ok([...old.events.keys()].every(id => saved.events.has(id)));
});

test('planning without an active plan reports contiguous adopted progress, not the count of disconnected chapters', async () => {
  const { planner, requests } = capturingPlanner();
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer(), undefined, { planProvider: planner });
  const work = await createReadyWork(workflow, '非连续正文');
  const baseId = work.activePlanId!;
  for (const chapterNumber of [1, 3]) work.versions.set(`legacy-${chapterNumber}`, {
    id: `legacy-${chapterNumber}`, workId: work.id, chapterNumber, revision: 1,
    content: '旧版已采纳短文', status: 'adopted', stale: false, createdAt: new Date().toISOString(),
  });
  work.activePlanId = undefined;
  await workflow.generateOutlines(work.id, { baseRevisionId: baseId, from: 4, to: 4 });
  const facts = requests[0].adoptedFacts;
  assert.equal(facts.reachedChapter, 1);
  assert.deepEqual(facts.recentChapters.map(c => c.chapterNumber), [1, 3], 'later history remains visible without claiming a complete prefix');
  assert.ok(facts.recentChapters.every(c => c.excerptTruncated === false));
});

test('provider capacity failure leaves the full ledger and existing plans intact instead of retrying with fewer facts', async () => {
  let calls = 0;
  const planner = new JsonBookPlanner({ complete: async () => { calls++; throw new Error('context_length_exceeded'); } });
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer(), undefined, { planProvider: planner });
  const work = await createReadyWork(workflow, '容量失败保留材料');
  for (let chapter = 1; chapter <= 2; chapter++) await adopt(workflow, work, chapter, `write-${chapter}`);
  const before = structuredClone(work);
  await assert.rejects(workflow.generateOutlines(work.id, { baseRevisionId: work.activePlanId!, from: 3, to: 4 }), /context_length_exceeded/);
  assert.equal(calls, 1);
  assert.deepEqual(structuredClone(work), before);
});
