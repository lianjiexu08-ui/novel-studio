import test from 'node:test';
import assert from 'node:assert/strict';
import { canonConsistencyChecker, passChecker, ReadinessError, SettingConflictError, StaleCandidateError } from '../../../novel-service-core/src/core.ts';
import type { ModelProvider } from '../../../novel-service-core/src/core.ts';
import { addCharacter, addSettingRelationship, unifiedCharacters, updateSettingRelationship } from '../../../novel-service-core/src/bible.ts';
import { effectiveBrief, milestonePrerequisites, PlanConflictError, PlanGateError, planRealization } from '../../../novel-service-core/src/planning.ts';
import type { BookPlan, ChapterOutline } from '../../../novel-service-core/src/planning.ts';
import { ChapterWorkflow, InMemoryWorkRepository, type PlanProvider } from '../src/index.ts';
import { approveMinimalPlan, chapterBody, createReadyWork, lockMinimalDesign, minimalOutline, minimalPlan, readyCovenant } from './fixtures.ts';

type Event = { eventType: string; subjectId: string; predicate: string; value: unknown; evidence: string };

function scriptedProvider(eventsFor: (chapterNumber: number) => Event[] = () => []): ModelProvider {
  return {
    generateChapter: ({ chapterNumber }) => {
      const events = [{ eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: chapterNumber, evidence: 'p1' }, ...eventsFor(chapterNumber)];
      return { content: chapterBody(chapterNumber), proposedEvents: events, observedEvents: events };
    },
  };
}

async function writeChapter(workflow: ChapterWorkflow, workId: string, chapterNumber: number, expectedStateRevision: number) {
  const candidate = await workflow.generate(workId, chapterNumber, `chapter-${chapterNumber}-run`);
  await workflow.check(workId, candidate.id, [passChecker]);
  return workflow.adopt(workId, candidate.id, expectedStateRevision);
}

function codes(issues: Array<{ code: string; severity: string }>, severity = 'error'): string[] {
  return issues.filter((issue) => issue.severity === severity).map((issue) => issue.code);
}

test('AT-05 a 449-chapter split or overlapping volumes fail review with the volume located, and cannot be approved', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider());
  const work = await workflow.createWork('分卷校验', readyCovenant());
  await lockMinimalDesign(workflow, work.id);

  const short = minimalPlan(450, { volumeSize: 150, outlined: 50 });
  short.volumes[2] = { ...short.volumes[2], endChapter: 449 };
  const saved = await workflow.savePlan(work.id, { plan: short });
  const review = await workflow.reviewPlan(work.id, saved.id);
  assert.equal(review.passed, false);
  const total = review.issues.find((issue) => issue.code === 'VOLUME_TOTAL_MISMATCH');
  assert.match(total?.message ?? '', /449.*450/);
  await assert.rejects(() => workflow.approvePlan(work.id, saved.id), PlanGateError);

  const overlapping = minimalPlan(450, { volumeSize: 150, outlined: 50 });
  overlapping.volumes[1] = { ...overlapping.volumes[1], startChapter: 140 };
  const second = await workflow.savePlan(work.id, { plan: overlapping, baseRevisionId: saved.id });
  const overlapReview = await workflow.reviewPlan(work.id, second.id);
  const overlap = overlapReview.issues.find((issue) => issue.code === 'VOLUME_OVERLAP');
  assert.ok(overlap, JSON.stringify(overlapReview.issues));
  assert.equal(overlap.volumeId, 'vol-2');
  assert.match(overlap.message, /第2卷/);
  assert.deepEqual(await workflow.readiness(work.id, 1).then((blockers) => blockers.map((blocker) => blocker.code)), ['PLAN_NOT_APPROVED']);
});

test('AT-06 49 outlines for a long book fail review: outline 50 is missing and formal writing stays blocked', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider());
  const work = await workflow.createWork('章纲窗口', readyCovenant());
  await lockMinimalDesign(workflow, work.id);
  const saved = await workflow.savePlan(work.id, { plan: minimalPlan(450, { volumeSize: 150, outlined: 49 }) });
  const review = await workflow.reviewPlan(work.id, saved.id);
  assert.equal(review.passed, false);
  const missing = review.issues.find((issue) => issue.code === 'OUTLINE_MISSING');
  assert.match(missing?.message ?? '', /50/);
  await assert.rejects(() => workflow.approvePlan(work.id, saved.id), PlanGateError);
  await assert.rejects(() => workflow.generate(work.id, 1, 'formal'), (error: unknown) => error instanceof ReadinessError && error.code === 'PLAN_NOT_APPROVED');
});

