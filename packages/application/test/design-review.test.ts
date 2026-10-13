import { createDesignReviewRun, designReviewStageInput } from '../../../novel-service-core/src/design-review-run.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChapterWorkflow, InMemoryWorkRepository, type DesignProvider } from '../src/index.ts';
import { designReviewAreas, designReviewHash, designReviewInput, designReviewOverview, recordDesignReview, validateDesignReview } from '../../../novel-service-core/src/design-review.ts';
import { passChecker } from '../../../novel-service-core/src/core.ts';
import { createReadyWork, fixtureDesignReview, minimalWorldPack } from './fixtures.ts';

const reviewer: DesignProvider = { generateWorldPack: async () => { throw new Error('unused'); }, generateStoryBible: async () => { throw new Error('unused'); }, reviewDesignContent: async (input) => fixtureDesignReview(input) };
const writer = { generateChapter: () => ({ content: '测试正文', proposedEvents: [] }) };

test('design review sees contradictory book-level promises even when chapter outlines omit them', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer, reviewer);
  const work = await createReadyWork(workflow);
  const plan = work.plans.get(work.activePlanId!)!.plan;
  Object.assign(plan, {
    mainConflict: '使用只有神海能施展的逆命真解', theme: '代价不可逆',
    protagonistArc: '开篇淬体直接施展逆命真解', endingDirection: '免费返还已燃尽的寿元',
    keyTurns: ['第一卷跳过玄府进入神海'],
  });
  for (const area of designReviewAreas) {
    const input = designReviewInput(work, area);
    const source = input.sources.find((item) => item.id === 'plan/overview')!;
    const overview = JSON.parse(source.text);
    for (const field of ['mainConflict', 'theme', 'protagonistArc', 'endingDirection', 'keyTurns'] as const) {
      assert.deepEqual(overview[field], plan[field], `${area} must receive the original ${field}`);
    }
    const report = fixtureDesignReview(input);
    report.checks[0] = { ...report.checks[0], verdict: 'revise', explanation: '终局取消了不可逆代价',
      evidence: [{ sourceId: source.id, quote: '免费返还已燃尽的寿元' }], revisionAdvice: '撤销免费返寿的结局承诺' };
    assert.equal(recordDesignReview(work, input, report).status, 'needs_revision');
  }
});

test('power review includes late chapter costs instead of reviewing only the power definitions', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer, reviewer);
  const work = await createReadyWork(workflow);
  const plan = work.plans.get(work.activePlanId!)!.plan;
  plan.chapters = Array.from({ length: 100 }, (_, index) => ({ ...plan.chapters[0], id: `chapter-${index + 1}`, chapterNumber: index + 1 }));
  plan.chapters[96].cost = '仅余三年却再次消耗十年寿元';
  const input = designReviewInput(work, 'power');
  assert.equal(input.sources.filter((source) => source.id.startsWith('plan/chapters/')).length, 100);
  assert.match(input.sources.find((source) => source.id === 'plan/chapters/97')!.text, /仅余三年却再次消耗十年寿元/);
  const storyInput = designReviewInput(work, 'story');
  assert.match(storyInput.sources.find((source) => source.id === 'world/resources/resource')!.text, /不增加寿命/);
  plan.chapters[96].summary = '材料'.repeat(130000);
  const oversized = designReviewInput(work, 'power');
  assert.ok(oversized.sources.find(source => source.id === 'plan/chapters/97')!.text.includes(plan.chapters[96].summary));
  const run = createDesignReviewRun(oversized);
  assert.ok(run.stages.some(stage => stage.kind === 'cross'));
  for (const stage of run.stages.filter(stage => stage.kind !== 'synthesis')) assert.ok(JSON.stringify(designReviewStageInput(run, stage).sources).length <= 240_000);
});