test('review and approval are separate; approval needs a passing review of the same content against the current design', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider());
  const work = await workflow.createWork('批准门禁', readyCovenant());
  await lockMinimalDesign(workflow, work.id);
  const first = await workflow.savePlan(work.id, { plan: minimalPlan() });
  assert.equal(first.status, 'proposed');
  await assert.rejects(() => workflow.approvePlan(work.id, first.id), PlanGateError, 'unreviewed plans cannot be approved');
  await assert.rejects(() => workflow.savePlan(work.id, { plan: minimalPlan() }), PlanConflictError, 'saving needs the latest revision as base');

  const review = await workflow.reviewPlan(work.id, first.id);
  assert.equal(review.passed, true);
  assert.equal(review.contentHash, first.contentHash);
  const approved = await workflow.approvePlan(work.id, first.id);
  assert.equal(approved.status, 'approved');
  assert.equal(work.activePlanId, first.id);

  const edited = minimalPlan();
  edited.chapters[0] = { ...edited.chapters[0], summary: '林渊放弃考核' };
  const second = await workflow.savePlan(work.id, { plan: edited, baseRevisionId: first.id });
  await workflow.reviewPlan(work.id, second.id);
  await workflow.approvePlan(work.id, second.id);
  assert.equal(work.plans.get(first.id)?.status, 'superseded');
  assert.equal(work.plans.get(first.id)?.plan.chapters[0].summary, '林渊第1次闯关', 'history keeps the old content');
  assert.equal(work.activePlanId, second.id);
});

test('AT-07 an unmet fact prerequisite blocks the chapter until the ledger satisfies it', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider());
  const plan = minimalPlan();
  plan.dependencies = [{ id: 'need-power', targetId: 'chapter-2', fact: { eventType: 'character_state', subjectId: 'hero', predicate: 'power', equals: 99 }, requiredness: 'must', description: '林渊战力达到 99' }];
  const work = await createReadyWork(workflow, '前置事实', plan);
  await writeChapter(workflow, work.id, 1, 0);
  const blockers = await workflow.readiness(work.id, 2);
  assert.deepEqual(blockers.map((blocker) => blocker.code), ['PLAN_PREREQUISITE_UNMET']);
  assert.match(blockers[0].message, /林渊战力达到 99/);
  await assert.rejects(() => workflow.generate(work.id, 2, 'blocked'), (error: unknown) => error instanceof ReadinessError && error.code === 'PLAN_PREREQUISITE_UNMET');

  const satisfiable = minimalPlan();
  satisfiable.dependencies = [{ id: 'need-power', targetId: 'chapter-2', fact: { eventType: 'character_state', subjectId: 'hero', predicate: 'power', equals: 1 }, requiredness: 'must', description: '林渊战力达到 1' }];
  await approveMinimalPlan(workflow, work.id, satisfiable);
  assert.deepEqual(await workflow.readiness(work.id, 2), []);
  assert.match(effectiveBrief(work, 2)?.brief.dependsOn[0].evidence ?? '', /第 1 章/);
});

for (const sourceKind of ['chapter', 'milestone', 'inferred-milestone'] as const) {
  for (const eventChapter of [4, 6]) test(`rewriting an earlier chapter cannot borrow chapter ${eventChapter} ${sourceKind} completion for prerequisites`, async () => {
    const sourceId = sourceKind === 'chapter' ? 'chapter-2' : 'setup';
    const subjects = sourceKind === 'inferred-milestone' ? ['chapter-1', 'chapter-2'] : [sourceId];
    const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider(chapter => chapter === eventChapter
      ? subjects.map(subjectId => ({ eventType: 'plot_progress', subjectId, predicate: 'status', value: { status: 'realized' }, evidence: `第${eventChapter}章才拿到先前未得的通行文书` })) : []));
    const plan = minimalPlan();
    plan.milestones = [
      { id: 'setup', title: '取得文书', kind: 'turn', startChapter: 1, endChapter: 2, setup: ['申请'], cost: '押金', outcome: '获准通行' },
      { id: 'journey', title: '凭文书出航', kind: 'climax', startChapter: 4, endChapter: 5, setup: ['文书已到手'], cost: '航费', outcome: '抵港' },
    ];
    const work = await createReadyWork(workflow, '前置不得读取未来', plan);
    for (let chapter = 1; chapter <= 6; chapter++) await writeChapter(workflow, work.id, chapter, work.stateRevision);
    plan.dependencies = [{ id: 'needs-permit', targetId: 'journey', sourceId, requiredness: 'must', description: '出航前实际取得文书' }];
    const revision = await approveMinimalPlan(workflow, work.id, plan);
    const before = JSON.stringify({ versions: [...work.versions], events: [...work.events] });
    assert.equal(planRealization(work, revision).nodes.find(node => node.nodeId === sourceId)?.status, 'realized', 'the all-book overview still records later completion');
    assert.equal(milestonePrerequisites(work, revision, 'journey')[0].satisfied, false, 'future evidence cannot satisfy the earlier milestone');
    assert.equal(effectiveBrief(work, 4)?.brief.dependsOn[0].satisfied, false);
    assert.equal(effectiveBrief(work, 5)?.brief.dependsOn[0].satisfied, false, 'a milestone prerequisite is due before its start, not halfway through');
    await assert.rejects(() => workflow.generate(work.id, 4, 'rewrite-before-permit'),
      (error: unknown) => error instanceof ReadinessError && error.blockers.some(blocker => blocker.code === 'PLAN_PREREQUISITE_UNMET'));
    assert.equal(JSON.stringify({ versions: [...work.versions], events: [...work.events] }), before, 'checking an earlier chapter preserves later history');
  });
}

test('fact prerequisites also remain due before the start of a multi-chapter milestone', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider(chapter => chapter === 4
    ? [{ eventType: 'character_state', subjectId: 'hero', predicate: 'permit', value: true, evidence: '第四章才收到文书' }] : []));
  const plan = minimalPlan();
  plan.milestones = [{ id: 'journey', title: '凭文书出航', kind: 'climax', startChapter: 4, endChapter: 5, setup: ['已取得文书'], cost: '航费', outcome: '抵港' }];
  const work = await createReadyWork(workflow, '跨章前置时间一致', plan);
  for (let chapter = 1; chapter <= 5; chapter++) await writeChapter(workflow, work.id, chapter, work.stateRevision);
  plan.dependencies = [{ id: 'needs-permit', targetId: 'journey', fact: { eventType: 'character_state', subjectId: 'hero', predicate: 'permit', equals: true }, requiredness: 'must', description: '出航前取得文书' }];
  const revision = await approveMinimalPlan(workflow, work.id, plan);
  assert.equal(milestonePrerequisites(work, revision, 'journey')[0].satisfied, false);
  assert.equal(effectiveBrief(work, 5)?.brief.dependsOn[0].satisfied, false);
  await assert.rejects(() => workflow.generate(work.id, 5, 'rewrite-mid-journey'),
    (error: unknown) => error instanceof ReadinessError && error.blockers.some(blocker => blocker.code === 'PLAN_PREREQUISITE_UNMET'));
});

test('a later reversal cannot retroactively invalidate an earlier satisfied prerequisite', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider(chapter => [2, 6].includes(chapter)
    ? [{ eventType: 'plot_progress', subjectId: 'chapter-2', predicate: 'status', value: { status: chapter === 2 ? 'realized' : 'diverged' }, evidence: chapter === 2 ? '第二章实际收到文书' : '第六章文书才被撤回' }] : []));
  const plan = minimalPlan();
  const work = await createReadyWork(workflow, '后果不改写前置历史', plan);
  for (let chapter = 1; chapter <= 6; chapter++) await writeChapter(workflow, work.id, chapter, work.stateRevision);
  plan.dependencies = [{ id: 'needs-permit', targetId: 'chapter-4', sourceId: 'chapter-2', requiredness: 'must', description: '出航前取得文书' }];
  const revision = await approveMinimalPlan(workflow, work.id, plan);
  assert.equal(planRealization(work, revision).nodes.find(node => node.nodeId === 'chapter-2')?.status, 'diverged');
  const prerequisite = effectiveBrief(work, 4)!.brief.dependsOn[0];
  assert.equal(prerequisite.satisfied, true);
  assert.match(prerequisite.evidence ?? '', /第二章实际收到文书/);
  assert.deepEqual(await workflow.readiness(work.id, 4), []);
});

test('AT-09/24 approving a new plan makes an open candidate stale and leaves adopted text untouched', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider());
  const work = await createReadyWork(workflow, '计划变更');
  const adopted = await writeChapter(workflow, work.id, 1, 0);
  const open = await workflow.generate(work.id, 2, 'open-candidate');
  assert.equal(open.planRevisionId, work.activePlanId);
  assert.equal(open.brief?.outlineId, 'chapter-2');
  await workflow.check(work.id, open.id, [passChecker]);

  const changed = minimalPlan();
  changed.chapters[1] = { ...changed.chapters[1], summary: '林渊改走另一条路' };
  await approveMinimalPlan(workflow, work.id, changed);
  await assert.rejects(() => workflow.adopt(work.id, open.id, 1), StaleCandidateError);
  assert.equal(work.currentVersion(1)?.id, adopted.version.id);
  assert.equal(work.currentVersion(1)?.content, chapterBody(1));
  assert.equal(work.currentVersion(2), undefined);
});