test('rolling outline coverage distinguishes a contiguous opening from isolated later chapters', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer, reviewer);
  const work = await createReadyWork(workflow);
  const plan = work.plans.get(work.activePlanId!)!.plan;
  plan.targetChapterCount = 100;
  const template = plan.chapters[0];
  plan.chapters = [50, 2, 1].map(chapterNumber => ({ ...template, id: `chapter-${chapterNumber}`, chapterNumber }));
  const before = designReviewHash(work);
  for (const area of designReviewAreas) {
    const input = designReviewInput(work, area);
    const overview = JSON.parse(input.sources.find(s => s.id === 'plan/overview')!.text);
    assert.equal(overview.targetChapterCount, 100);
    assert.equal(overview.detailedThroughChapter, 2, 'chapter50 must not imply that chapters3–49 already have outlines');
    assert.deepEqual(overview.outlinedChapterNumbers, [1, 2, 50]);
    if (area !== 'world') assert.ok(input.sources.some(s => s.id === 'plan/chapters/50'), 'isolated later outlines still need review');
  }
  plan.chapters.push({ ...template, id: 'chapter-3', chapterNumber: 3 });
  assert.notEqual(designReviewHash(work), before, 'expanding the detailed horizon invalidates earlier acceptance');
  assert.equal(JSON.parse(designReviewInput(work, 'story').sources.find(s => s.id === 'plan/overview')!.text).detailedThroughChapter, 3);
  plan.chapters = [plan.chapters.find(c => c.chapterNumber === 50)!];
  assert.equal(JSON.parse(designReviewInput(work, 'story').sources.find(s => s.id === 'plan/overview')!.text).detailedThroughChapter, 0);
});

test('long-form generation requires all current design reviews and adoption cannot bypass the new gate', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer, reviewer);
  const work = await createReadyWork(workflow);
  const legacy = await workflow.generate(work.id, 1, 'before-content-gate');
  await workflow.check(work.id, legacy.id, [passChecker]);
  // An author now requests long-form production. Existing short-form candidates cannot bypass it.
  work.covenant.targetChapterCount = 100;
  assert.ok((await workflow.readiness(work.id, 1)).some((blocker) => blocker.code === 'DESIGN_REVIEW_REQUIRED'));
  await assert.rejects(() => workflow.adopt(work.id, legacy.id, 0), /内容评审未通过/);
  for (const area of designReviewAreas.slice(0, 3)) await workflow.reviewDesignContent(work.id, area);
  assert.equal(designReviewOverview(work).ready, false);
  await assert.rejects(() => workflow.generate(work.id, 1, 'blocked'), /内容评审/);
  await workflow.reviewDesignContent(work.id, 'story');
  assert.equal(designReviewOverview(work).ready, true);
  assert.deepEqual(await workflow.readiness(work.id, 1), []);
  const revision = work.constraintRevision;
  const candidate = await workflow.generate(work.id, 1, 'reviewed');
  assert.equal(candidate.generatedAgainstConstraintRevision, revision);
  work.stateRevision += 1;
  assert.equal(designReviewOverview(work).ready, true, 'new story facts do not invalidate a design-only review');
  work.worldPack!.techniques[0].cost = '无限无代价';
  assert.equal(designReviewOverview(work).ready, false, 'same-revision content changes still expire reviews');
  assert.ok(designReviewOverview(work).areas.every((item) => item.status === 'outdated'));
});

test('review cannot pass by omitting criteria, fabricating a citation or lacking evidence', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer, reviewer);
  const work = await createReadyWork(workflow);
  const input = designReviewInput(work, 'power');
  const incomplete = fixtureDesignReview(input); incomplete.checks.pop();
  assert.throws(() => validateDesignReview(input, incomplete), /覆盖全部标准/);
  const duplicate = fixtureDesignReview(input); duplicate.checks[1].criterion = duplicate.checks[0].criterion;
  assert.throws(() => validateDesignReview(input, duplicate), /覆盖全部标准/);
  const fabricated = fixtureDesignReview(input); fabricated.checks[0].evidence[0].quote = '原文没有这段话';
  assert.throws(() => recordDesignReview(work, input, fabricated), /引用不在原文/);
  const empty = fixtureDesignReview(input); empty.checks[0].evidence = [];
  assert.throws(() => recordDesignReview(work, input, empty), /原文证据/);
  assert.equal(work.designContentReviews.size, 0);
  const insufficient = fixtureDesignReview(input);
  insufficient.checks[0] = { ...insufficient.checks[0], verdict: 'insufficient', evidence: [], revisionAdvice: '补充施术后的恢复条件' };
  assert.equal(recordDesignReview(work, input, insufficient).status, 'inconclusive');
  const failed = fixtureDesignReview(input); failed.checks[0].verdict = 'revise'; failed.checks[0].revisionAdvice = '修正代价';
  assert.equal(recordDesignReview(work, input, failed).status, 'needs_revision');
  assert.equal(work.designContentReviews.size, 2);
});

test('a fresh failed review overrides an old pass without deleting history', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer, reviewer);
  const work = await createReadyWork(workflow);
  for (const area of designReviewAreas) await workflow.reviewDesignContent(work.id, area);
  const input = designReviewInput(work, 'power'); const failed = fixtureDesignReview(input);
  failed.checks[0].verdict = 'revise'; failed.checks[0].revisionAdvice = '补全越阶反制';
  recordDesignReview(work, input, failed);
  assert.equal(designReviewOverview(work).ready, false);
  assert.equal(designReviewOverview(work).areas.find((item) => item.area === 'power')?.status, 'needs_revision');
  assert.equal(work.designContentReviews.size, 5);
});