test('a confirmed brief keeps author edits and asks for reconfirmation once the story state it was based on changes', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider());
  const work = await createReadyWork(workflow, '任务卡');
  const derived = effectiveBrief(work, 2);
  assert.equal(derived?.brief.status, 'derived');
  assert.ok(derived?.brief.mustNotHappen.some((line) => line.includes('第 3 章')), 'later outlines must not happen early');

  const confirmed = await workflow.confirmBrief(work.id, 2, { location: '后山', mustNotHappen: ['不许暴露身份'] });
  assert.equal(effectiveBrief(work, 2)?.brief.location, '后山');
  assert.equal(effectiveBrief(work, 2)?.needsConfirmation, false);
  assert.equal(confirmed.status, 'author_confirmed');

  await writeChapter(workflow, work.id, 1, 0);
  assert.equal(effectiveBrief(work, 2)?.needsConfirmation, true);
  assert.deepEqual((await workflow.readiness(work.id, 2)).map((blocker) => blocker.code), ['BRIEF_NEEDS_CONFIRMATION']);
  await workflow.confirmBrief(work.id, 2, { location: '后山' });
  assert.deepEqual(await workflow.readiness(work.id, 2), []);
  const candidate = await workflow.generate(work.id, 2, 'with-brief');
  assert.equal(candidate.brief?.location, '后山');
});

test('realization separates insufficient, realized, overdue and not-yet-due, and next-chapter shows what the climax still lacks', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider((chapterNumber) => chapterNumber === 2
    ? [{ eventType: 'plot_progress', subjectId: 'chapter-2', predicate: 'status', value: { status: 'realized' }, evidence: '林渊闯过第二关' }]
    : []));
  const plan = minimalPlan();
  plan.milestones = [
    { id: 'turn-1', title: '初遇苏晚', kind: 'turn', startChapter: 1, endChapter: 1, setup: ['同门'], cost: '无', outcome: '结识' },
    { id: 'climax-1', title: '守城之战', kind: 'climax', startChapter: 5, endChapter: 6, setup: ['拿到青云剑'], cost: '重伤', outcome: '守住宗门' },
  ];
  plan.dependencies = [{ id: 'need-sword', targetId: 'climax-1', sourceId: 'chapter-3', requiredness: 'must', description: '第 3 章拿到青云剑' }];
  const work = await createReadyWork(workflow, '落实对照', plan);
  await writeChapter(workflow, work.id, 1, 0);

  const next = await workflow.prepareNextChapter(work.id);
  assert.equal(next.chapterNumber, 2);
  assert.deepEqual(next.blockers, []);
  assert.equal(next.brief?.brief.outlineId, 'chapter-2');
  assert.equal(next.volume?.id, 'vol-1');
  assert.equal(next.nextClimax?.milestone.id, 'climax-1');
  assert.deepEqual(next.nextClimax?.missing, ['第 3 章拿到青云剑']);

  await writeChapter(workflow, work.id, 2, 1);
  const nodes = new Map(planRealization(work, work.plans.get(work.activePlanId!)!).nodes.map((node) => [node.nodeId, node]));
  assert.equal(nodes.get('chapter-1')?.status, 'insufficient');
  assert.equal(nodes.get('chapter-2')?.status, 'realized');
  assert.equal(nodes.get('chapter-2')?.evidence[0].text, '林渊闯过第二关');
  assert.equal(nodes.get('chapter-3')?.status, 'unrealized');
  assert.equal(nodes.get('chapter-3')?.due, false);
  assert.equal(nodes.get('turn-1')?.overdue, true);
  assert.equal(nodes.get('climax-1')?.due, false);
  assert.equal(nodes.get('climax-1')?.overdue, false);
});

test('a milestone crossing the rolling outline window cannot complete or unlock dependencies from its outlined prefix', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider(chapterNumber => [
    { eventType: 'plot_progress', subjectId: `chapter-${chapterNumber}`, predicate: 'status', value: { status: 'realized' }, evidence: `第${chapterNumber}章任务已落实` },
  ]));
  const work = await workflow.createWork('跨窗口节点', readyCovenant());
  await lockMinimalDesign(workflow, work.id);
  await workflow.saveStoryBible(work.id, { ...work.storyBible!, volumes: work.storyBible!.volumes.map(volume => ({ ...volume, plannedChapterCount: 60 })) });
  await workflow.reviewStoryBible(work.id);
  await workflow.lockStoryBible(work.id);
  const plan = minimalPlan(60, { outlined: 50 });
  plan.milestones = [
    { id: 'window-climax', title: '跨窗口救援', kind: 'climax', startChapter: 47, endChapter: 53, setup: ['救援准备'], cost: '伤势与工食', outcome: '撤离并完成安置' },
    { id: 'after-rescue', title: '安置后出航', kind: 'turn', startChapter: 54, endChapter: 55, setup: ['已安置'], cost: '船票', outcome: '出航' },
  ];
  plan.dependencies = [{ id: 'needs-whole-rescue', sourceId: 'window-climax', targetId: 'after-rescue', requiredness: 'must', description: '撤离和安置均须完成' }];
  let revision = await approveMinimalPlan(workflow, work.id, plan);
  for (let chapter = 1; chapter <= 50; chapter += 1) await writeChapter(workflow, work.id, chapter, work.stateRevision);
  const node = () => planRealization(work, revision).nodes.find(item => item.nodeId === 'window-climax')!;
  assert.equal(node().status, 'unrealized');
  assert.equal(node().due, true);
  assert.equal(node().overdue, false);
  assert.equal(node().evidence.length, 4, 'keep evidence for the completed prefix without claiming the whole milestone');
  assert.equal(milestonePrerequisites(work, revision, 'after-rescue')[0].satisfied, false);

  const expanded = structuredClone(revision.plan);
  expanded.chapters.push(...[51, 52, 53].map(chapter => minimalOutline(chapter)));
  revision = await approveMinimalPlan(workflow, work.id, expanded);
  assert.equal(node().status, 'unrealized', 'outlining the remainder is not prose completion');
  for (let chapter = 51; chapter <= 53; chapter += 1) {
    await writeChapter(workflow, work.id, chapter, work.stateRevision);
    assert.equal(node().status, chapter === 53 ? 'realized' : 'unrealized');
  }
  assert.equal(milestonePrerequisites(work, revision, 'after-rescue')[0].satisfied, true);
  for (const duplicate of [false, true]) {
    const incomplete = structuredClone(revision);
    incomplete.plan.chapters = incomplete.plan.chapters.filter(outline => outline.chapterNumber !== 49);
    if (duplicate) incomplete.plan.chapters.push({ ...incomplete.plan.chapters.find(outline => outline.chapterNumber === 48)! });
    assert.equal(planRealization(work, incomplete).nodes.find(item => item.nodeId === 'window-climax')!.status, 'unrealized', 'a hole or duplicate cannot prove full range coverage');
    assert.equal(milestonePrerequisites(work, incomplete, 'after-rescue')[0].satisfied, false);
  }
});

test('plans are generated in outline groups that see earlier groups; regenerating a range leaves other outlines unchanged', async () => {
  const calls: Array<{ from: number; to: number; before: number[]; after: number[] }> = [];
  let round = 'v1';
  const planProvider: PlanProvider = {
    generatePlanSkeleton: async ({ targetChapterCount, volumeCount }) => {
      const { chapters: _chapters, ...skeleton } = minimalPlan(targetChapterCount, { volumeSize: Math.ceil(targetChapterCount / volumeCount), outlined: 0 });
      return skeleton;
    },
    generateChapterOutlines: async ({ from, to, before, after }) => {
      calls.push({ from, to, before: before.map((item) => item.chapterNumber), after: after.map((item) => item.chapterNumber) });
      return Array.from({ length: to - from + 1 }, (_, index): ChapterOutline => ({ ...minimalOutline(from + index), summary: `${round} 第${from + index}章`, volumeId: 'wrong', source: 'model' }));
    },
  };
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider(), undefined, { planProvider });
  const work = await workflow.createWork('分组章纲', readyCovenant());
  await lockMinimalDesign(workflow, work.id);
  const volume = work.storyBible!.volumes[0];
  await workflow.saveStoryBible(work.id, { ...work.storyBible!, volumes: [1, 2, 3].map((order) => ({ ...volume, id: `vol-${order}`, order, plannedChapterCount: 10 })) });
  await workflow.reviewStoryBible(work.id);
  await workflow.lockStoryBible(work.id);

  const generated = await workflow.generatePlan(work.id, { targetChapterCount: 30, volumeCount: 3 });
  assert.equal(generated.status, 'proposed', 'generation never approves');
  assert.deepEqual(calls.map((call) => [call.from, call.to]), [[1, 10], [11, 20], [21, 30]]);
  assert.deepEqual(calls[1].before, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(generated.plan.chapters.find((item) => item.chapterNumber === 15)?.volumeId, 'vol-2', 'volume ids follow the planned ranges');
  assert.equal((await workflow.reviewPlan(work.id, generated.id)).passed, true);

  round = 'v2';
  calls.length = 0;
  const regenerated = await workflow.generateOutlines(work.id, { baseRevisionId: generated.id, from: 11, to: 15, authorRequest: '冲突更狠' });
  assert.equal(regenerated.source, 'mixed');
  assert.deepEqual(calls.map((call) => [call.from, call.to]), [[11, 15]]);
  assert.deepEqual(calls[0].after, [16, 17, 18, 19, 20]);
  for (const outline of regenerated.plan.chapters) {
    const before = generated.plan.chapters.find((item) => item.chapterNumber === outline.chapterNumber);
    if (outline.chapterNumber >= 11 && outline.chapterNumber <= 15) assert.equal(outline.summary, `v2 第${outline.chapterNumber}章`);
    else assert.deepEqual(outline, before);
  }
  await assert.rejects(() => workflow.generateOutlines(work.id, { baseRevisionId: generated.id, from: 1, to: 5 }), PlanConflictError);
  await assert.rejects(() => workflow.generateOutlines(work.id, { baseRevisionId: regenerated.id, from: 1, to: 25 }), PlanGateError);
});