test('review calls hold no transaction and reject results for changed inputs', async () => {
  let started!: () => void; let finish!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer, { ...reviewer, reviewDesignContent: async (input) => { started(); await pending; return fixtureDesignReview(input); } });
  const work = await createReadyWork(workflow);
  const before = designReviewHash(work);
  const request = workflow.reviewDesignContent(work.id, 'power');
  await entered;
  await assert.rejects(() => workflow.reviewDesignContent(work.id, 'power'), /正在进行/);
  await workflow.saveWorldPack(work.id, { ...minimalWorldPack(), summary: '改动后的世界' });
  assert.notEqual(designReviewHash(work), before);
  finish();
  await assert.rejects(() => request, /评审期间设计或计划已变化/);
  assert.equal(work.designContentReviews.size, 0);
  await workflow.reviewDesignContent(work.id, 'power');
  assert.equal(work.designContentReviews.size, 1, 'the area can be retried after a stale result');
});

test('provider failure never creates a passing review and can be retried', async () => {
  let fail = true;
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer, { ...reviewer, reviewDesignContent: async (input) => { if (fail) throw new Error('timeout'); return fixtureDesignReview(input); } });
  const work = await createReadyWork(workflow);
  await assert.rejects(() => workflow.reviewDesignContent(work.id, 'story'), /timeout/);
  assert.equal(work.designContentReviews.size, 0);
  fail = false;
  await workflow.reviewDesignContent(work.id, 'story');
  assert.equal(work.designContentReviews.size, 1);
});

test('review does not silently truncate an oversized outline or grant authority to a new plan', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer, reviewer);
  const work = await createReadyWork(workflow);
  for (const area of designReviewAreas) await workflow.reviewDesignContent(work.id, area);
  const approved = work.plans.get(work.activePlanId!)!;
  const before = designReviewHash(work);
  const changed = await workflow.savePlan(work.id, { plan: { ...approved.plan, theme: '代价与自主选择' }, baseRevisionId: approved.id });
  await workflow.reviewPlan(work.id, changed.id);
  await workflow.approvePlan(work.id, changed.id);
  assert.notEqual(designReviewHash(work), before);
  assert.equal(designReviewOverview(work).ready, false);
  changed.plan.chapters[0].summary = '材料'.repeat(130000);
  const run = createDesignReviewRun(designReviewInput(work, 'story'));
  assert.ok(run.stages.length > 1);
  assert.equal(designReviewOverview(work).ready, false);
  assert.equal(work.designContentReviews.size, 4);
});

test('a proposal can be reviewed before approval without approving it or authorizing the active plan', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer, reviewer);
  const work = await createReadyWork(workflow);
  const previousId = work.activePlanId!;
  const previous = work.plans.get(previousId)!;
  const proposal = await workflow.savePlan(work.id, { plan: { ...previous.plan, theme: '新的三卷提案' }, baseRevisionId: previousId });
  for (const area of designReviewAreas) {
    const report = await workflow.reviewDesignContent(work.id, area);
    assert.equal(report.scope.planRevisionId, proposal.id, 'the default review target is the latest proposal');
  }
  assert.equal(proposal.status, 'proposed');
  assert.equal(work.activePlanId, previousId);
  assert.equal(designReviewOverview(work).ready, false, 'a proposal report cannot approve the active plan');
  assert.equal(designReviewOverview(work, proposal.id).ready, true);
  await workflow.reviewPlan(work.id, proposal.id);
  await workflow.approvePlan(work.id, proposal.id);
  assert.equal(designReviewOverview(work).ready, true, 'approval of the exact reviewed proposal can use its content reviews');
  assert.throws(() => designReviewInput(work, 'world', previousId), /已被替代/);
});

test('a first plan proposal needs no approved predecessor to receive content review', async () => {
  const workflow = new ChapterWorkflow(new InMemoryWorkRepository(), writer, reviewer);
  const work = await createReadyWork(workflow);
  const proposal = work.plans.get(work.activePlanId!)!;
  proposal.status = 'proposed'; work.activePlanId = undefined;
  const report = await workflow.reviewDesignContent(work.id, 'world');
  assert.equal(report.scope.planRevisionId, proposal.id);
  assert.equal(work.activePlanId, undefined);
  assert.equal(designReviewOverview(work).ready, false);
});