for (const mode of ['plan', 'outlines'] as const) for (const change of ['world', 'bible', 'covenant', 'adoption'] as const) {
  test(`${mode} generation rejects ${change} changes made while an outline batch is pending`, async () => {
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    let batches = 0;
    let seenCost: string | undefined;
    const planProvider: PlanProvider = {
      generatePlanSkeleton: async () => { const { chapters, ...skeleton } = minimalPlan(30); return skeleton; },
      generateChapterOutlines: async ({ from, to, worldPack }) => {
        batches++; started(); await waiting;
        seenCost = worldPack?.realms[0].cost;
        return Array.from({ length: to - from + 1 }, (_, i) => minimalOutline(from + i));
      },
    };
    const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider(), undefined, { planProvider });
    const work = await createReadyWork(workflow, '生成期间的基线变更');
    const base = await workflow.savePlan(work.id, { baseRevisionId: work.activePlanId, plan: minimalPlan(30) });
    const beforePlans = JSON.stringify([...work.plans]);
    const oldCost = work.worldPack!.realms[0].cost;
    const pending = mode === 'plan' ? workflow.generatePlan(work.id, { targetChapterCount: 30, volumeCount: 1 })
      : workflow.generateOutlines(work.id, { baseRevisionId: base.id, from: 1, to: 20 });
    await entered;
    if (change === 'world') await workflow.editSettings(work.id, draft => { draft.worldPack!.realms[0].cost = '新规则必须另付十年寿元'; });
    if (change === 'bible') await workflow.saveStoryBible(work.id, { ...work.storyBible!, coreConflict: '修改后的主线' });
    if (change === 'covenant') await workflow.updateWork(work.id, { title: work.title, covenant: { ...work.covenant, mustKeep: '不得违背的新约定' } });
    if (change === 'adoption') await writeChapter(workflow, work.id, 1, 0);
    release();
    await assert.rejects(pending, PlanConflictError);
    assert.equal(batches, 1, 'stop before paying for another batch under an obsolete baseline');
    assert.equal(seenCost, oldCost, 'the provider sees a frozen input, including in-memory repository objects');
    assert.equal(JSON.stringify([...work.plans]), beforePlans, 'do not rebind stale model output to the new design');
    assert.equal(work.currentVersion(1)?.content, change === 'adoption' ? chapterBody(1) : undefined);
  });
}

for (const mode of ['plan', 'outlines'] as const) {
  test(`${mode} generation rechecks the baseline inside the queued commit transaction`, async () => {
    const repository = new InMemoryWorkRepository();
    const planProvider: PlanProvider = {
      generatePlanSkeleton: async () => { const { chapters, ...skeleton } = minimalPlan(); return skeleton; },
      generateChapterOutlines: async ({ from, to }) => Array.from({ length: to - from + 1 }, (_, i) => minimalOutline(from + i)),
    };
    const workflow = new ChapterWorkflow(repository, scriptedProvider(), undefined, { planProvider });
    const work = await createReadyWork(workflow, '提交前并发改约定');
    const beforePlans = JSON.stringify([...work.plans]);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const editor = repository.transaction(work.id, async ({ work: draft }) => {
      await waiting;
      draft.recordCovenant({ ...draft.covenant, mustKeep: '正在提交的新约定' });
      draft.constraintRevision++;
    });
    const pending = mode === 'plan' ? workflow.generatePlan(work.id, { targetChapterCount: 10, volumeCount: 1 })
      : workflow.generateOutlines(work.id, { baseRevisionId: work.activePlanId!, from: 1, to: 10 });
    // Let the model and read checks finish while the earlier editor owns the
    // transaction queue. Its change becomes visible only when we release it.
    await new Promise<void>(resolve => setImmediate(resolve));
    release(); await editor;
    await assert.rejects(pending, PlanConflictError);
    assert.equal(JSON.stringify([...work.plans]), beforePlans);
    assert.equal(work.covenant.mustKeep, '正在提交的新约定');
  });
}

test('approving another plan while generation waits invalidates the previous adopted-fact baseline', async () => {
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  let outlineCalls = 0;
  const planProvider: PlanProvider = {
    generatePlanSkeleton: async () => { started(); await waiting; const { chapters, ...skeleton } = minimalPlan(); return skeleton; },
    generateChapterOutlines: async () => { outlineCalls++; return []; },
  };
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider(), undefined, { planProvider });
  const work = await createReadyWork(workflow, '批准版在规划期间变化');
  const next = await workflow.savePlan(work.id, { baseRevisionId: work.activePlanId, plan: minimalPlan() });
  await workflow.reviewPlan(work.id, next.id);
  const pending = workflow.generatePlan(work.id, { targetChapterCount: 10, volumeCount: 1 });
  await entered;
  await workflow.approvePlan(work.id, next.id);
  const approvedHistory = JSON.stringify([...work.plans]);
  release();
  await assert.rejects(pending, PlanConflictError);
  assert.equal(outlineCalls, 0, 'stop after the obsolete skeleton without generating outlines');
  assert.equal(JSON.stringify([...work.plans]), approvedHistory);
  assert.equal(work.activePlanId, next.id);
});

test('AT-41 a manual character sharing a Bible name is reported, linked explicitly, and never merged silently', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider());
  const work = await createReadyWork(workflow, '统一人物');
  const person = { aliases: [], role: 'protagonist' as const, identity: '', goal: '', principles: '', voice: '', notes: '' };
  const manual = await workflow.editSettings(work.id, (draft) => addCharacter(draft, { ...person, name: '林渊' }));
  const before = unifiedCharacters(work);
  assert.deepEqual(before.conflicts.map((conflict) => conflict.kind), ['same_name_unlinked']);
  assert.equal(before.entities.filter((entity) => entity.name === '林渊').length, 2);

  await assert.rejects(() => workflow.editSettings(work.id, (draft) => addCharacter(draft, { ...person, name: '路人', canonicalId: 'ghost' })), SettingConflictError);
  await workflow.editSettings(work.id, (draft) => { draft.characters.get(manual.id)!.canonicalId = 'hero'; });
  const after = unifiedCharacters(work);
  assert.deepEqual(after.conflicts, []);
  const merged = after.entities.filter((entity) => entity.name === '林渊');
  assert.equal(merged.length, 1);
  assert.deepEqual([...merged[0].sources].sort(), ['manual', 'story_bible']);
});

test('lock policies: a baseline lock lets events change the relationship, event_change_forbidden blocks it', async () => {
  let relationshipId = '';
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider(() => [{ eventType: 'relationship_change', subjectId: relationshipId, predicate: 'value', value: '反目', evidence: '割袍断义' }]));
  const work = await createReadyWork(workflow, '锁策略');
  const person = { aliases: [], role: 'major' as const, identity: '', goal: '', principles: '', voice: '', notes: '' };
  relationshipId = await workflow.editSettings(work.id, (draft) => {
    const master = addCharacter(draft, { ...person, name: '师父' });
    const pupil = addCharacter(draft, { ...person, name: '徒弟' });
    const relationship = addSettingRelationship(draft, { fromCharacterId: pupil.id, toCharacterId: master.id, kind: '师徒', value: '亲厚', layer: 'objective', note: '' });
    updateSettingRelationship(draft, relationship.id, { lockPolicy: 'baseline_locked' });
    return relationship.id;
  });
  assert.equal(work.relationships.get(relationshipId)?.locked, true);

  const allowed = await workflow.generate(work.id, 1, 'baseline');
  await workflow.check(work.id, allowed.id, [canonConsistencyChecker]);
  assert.equal(work.candidates.get(allowed.id)?.checks[0].status, 'passed', JSON.stringify(work.candidates.get(allowed.id)?.checks));

  await workflow.editSettings(work.id, (draft) => updateSettingRelationship(draft, relationshipId, { lockPolicy: 'event_change_forbidden' }));
  const blocked = await workflow.generate(work.id, 1, 'forbidden');
  await workflow.check(work.id, blocked.id, [canonConsistencyChecker]);
  assert.equal(work.candidates.get(blocked.id)?.checks[0].status, 'failed');
  assert.match(JSON.stringify(work.candidates.get(blocked.id)?.checks[0]), /locked relationship/);
});

test('covenant edits keep the author\'s words, mark open candidates stale and flag the active plan for re-check', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider());
  const work = await createReadyWork(workflow, '约定修订');
  const open = await workflow.generate(work.id, 1, 'before-covenant');
  const { impact } = await workflow.updateWorkWithImpact(work.id, {
    title: work.title,
    covenant: { ...work.covenant, protagonistGoal: '守住青州', readingExperience: '每卷一次大翻盘' },
    authorText: '我想让主角每卷都翻盘一次',
    acceptedSuggestions: ['阅读体验：每卷一次大翻盘'],
  });
  assert.equal(impact.covenantChanged, true);
  assert.deepEqual(impact.staleCandidateIds, [open.id]);
  assert.equal(impact.planToRecheck, work.activePlanId);
  assert.equal(work.covenantHistory.length, 2);
  assert.equal(work.covenantHistory.at(-1)?.authorText, '我想让主角每卷都翻盘一次');
  assert.deepEqual(work.covenantHistory.at(-1)?.acceptedSuggestions, ['阅读体验：每卷一次大翻盘']);
  assert.equal(work.covenantHistory[0].covenant.readingExperience, '', 'earlier revisions are kept as they were');
});

test('a story bible rewrite never reuses a revision number and makes the approved plan outdated', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider());
  const work = await createReadyWork(workflow, '设计变更');
  const used = new Set([...work.designHistory.values()].filter((item) => item.kind === 'story_bible').map((item) => item.revision));
  await workflow.saveStoryBible(work.id, { ...work.storyBible!, coreConflict: '宗门内乱', revision: 1 });
  assert.ok(!used.has(work.storyBible!.revision), 'the client-sent revision number is not trusted');
  await workflow.reviewStoryBible(work.id);
  await workflow.lockStoryBible(work.id);
  assert.deepEqual((await workflow.readiness(work.id, 1)).map((blocker) => blocker.code), ['PLAN_OUTDATED']);
  const plan: BookPlan = minimalPlan();
  await approveMinimalPlan(workflow, work.id, plan);
  assert.deepEqual(await workflow.readiness(work.id, 1), []);
});

test('review and generation reject mismatched volume boundaries even at matching design revisions', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider());
  const work = await createReadyWork(workflow, '统一分卷');
  const plan = minimalPlan(10, { volumeSize: 5 });
  // Keep total and volume count equal: only the boundary is wrong.
  const volume = work.storyBible!.volumes[0];
  await workflow.saveStoryBible(work.id, { ...work.storyBible!, volumes: [
    { ...volume, plannedChapterCount: 4 },
    { ...volume, id: 'vol-2', order: 2, plannedChapterCount: 6 },
  ] });
  const saved = await workflow.savePlan(work.id, { plan, baseRevisionId: work.activePlanId });
  const review = await workflow.reviewPlan(work.id, saved.id);
  assert.equal(review.passed, false);
  assert.ok(review.issues.some((issue) => issue.code === 'DESIGN_MISMATCH' && issue.volumeId === 'vol-1'));
  await assert.rejects(() => workflow.approvePlan(work.id, saved.id), PlanGateError);
  saved.status = 'approved'; work.activePlanId = saved.id; // Legacy data predating this gate.
  assert.ok((await workflow.readiness(work.id, 1)).some((blocker) => blocker.code === 'PLAN_OUTDATED'));
});

test('plan approval rechecks blocking design questions added after review', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), scriptedProvider());
  const work = await createReadyWork(workflow, '不以延后代替解决');
  const saved = await workflow.savePlan(work.id, { plan: minimalPlan(), baseRevisionId: work.activePlanId });
  assert.equal((await workflow.reviewPlan(work.id, saved.id)).passed, true);
  work.worldPack!.unresolvedQuestions.push({ id: 'power', question: '冷却矛盾', blocking: true, status: 'deferred' });
  await assert.rejects(() => workflow.approvePlan(work.id, saved.id), /冷却矛盾/);
  assert.equal((await workflow.reviewPlan(work.id, saved.id)).passed, false);
});
