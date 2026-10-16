import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ChapterWorkflow, InMemoryWorkRepository, type DesignProvider, type WorkTransaction } from '../src/index.ts';
import { createReadyWork } from './fixtures.ts';
import { designReviewInput, designReviewOverview, designReviewRubrics, type DesignReviewInput, type DesignReviewResult } from '../../../novel-service-core/src/design-review.ts';
import { createDesignReviewRun, designReviewStageInput, acceptDesignReviewStage, completeDesignReviewRun } from '../../../novel-service-core/src/design-review-run.ts';
import { designReviewReportEnvelopeSize, renderDesignReviewReport } from '../../../novel-service-core/src/design-review-report.ts';
import { designReviewResultSchema } from 'novel-studio-contracts';

const writer = { generateChapter: () => ({ content: 'unused', proposedEvents: [] }) };
export const stagePass = (input: DesignReviewInput): DesignReviewResult => ({ summary: '本批材料已核', checks: Object.keys(input.rubric).map(criterion => ({ criterion, verdict: 'pass', explanation: '依据本批原文', evidence: [{ sourceId: input.sources[0].id, quote: input.sources[0].text.slice(0, 40) }], revisionAdvice: '' })) });
const provider: DesignProvider = { generateWorldPack: async () => { throw Error('unused'); }, generateStoryBible: async () => { throw Error('unused'); }, reviewDesignContent: async input => stagePass(input) };
const largeInput = (): DesignReviewInput => ({ area: 'story', scope: { worldPackRevision: 1, storyBibleRevision: 1, planRevisionId: 'p', planRevision: 1 }, inputHash: 'a'.repeat(64), rubric: { timeline: '检查日历' }, sources: [{ id: 'early', text: '初期无寿源。' + '😀\n"\\'.repeat(30000) }, { id: 'late', text: '后期凭空增加寿元。' + '长篇原文'.repeat(28000) }] });

test('large sources retain every character and every cross-partition pair within capacity', () => {
  const input = largeInput(), run = createDesignReviewRun(input);
  for (const source of input.sources) {
    const units = run.units.filter(u => u.sourceId === source.id);
    assert.equal(units.map(u => source.text.slice(u.start, u.end)).join(''), source.text);
    assert.equal(units[0].start, 0); assert.equal(units.at(-1)!.end, source.text.length);
    units.forEach((u, i) => { if (i) assert.equal(u.start, units[i - 1].end); });
  }
  const batches = run.stages.filter(s => s.kind === 'batch');
  assert.ok(batches.length > 2);
  assert.equal(run.stages.filter(s => s.kind === 'cross').length, batches.length * (batches.length - 1) / 2);
  for (let a = 0; a < batches.length; a++) for (let b = a + 1; b < batches.length; b++) {
    assert.ok(run.stages.some(s => s.kind === 'cross' && [...batches[a].unitIds, ...batches[b].unitIds].every(id => s.unitIds.includes(id))));
  }
  for (const stage of run.stages) {
    const input = designReviewStageInput(run, stage);
    assert.ok(JSON.stringify(input.sources).length <= 240_000);
    acceptDesignReviewStage(run, stage, stagePass(input));
  }
  assert.equal(completeDesignReviewRun(run).result.checks[0].verdict, 'pass');
  run.stages.splice(1, 1);
  assert.throws(() => completeDesignReviewRun(run), /覆盖或跨批检查未完成/);
});

test('legacy v26: a contradiction spanning distant partitions cannot be erased by synthesis', () => {
  const run = createDesignReviewRun(largeInput(), undefined, 26);
  let conflictFound = false;
  for (const stage of run.stages) {
    const input = designReviewStageInput(run, stage), result = stagePass(input);
    if (stage.kind === 'cross' && input.sources.some(s => s.text.includes('初期无寿源')) && input.sources.some(s => s.text.includes('后期凭空增加寿元'))) {
      conflictFound = true;
      result.checks[0] = { ...result.checks[0], verdict: 'revise', explanation: '后期寿元没有来源', revisionAdvice: '补足真实寿源或撤回新增寿元', evidence: input.sources.filter(s => /初期无寿源|后期凭空增加寿元/.test(s.text)).map(s => ({ sourceId: s.id, quote: s.text.slice(0, 10) })) };
    }
    acceptDesignReviewStage(run, stage, result);
  }
  assert.ok(conflictFound);
  assert.equal(run.stages.at(-1)!.result!.checks[0].verdict, 'pass');
  assert.equal(completeDesignReviewRun(run).result.checks[0].verdict, 'revise');
});

test('repeated completion revalidates changed evidence and never reuses a previous report result', () => {
  const run = createDesignReviewRun(largeInput());
  for (const stage of run.stages) acceptDesignReviewStage(run, stage, stagePass(designReviewStageInput(run, stage)));
  const first = completeDesignReviewRun(run);
  assert.deepEqual(completeDesignReviewRun(run), first);
  const original = run.stages[0].result!.checks[0].evidence[0].quote;
  run.stages[0].result!.checks[0].evidence[0].quote = '凭空捏造且未在任何原文出现的证据';
  assert.throws(() => completeDesignReviewRun(run), /引用不在原文/);
  run.stages[0].result!.checks[0].evidence[0].quote = original;
  assert.deepEqual(completeDesignReviewRun(run), first);
});

test('chapter-only power batches also receive complete tier and technique rules', () => {
  const input = largeInput();
  input.area = 'power';
  const rules = [
    { id: 'plan/overview', text: '本轮只验收100章，不是450章。' },
    { id: 'world/tierLadders/power', text: '功法高品阶不能跳过允许境界。' },
    { id: 'world/techniques/sword', text: '乾元御风剑诀允许凝元、玄府；一次消耗二成真元。' },
  ];
  input.sources = [...rules, ...input.sources];
  const run = createDesignReviewRun(input);
  assert.equal(run.scheduleVersion, 28);
  for (const stage of run.stages) {
    const staged = designReviewStageInput(run, stage);
    assert.ok(JSON.stringify(staged.sources).length <= 240_000);
    assert.equal(new Set(staged.sources.map(s => s.id)).size, staged.sources.length);
    if (stage.kind !== 'synthesis') for (const rule of rules) {
      const ids = run.units.filter(u => u.sourceId === rule.id).map(u => u.id);
      assert.equal(staged.sources.filter(s => ids.includes(s.id)).map(s => s.text).join(''), rule.text);
    }
    acceptDesignReviewStage(run, stage, stagePass(staged));
  }
  assert.equal(completeDesignReviewRun(run).result.checks[0].verdict, 'pass');
  const requiredId = run.units.find(u => u.sourceId === rules[2].id)!.id;
  run.stages.find(s => s.kind === 'batch')!.unitIds = run.stages[0].unitIds.filter(id => id !== requiredId);
  assert.throws(() => completeDesignReviewRun(run), /覆盖或跨批检查未完成/);
});

test('oversized shared candidates remain complete ordinary sources and legacy schedules still resume', () => {
  const input = largeInput(); input.area = 'power';
  const oversized = { id: 'world/techniques/large', text: '完整规则不可截断。'.repeat(8000) };
  input.sources.unshift(oversized);
  const run = createDesignReviewRun(input);
  const units = run.units.filter(u => u.sourceId === oversized.id);
  const batches = run.stages.filter(s => s.kind === 'batch');
  assert.equal(units.map(u => oversized.text.slice(u.start, u.end)).join(''), oversized.text);
  for (const unit of units) assert.equal(batches.filter(s => s.unitIds.includes(unit.id)).length, 1);
  const legacy = createDesignReviewRun(input, '2026-10-14T00:00:00Z', 1);
  assert.equal(legacy.scheduleVersion, undefined);
  acceptDesignReviewStage(legacy, legacy.stages[0], stagePass(designReviewStageInput(legacy, legacy.stages[0])));
  const restored = JSON.parse(JSON.stringify(legacy));
  for (const stage of restored.stages.slice(1)) acceptDesignReviewStage(restored, stage, stagePass(designReviewStageInput(restored, stage)));
  assert.equal(completeDesignReviewRun(restored).result.checks[0].verdict, 'pass');
});

test('v20 scopes power questions locally without dropping high-tier sources or changing saved v19 requests', () => {
  const input: DesignReviewInput = { area: 'power', scope: { worldPackRevision: 1, storyBibleRevision: 1, planRevisionId: 'p', planRevision: 1 }, inputHash: 'a'.repeat(64), rubric: designReviewRubrics.power, sources: [
    { id: 'world/techniques/high', text: '高阶术式仍须支付寿储并可被打断。'.repeat(10000) },
    { id: 'plan/chapters/1', text: '本章只执行初阶训练。'.repeat(15000) },
  ] };
  const old = createDesignReviewRun(input, '2026-10-15T00:00:00Z', 19);
  // Captured before v20 was implemented. Resuming persisted v19 must send the
  // exact same local rubric and source envelope, not silently rewrite history.
  const oldFirst = designReviewStageInput(old, old.stages[0]);
  assert.equal(createHash('sha256').update(JSON.stringify(oldFirst)).digest('hex'), '45c48104b8e9be2fd0a129e6f13d7bc16f9aac6c71fd3e0376bc14dd5ae8ce18');
  const current = createDesignReviewRun(input, old.createdAt, 20);
  assert.equal(current.scheduleVersion, 20);
  assert.deepEqual(current.units, old.units);
  assert.deepEqual(current.stages, old.stages);
  for (const stage of current.stages) {
    const staged = designReviewStageInput(current, stage);
    const previous = designReviewStageInput(old, old.stages.find(s => s.id === stage.id)!);
    assert.deepEqual(staged.sources, previous.sources);
    if (stage.kind !== 'synthesis') {
      assert.notDeepEqual(staged.rubric, previous.rubric);
      const { rubric, ...rest } = staged, { rubric: ignored, ...oldRest } = previous;
      assert.deepEqual(rest, oldRest, 'only the local questions change; capacity, coverage and obligations remain');
    } else assert.deepEqual(staged.rubric, previous.rubric, 'global synthesis criteria remain unchanged');
    const result = stagePass(staged), oldResult = stagePass(previous);
    acceptDesignReviewStage(current, stage, result);
    acceptDesignReviewStage(old, old.stages.find(s => s.id === stage.id)!, oldResult);
  }
  assert.deepEqual(completeDesignReviewRun(current).result, completeDesignReviewRun(old).result);
});

test('legacy v26: v20 never erases a real high-tier conflict or ordinary capacity insufficiency during synthesis', () => {
  for (const verdict of ['revise', 'insufficient'] as const) {
    const input = largeInput(); input.area = 'power'; input.rubric = designReviewRubrics.power;
    const run = createDesignReviewRun(input, undefined, 26);
    for (const stage of run.stages) {
      const staged = designReviewStageInput(run, stage), result = stagePass(staged);
      if (stage === run.stages[0]) result.checks[0] = { ...result.checks[0], verdict,
        explanation: verdict === 'revise' ? '已给高阶规则允许无代价跨界，存在明确冲突' : '同一能力确实依赖超出容量的完整必要原文',
        revisionAdvice: '需要独立核验', ...(verdict === 'insufficient' ? { insufficiencyReason: 'capacity_limit' as const } : {}) };
      acceptDesignReviewStage(run, stage, result);
    }
    assert.equal(run.stages.at(-1)!.result!.checks[0].verdict, 'pass');
    assert.equal(completeDesignReviewRun(run).result.checks[0].verdict, verdict);
  }
});

const chapterPairInput = (): DesignReviewInput => ({ ...largeInput(), sources: [
  { id: 'story/chapterPlans/bible-chapter-50', text: JSON.stringify({ chapterNumber: 50, purpose: '一剑支出二成，结束时余一成半。' }) },
  ...largeInput().sources,
  { id: 'plan/chapters/50', text: JSON.stringify({ chapterNumber: 50, cost: '沿用第48章复测余额三成半，一剑二成后余一成半，停止施术。' }) },
] });

test('legacy v26: chapter summaries and detailed ledgers are co-read without discarding either source', () => {
  const input = chapterPairInput(), run = createDesignReviewRun(input, undefined, 26);
  const pairedIds = run.units.filter(u => /chapterPlans|plan\/chapters/.test(u.sourceId)).map(u => u.id);
  const batches = run.stages.filter(s => s.kind === 'batch');
  assert.ok(batches.length > 1);
  const pairedBatch = batches.find(s => pairedIds.every(id => s.unitIds.includes(id)));
  assert.ok(pairedBatch, 'both the short summary and the full cost must reach the same reviewer');
  const staged = designReviewStageInput(run, pairedBatch);
  assert.ok(staged.sources.some(s => s.text.includes('复测余额三成半')));
  for (const source of input.sources) {
    const units = run.units.filter(u => u.sourceId === source.id);
    assert.equal(units.map(u => source.text.slice(u.start, u.end)).join(''), source.text);
    for (const unit of units) assert.equal(batches.filter(s => s.unitIds.includes(unit.id)).length, 1);
  }
  for (const stage of run.stages) {
    const stageInput = designReviewStageInput(run, stage), result = stagePass(stageInput);
    assert.ok(JSON.stringify(stageInput.sources).length <= 240_000);
    if (stage.id === pairedBatch.id) result.checks[0] = { ...result.checks[0], verdict: 'revise', explanation: '两份章纲的动作存在真实冲突，不能用其中一份覆盖另一份。', revisionAdvice: '统一动作安排。' };
    acceptDesignReviewStage(run, stage, result);
  }
  assert.equal(completeDesignReviewRun(run).result.checks[0].verdict, 'revise', 'grouping never clears a substantive finding');
});

test('saved v3 chapter partitions keep their original schedule and can finish after v4 is introduced', () => {
  const run = createDesignReviewRun(chapterPairInput(), '2026-10-14T00:00:00Z', 3);
  const pair = run.units.filter(u => /chapterPlans|plan\/chapters/.test(u.sourceId));
  assert.ok(!run.stages.filter(s => s.kind === 'batch').some(s => pair.every(u => s.unitIds.includes(u.id))));
  acceptDesignReviewStage(run, run.stages[0], stagePass(designReviewStageInput(run, run.stages[0])));
  const saved = JSON.stringify(run), restored = JSON.parse(saved);
  for (const stage of restored.stages.slice(1)) acceptDesignReviewStage(restored, stage, stagePass(designReviewStageInput(restored, stage)));
  assert.equal(completeDesignReviewRun(restored).result.checks[0].verdict, 'pass');
  assert.deepEqual(restored.stages.map(({ id, unitIds }) => ({ id, unitIds })), run.stages.map(({ id, unitIds }) => ({ id, unitIds })));
  assert.equal(JSON.stringify(run), saved);
});

test('oversized chapter pairs split within capacity while unmatched and malformed sources are retained', () => {
  const input = chapterPairInput();
  input.sources[0].text = JSON.stringify({ chapterNumber: 50, purpose: '完整摘要。'.repeat(20000) });
  input.sources.at(-1)!.text = JSON.stringify({ chapterNumber: 50, cost: '全部消耗。'.repeat(20000) });
  input.sources.push(
    { id: 'plan/chapters/malformed', text: '{ incomplete chapter text' },
    { id: 'story/chapterPlans/number-50-name', text: JSON.stringify({ chapterNumber: 51, purpose: '真实章号51，不与名称中的50误配。' }) },
  );
  const run = createDesignReviewRun(input), batches = run.stages.filter(s => s.kind === 'batch');
  for (const source of input.sources) {
    const units = run.units.filter(u => u.sourceId === source.id);
    assert.equal(units.map(u => source.text.slice(u.start, u.end)).join(''), source.text);
    for (const unit of units) assert.equal(batches.filter(s => s.unitIds.includes(unit.id)).length, 1);
  }
  for (const stage of run.stages.filter(s => s.kind !== 'synthesis')) assert.ok(JSON.stringify(designReviewStageInput(run, stage).sources).length <= 240_000);
});

test('failed stages resume in a new workflow without repeating completed batches or granting approval', async () => {
  const repository = new InMemoryWorkRepository();
  let calls = 0;
  const reviewer = { ...provider, reviewDesignContent: async (input: DesignReviewInput) => { calls++; if (calls === 2) throw Error('连接中断'); return stagePass(input); } };
  let workflow = new ChapterWorkflow(repository, writer, reviewer);
  const work = await createReadyWork(workflow, '分批评审恢复');
  const planId = work.activePlanId;
  work.plans.get(planId!)!.plan.chapters[0].summary = '材料'.repeat(130000);
  const run = await workflow.startDesignReview(work.id, 'story');
  await workflow.stepDesignReview(work.id, run.id);
  await assert.rejects(() => workflow.stepDesignReview(work.id, run.id), /连接中断/);
  assert.equal(work.designContentReviews.size, 0);
  assert.equal(designReviewOverview(work).areas.find(a => a.area === 'story')!.status, 'interrupted');
  workflow = new ChapterWorkflow(repository, writer, reviewer);
  assert.equal((await workflow.startDesignReview(work.id, 'story')).id, run.id);
  let progress = await workflow.stepDesignReview(work.id, run.id);
  while (progress.status !== 'completed') progress = await workflow.stepDesignReview(work.id, run.id);
  assert.equal(calls, progress.stages.length + 1);
  assert.equal(progress.stages[0].attempts, 1);
  assert.equal(progress.stages[1].attempts, 2);
  assert.equal(work.activePlanId, planId);
  assert.equal(work.versions.size, 0);
});

test('lease takeover fences a delayed worker, and changed versions cannot resume old progress', async () => {
  const repository = new InMemoryWorkRepository();
  let time = 0, started!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const slow = new ChapterWorkflow(repository, writer, { ...provider, reviewDesignContent: async input => { started(); await waiting; return stagePass(input); } }, { now: () => time, leaseMs: 300000 });
  const fast = new ChapterWorkflow(repository, writer, provider, { now: () => time, leaseMs: 300000 });
  const work = await createReadyWork(slow, '评审并发');
  const run = await slow.startDesignReview(work.id, 'story');
  const request = slow.stepDesignReview(work.id, run.id); await entered;
  await assert.rejects(() => fast.stepDesignReview(work.id, run.id), /正在进行/);
  time = 300001;
  const completed = await fast.stepDesignReview(work.id, run.id);
  assert.equal(completed.status, 'completed');
  finish(); await assert.rejects(() => request, /执行权已失效/);
  assert.equal(work.designContentReviews.size, 1);
  const fresh = await fast.startDesignReview(work.id, 'story');
  assert.equal(designReviewOverview(work).ready, false);
  work.worldPack!.summary += '世界变更';
  await assert.rejects(() => fast.stepDesignReview(work.id, fresh.id), /设计或计划已变化/);
  assert.equal(work.designContentReviews.size, 1);
});

test('review result preparation runs outside the write transaction and still publishes atomically', async () => {
  class ObservedRepository extends InMemoryWorkRepository {
    inTransaction = false;
    override async transaction<T>(id: string, callback: (tx: WorkTransaction) => Promise<T> | T): Promise<T> {
      return super.transaction(id, async tx => {
        this.inTransaction = true;
        try { return await callback(tx); } finally { this.inTransaction = false; }
      });
    }
  }
  const repository = new ObservedRepository();
  let inspected = 0;
  const workflow = new ChapterWorkflow(repository, writer, { ...provider, reviewDesignContent: async input => {
    const result = stagePass(input), checks = result.checks;
    Object.defineProperty(result, 'checks', { enumerable: true, get() {
      assert.equal(repository.inTransaction, false, 'model result must be prepared before taking the database write lock');
      inspected++; return checks;
    } });
    return result;
  } });
  const work = await createReadyWork(workflow, '事务外评审准备');
  const run = await workflow.startDesignReview(work.id, 'story');
  const completed = await workflow.stepDesignReview(work.id, run.id);
  assert.ok(inspected > 0);
  assert.equal(completed.status, 'completed');
  assert.equal(work.designContentReviews.size, 1);
  assert.equal(work.designContentReviews.get(completed.reportId!)!.runId, run.id);
  assert.equal(work.versions.size, 0);
});

test('a design changed during detached preparation cannot publish a report and retains the rejected answer', async () => {
  const repository = new InMemoryWorkRepository();
  let changeDesign = () => {};
  const workflow = new ChapterWorkflow(repository, writer, { ...provider, reviewDesignContent: async input => {
    const result = stagePass(input), checks = result.checks;
    Object.defineProperty(result, 'checks', { enumerable: true, get() { changeDesign(); return checks; } });
    return result;
  } });
  const work = await createReadyWork(workflow, '准备期间改设定');
  const run = await workflow.startDesignReview(work.id, 'story');
  changeDesign = () => { work.worldPack!.summary = '作者在评审结果准备期间修改了世界规则'; };
  await assert.rejects(() => workflow.stepDesignReview(work.id, run.id), /设计或计划已变化/);
  const failed = work.designReviewRuns.get(run.id)!;
  assert.equal(failed.status, 'outdated');
  assert.equal(failed.stages[0].result, undefined);
  assert.equal(failed.stages[0].failures!.length, 1);
  assert.ok(failed.stages[0].rejectedResult);
  assert.equal(work.designContentReviews.size, 0);
  assert.equal(failed.leaseToken, undefined);
});

test('local scope inventories omitted sources without authorizing citations to unread material', () => {
  const input = largeInput();
  input.sources.push({ id: 'plan/chapters/48', text: '第48章休息一小时恢复一成，余额三成半。' });
  const run = createDesignReviewRun(input);
  const stage = run.stages[0], staged = designReviewStageInput(run, stage);
  assert.equal(staged.stage!.coverage!.mode, 'local_sources');
  assert.equal(staged.stage!.coverage!.sourceLengths['early'], input.sources[0].text.length);
  assert.equal(staged.stage!.coverage!.sourceLengths['plan/chapters/48'], input.sources[2].text.length);
  assert.equal(Object.hasOwn(staged.stage!.coverage!.sourceLengths, 'plan/chapters/51'), false);
  const partial = staged.stage!.sourceMap.filter(u => u.sourceId === 'early');
  assert.ok(partial.length > 0 && partial.at(-1)!.end < input.sources[0].text.length);
  assert.ok(!staged.stage!.sourceMap.some(u => u.sourceId === 'plan/chapters/48'));
  const inventedPass = stagePass(staged);
  inventedPass.checks[0].evidence = [{ sourceId: 'plan/chapters/48', quote: input.sources[2].text }];
  assert.throws(() => acceptDesignReviewStage(run, stage, inventedPass), /引用不在原文/);
});

test('legacy v26: synthesis receives the exact rolling horizon but cannot erase a previous insufficient verdict', () => {
  const input = largeInput();
  const overview = { id: 'plan/overview', text: JSON.stringify({ targetChapterCount: 100, detailedThroughChapter: 50, outlinedChapterNumbers: [1, 2, 50], openQuestions: ['261–270日休养来源未定'] }) };
  input.sources.unshift(overview);
  const run = createDesignReviewRun(input, undefined, 26);
  for (const [index, stage] of run.stages.entries()) {
    const staged = designReviewStageInput(run, stage), result = stagePass(staged);
    if (index === 0) result.checks[0] = { ...result.checks[0], verdict: 'insufficient', explanation: '休养缺资金来源', revisionAdvice: '补充真实来源' };
    if (stage.kind === 'synthesis') {
      assert.equal(staged.stage!.coverage!.mode, 'reports_with_context');
      const context = staged.stage!.sourceMap.filter(u => u.sourceId === overview.id);
      assert.equal(context.map(u => staged.sources.find(s => s.id === u.id)!.text).join(''), overview.text);
      assert.equal(staged.sources.filter(s => s.id.startsWith('review-result/')).length, 2);
      assert.ok(JSON.stringify(staged.sources).length <= 240_000);
      result.checks[0].evidence = [{ sourceId: context[0].id, quote: overview.text }];
    }
    acceptDesignReviewStage(run, stage, result);
  }
  assert.equal(completeDesignReviewRun(run).result.checks[0].verdict, 'insufficient');
  run.stages.find(s => s.kind === 'synthesis')!.unitIds = [];
  assert.throws(() => completeDesignReviewRun(run), /覆盖或跨批检查未完成/);
});

test('legacy v2 schedules keep their exact inputs after serialization, while small v3 inputs are whole', () => {
  const input = largeInput();
  input.sources.unshift({ id: 'plan/overview', text: '目标100章，细纲只到50章。' });
  const legacy = createDesignReviewRun(input, '2026-10-14T00:00:00Z', 2);
  for (const stage of legacy.stages) {
    const staged = designReviewStageInput(legacy, stage);
    assert.equal(staged.stage!.coverage, undefined);
    if (stage.kind === 'synthesis') {
      assert.deepEqual(staged.stage!.sourceMap, []);
      assert.ok(staged.sources.every(s => s.id.startsWith('review-result/')));
    }
    acceptDesignReviewStage(legacy, stage, stagePass(staged));
  }
  const restored = JSON.parse(JSON.stringify(legacy));
  assert.deepEqual(completeDesignReviewRun(restored), completeDesignReviewRun(legacy));
  const small = createDesignReviewRun({ ...input, sources: [{ id: 'only', text: '完整原文可在一次读取。' }] });
  assert.equal(designReviewStageInput(small, small.stages[0]).stage!.coverage!.mode, 'whole_input');
});

function deferralRun() {
  const input = largeInput();
  input.sources.push({ id: 'plan/chapters/48', text: '第48章实际休息一小时恢复一成，余额三成半。' });
  return createDesignReviewRun(input, undefined, 4);
}
function deferFirst(run: ReturnType<typeof createDesignReviewRun>) {
  const stage = run.stages[0], staged = designReviewStageInput(run, stage), result = stagePass(staged);
  result.checks[0] = { ...result.checks[0], verdict: 'insufficient', explanation: '需要第48章核对恢复', revisionAdvice: '补读实际恢复原文', awaitingSources: ['plan/chapters/48'] };
  acceptDesignReviewStage(run, stage, result);
}
function resolvePending(input: DesignReviewInput) {
  const result = stagePass(input);
  const pending = input.stage!.coverage!.pendingChecks!;
  result.checks[0].resolves = pending.map(p => p.id);
  const ids = new Set(pending.flatMap(p => [p.questionSourceId, p.priorUnitIds[0], ...p.requiredSourceIds.map(id => input.stage!.sourceMap.find(u => u.sourceId === id)!.id)]));
  result.checks[0].evidence = [...ids].map(id => ({ sourceId: id, quote: input.sources.find(s => s.id === id)!.text.slice(0, 40) }));
  return result;
}

test('one continuity question can request all 21 chapters and cannot resolve with a missing citation', () => {
  const requested = Array.from({ length: 21 }, (_, i) => ({ id: `plan/chapters/${30 + i}`, text: `第${30 + i}章核验出发、到达、交接与当日余量。` }));
  const input = { ...largeInput(), sources: [{ id: 'route', text: '第30至50章必须按真实航路连续核验，不能跳过港内交接。' }, ...['a', 'b', 'c', 'd'].map(id => ({ id, text: '其他原始设定。'.repeat(10000) })), ...requested] };
  const run = createDesignReviewRun(input);
  const first = run.stages[0], firstInput = designReviewStageInput(run, first);
  const pending = stagePass(firstInput);
  pending.checks[0] = { ...pending.checks[0], verdict: 'insufficient', explanation: '需连续核对30至50章的行动时序。', revisionAdvice: '补读全部21章，不能只取前12章。', awaitingSources: requested.map(s => s.id), evidence: [{ sourceId: run.units.find(u => u.sourceId === 'route')!.id, quote: input.sources[0].text }] };
  designReviewResultSchema.parse(pending);
  acceptDesignReviewStage(run, first, pending);
  let resolved = false;
  for (let i = 1; i < run.stages.length; i++) {
    const stage = run.stages[i], staged = designReviewStageInput(run, stage);
    let result = stagePass(staged);
    if (stage.followupFor) {
      assert.equal(stage.followupFor, 'batch-1/timeline');
      assert.deepEqual(staged.stage!.coverage!.pendingChecks![0].requiredSourceIds, requested.map(s => s.id));
      for (const source of requested) assert.equal(staged.stage!.sourceMap.filter(u => u.sourceId === source.id).map(u => staged.sources.find(s => s.id === u.id)!.text).join(''), source.text);
      result = resolvePending(staged);
      const incomplete = structuredClone(result);
      const lastId = staged.stage!.sourceMap.find(u => u.sourceId === 'plan/chapters/50')!.id;
      incomplete.checks[0].evidence = incomplete.checks[0].evidence.filter(e => e.sourceId !== lastId);
      assert.throws(() => acceptDesignReviewStage(run, stage, incomplete), /新增来源 plan\/chapters\/50/);
      designReviewResultSchema.parse(result);
      resolved = true;
    }
    acceptDesignReviewStage(run, stage, result);
  }
  assert.ok(resolved);
  const complete = completeDesignReviewRun(run);
  assert.equal(complete.result.checks[0].verdict, 'pass');
  assert.deepEqual(run.stages[0].result, pending);
  assert.deepEqual(complete.result.resolvedDeferrals, [{ checkId: 'batch-1/timeline', resolvedByStageId: 'followup-batch-1/timeline' }]);
});

test('cross-batch deferrals require explicit raw-source resolution, and retain an auditable original', () => {
  for (const resolve of [false, true]) {
    const run = deferralRun(); deferFirst(run);
    const original = structuredClone(run.stages[0].result);
    let resolvedBy = '';
    for (const stage of run.stages.slice(1)) {
      const input = designReviewStageInput(run, stage);
      let result = stagePass(input);
      if (resolve && input.stage?.coverage?.pendingChecks?.length) {
        result = resolvePending(input); resolvedBy ||= stage.id;
      }
      acceptDesignReviewStage(run, stage, result);
    }
    const complete = completeDesignReviewRun(JSON.parse(JSON.stringify(run)));
    assert.equal(complete.result.checks[0].verdict, resolve ? 'pass' : 'insufficient');
    assert.deepEqual(run.stages[0].result, original);
    assert.equal(Object.hasOwn(complete.result.checks[0], 'awaitingSources'), false);
    assert.deepEqual(complete.result.resolvedDeferrals, resolve ? [{ checkId: 'batch-1/timeline', resolvedByStageId: resolvedBy }] : undefined);
    if (resolve) {
      const rootInput = designReviewStageInput(run, run.stages.at(-1)!);
      assert.deepEqual(rootInput.stage!.coverage!.resolvedDeferrals, complete.result.resolvedDeferrals);
      run.stages.find(s => s.id === resolvedBy)!.result!.checks[0].evidence = [];
      assert.throws(() => completeDesignReviewRun(run), /原文证据/);
    }
  }
});

test('deferrals cannot hide contradictions, cite unknown or already-read sources, or be resolved by synthesis', () => {
  const run = deferralRun();
  const first = run.stages[0], input = designReviewStageInput(run, first);
  const base = { ...stagePass(input).checks[0], verdict: 'insufficient' as const, revisionAdvice: '等待核对', awaitingSources: ['missing-source'] };
  assert.throws(() => acceptDesignReviewStage(run, first, { summary: '等待', checks: [base] }), /不在完整目录/);
  assert.throws(() => acceptDesignReviewStage(run, first, { summary: '等待', checks: [{ ...base, verdict: 'revise', awaitingSources: ['plan/chapters/48'] }] }), /等待补读只能/);
  deferFirst(run);
  let testedResolution = false;
  for (const stage of run.stages.slice(1)) {
    const staged = designReviewStageInput(run, stage);
    const pending = staged.stage!.coverage?.pendingChecks;
    if (pending?.length) {
      const valid = resolvePending(staged);
      const unproven = structuredClone(valid);
      unproven.checks[0].evidence = unproven.checks[0].evidence.filter(e => e.sourceId !== pending[0].questionSourceId);
      assert.throws(() => acceptDesignReviewStage(run, stage, unproven), /必须引用原问题/);
      const known = { ...base, awaitingSources: ['plan/chapters/48'] };
      assert.throws(() => acceptDesignReviewStage(run, stage, { summary: '重复等待', checks: [known] }), /已完整提供/);
      acceptDesignReviewStage(run, stage, valid); testedResolution = true;
    } else {
      const result = stagePass(staged);
      if (stage.kind === 'synthesis') {
        result.checks[0].resolves = ['batch-1/timeline'];
        assert.throws(() => acceptDesignReviewStage(run, stage, result), /仅原文复核/);
        delete result.checks[0].resolves;
      } else if (stage.id === 'batch-2') {
        result.checks[0] = { ...result.checks[0], verdict: 'revise', explanation: '另有实际时间矛盾', revisionAdvice: '修订冲突日期' };
      }
      acceptDesignReviewStage(run, stage, result);
    }
  }
  assert.ok(testedResolution);
  assert.equal(completeDesignReviewRun(run).result.checks[0].verdict, 'revise');
});

test('legacy v4 separately reading pieces of a source never settles a joint check', () => {
  const run = createDesignReviewRun(largeInput(), undefined, 4);
  const first = run.stages[0], staged = designReviewStageInput(run, first);
  const result = stagePass(staged);
  result.checks[0] = { ...result.checks[0], verdict: 'insufficient', explanation: '必须联合核对整个后期来源', revisionAdvice: '补读整个后期来源', awaitingSources: ['late'] };
  acceptDesignReviewStage(run, first, result);
  let eligibility = 0;
  for (const stage of run.stages.slice(1)) {
    const input = designReviewStageInput(run, stage);
    eligibility += input.stage?.coverage?.pendingChecks?.length ?? 0;
    const response = stagePass(input);
    if (stage.kind === 'cross' && !input.stage?.coverage?.pendingChecks?.length) {
      response.checks[0].resolves = ['batch-1/timeline'];
      assert.throws(() => acceptDesignReviewStage(run, stage, response), /没有符合本批覆盖/);
      delete response.checks[0].resolves;
    }
    acceptDesignReviewStage(run, stage, response);
  }
  assert.equal(eligibility, 0);
  assert.equal(completeDesignReviewRun(run).result.checks[0].verdict, 'insufficient');
});

test('v3 budgets full quotation envelopes so evidenced deferrals can fit without overflowing synthesis', () => {
  const input = largeInput();
  input.sources.forEach(source => { source.text = '文字原文'.repeat(35000); });
  const run = createDesignReviewRun(input);
  for (const stage of run.stages) {
    const staged = designReviewStageInput(run, stage), result = stagePass(staged);
    if (stage.kind === 'batch') {
      const source = staged.sources.find(s => s.text.length >= 2500)!;
      result.checks[0].evidence = Array.from({ length: 20 }, () => ({ sourceId: source.id, quote: source.text.slice(0, 2500) }));
      assert.ok(JSON.stringify(result).length > 40_000);
    }
    acceptDesignReviewStage(run, stage, result);
    assert.ok(JSON.stringify(staged.sources).length <= 240_000);
  }
  assert.equal(completeDesignReviewRun(run).result.checks[0].verdict, 'pass');
  const first = run.stages[0], staged = designReviewStageInput(run, first), excessive = stagePass(staged);
  excessive.checks[0].explanation = '超量解释'.repeat(25000);
  assert.throws(() => acceptDesignReviewStage(run, first, excessive), /结论过长/);
  const legacy = createDesignReviewRun(input, run.createdAt, 2), oldInput = designReviewStageInput(legacy, legacy.stages[0]), large = stagePass(oldInput);
  large.checks[0].evidence = Array.from({ length: 20 }, () => ({ sourceId: oldInput.sources[0].id, quote: oldInput.sources[0].text.slice(0, 2500) }));
  assert.throws(() => acceptDesignReviewStage(legacy, legacy.stages[0], large), /结论过长/);
});

function threePartitionRun(version: 4 | 5 | 6 | 7 | 11 | 12 | 14 | 15 = 7) {
  const input: DesignReviewInput = { ...largeInput(), rubric: { timeline: '寄出与送达是否有实际时间', payoff: '承诺是否保持代价' }, sources: [
    { id: 'author', text: '仅检查本轮提案，不视为采纳事实。' },
    { id: 'early', text: '第9日寄出书信，送达前收信人不能知情。' + '日程说明。'.repeat(17000) },
    { id: 'other', text: '独立支线有另一处不应被消除的代价。' + '支线说明。'.repeat(17000) },
    { id: 'arrival', text: '第12日书信实际送达，收信人此刻才得知内容。' + '送达说明。'.repeat(17000) },
  ] };
  const run = createDesignReviewRun(input, '2026-10-14T00:00:00Z', version);
  assert.equal(run.stages.filter(s => s.kind === 'batch').length, 3);
  return run;
}

test('v15 merges only criteria represented by its child reports while the root and final blockers retain every standard', () => {
  const original = { ...threePartitionRun(14).input, rubric: { timeline: '核时序', payoff: '核兑现', opening: '核前五十章质量' } };
  const runs = [createDesignReviewRun(original, undefined, 14), createDesignReviewRun(original, undefined, 15)];
  for (const run of runs) {
    for (const stage of [...run.stages.filter(s => s.kind !== 'synthesis')]) {
      const input = designReviewStageInput(run, stage), result = stagePass(input);
      if (stage.id === 'batch-2') Object.assign(result.checks[2], { verdict: 'revise', explanation: '已有场景重复，独立问题必须保留', revisionAdvice: '修改重复的角色选择' });
      if (stage.id === 'cross-1-2') {
        const unit = input.stage!.sourceMap.find(u => u.sourceId === 'early')!;
        for (const check of result.checks.slice(0, 2)) Object.assign(check, { verdict: 'insufficient', explanation: '需核送达原文', revisionAdvice: '补读送达记录', awaitingSources: ['arrival'], evidence: [{ sourceId: unit.id, quote: '第9日寄出书信，送达前收信人不能知情。' }] });
      }
      acceptDesignReviewStage(run, stage, result);
    }
    for (const stage of run.stages.filter(s => s.followupFor)) {
      const input = designReviewStageInput(run, stage);
      acceptDesignReviewStage(run, stage, stagePass(input)); // No explicit resolution: the waits must remain.
    }
  }
  const [legacy, current] = runs;
  assert.deepEqual(current.units, legacy.units);
  assert.deepEqual(current.stages.map(({ id, kind, children, unitIds }) => ({ id, kind, children, unitIds })), legacy.stages.map(({ id, kind, children, unitIds }) => ({ id, kind, children, unitIds })));
  let scoped = 0;
  for (const stage of current.stages.filter(s => s.kind === 'synthesis')) {
    const oldStage = legacy.stages.find(s => s.id === stage.id)!;
    const input = designReviewStageInput(current, stage), oldInput = designReviewStageInput(legacy, oldStage);
    assert.deepEqual(oldInput.rubric, original.rubric);
    const onlyFollowups = stage.children.every(id => current.stages.find(s => s.id === id)!.followupFor);
    if (onlyFollowups) {
      scoped++;
      assert.deepEqual(Object.keys(input.rubric), ['timeline', 'payoff']);
      assert.equal(input.stage!.coverage!.synthesis!.scope, 'partial_reports');
      assert.deepEqual(input.sources, oldInput.sources);
      const invalid = stagePass(input);
      invalid.checks.push({ ...invalid.checks[0], criterion: 'opening', verdict: 'insufficient', explanation: '本子树不是前五十章' });
      assert.throws(() => acceptDesignReviewStage(current, stage, invalid), /逐项覆盖全部标准/);
    }
    if (stage === current.stages.at(-1)) assert.deepEqual(input.rubric, original.rubric);
    acceptDesignReviewStage(current, stage, stagePass(input));
    acceptDesignReviewStage(legacy, oldStage, stagePass(oldInput));
  }
  assert.equal(scoped, 1);
  const restored = JSON.parse(JSON.stringify(current));
  const final = completeDesignReviewRun(restored).result;
  assert.deepEqual(final.checks.map(c => [c.criterion, c.verdict]), [['timeline', 'insufficient'], ['payoff', 'insufficient'], ['opening', 'revise']]);
  assert.deepEqual(Object.keys(designReviewStageInput(restored, restored.stages.at(-1)!).rubric), Object.keys(original.rubric));
});
function finishRawWithThirdPartitionQuestion(run: ReturnType<typeof threePartitionRun>, evidence = true) {
  const originalRaw = run.stages.filter(s => s.kind !== 'synthesis');
  for (const stage of originalRaw) {
    const input = designReviewStageInput(run, stage), result = stagePass(input);
    if (stage.id === 'batch-2') result.checks[1] = { ...result.checks[1], verdict: 'revise', explanation: '另有不可取消的代价缺口', revisionAdvice: '补齐独立支线的代价' };
    if (stage.id === 'cross-1-2') {
      const unit = input.stage!.sourceMap.find(u => u.sourceId === 'early')!;
      result.checks[0] = { criterion: 'timeline', verdict: 'insufficient', explanation: '已读寄出时点，须同读送达原文再核认知时序', revisionAdvice: '补读完整送达记录', awaitingSources: ['arrival'], evidence: evidence ? [{ sourceId: unit.id, quote: '第9日寄出书信，送达前收信人不能知情。' }] : [] };
    }
    acceptDesignReviewStage(run, stage, result);
  }
}

test('current schedule rechecks a third-partition dependency with complete cited sources, survives restore and preserves hard revisions', () => {
  for (const explicitlyResolve of [false, true]) {
    let run = threePartitionRun();
    const originalPlan = structuredClone(run.stages.map(s => ({ id: s.id, unitIds: s.unitIds })));
    finishRawWithThirdPartitionQuestion(run);
    const originalQuestion = structuredClone(run.stages.find(s => s.id === 'cross-1-2')!.result);
    run = JSON.parse(JSON.stringify(run));
    const followup = run.stages.find(s => s.followupFor)!;
    assert.equal(followup.followupFor, 'cross-1-2/timeline');
    assert.ok(run.stages.indexOf(followup) < run.stages.findIndex(s => s.kind === 'synthesis'));
    const input = designReviewStageInput(run, followup);
    assert.deepEqual(Object.keys(input.rubric), ['timeline']);
    assert.equal(input.stage!.followupFor, followup.followupFor);
    for (const sourceId of ['early', 'arrival', 'author']) {
      const ids = input.stage!.sourceMap.filter(u => u.sourceId === sourceId).map(u => u.id);
      assert.equal(input.sources.filter(s => ids.includes(s.id)).map(s => s.text).join(''), run.input.sources.find(s => s.id === sourceId)!.text);
    }
    assert.ok(!input.stage!.sourceMap.some(u => u.sourceId === 'other'), 'unrelated material is not substituted for the complete evidence sources');
    assert.ok(JSON.stringify(input.sources).length < 240_000);
    assert.deepEqual(input.stage!.coverage!.pendingChecks![0].priorSourceIds, ['early']);
    const result = explicitlyResolve ? resolvePending(input) : stagePass(input);
    // A shared rule cannot substitute for the original statement under review.
    if (explicitlyResolve) {
      const earlyUnit = input.stage!.sourceMap.find(u => u.sourceId === 'early')!;
      result.checks[0].evidence.push({ sourceId: earlyUnit.id, quote: '第9日寄出书信，送达前收信人不能知情。' });
      const wrong = structuredClone(result);
      wrong.checks[0].evidence = wrong.checks[0].evidence.filter(e => e.sourceId !== earlyUnit.id);
      assert.throws(() => acceptDesignReviewStage(run, followup, wrong), /每个原始来源/);
    }
    acceptDesignReviewStage(run, followup, result);
    for (const stage of run.stages.filter(s => !s.result)) acceptDesignReviewStage(run, stage, stagePass(designReviewStageInput(run, stage)));
    const completed = completeDesignReviewRun(run);
    assert.equal(completed.result.checks[0].verdict, explicitlyResolve ? 'pass' : 'insufficient');
    assert.equal(completed.result.checks[1].verdict, 'revise');
    assert.deepEqual(run.stages.find(s => s.id === 'cross-1-2')!.result, originalQuestion);
    assert.deepEqual(run.stages.filter(s => s.kind !== 'synthesis' && !s.followupFor).map(s => ({ id: s.id, unitIds: s.unitIds })), originalPlan.filter(p => !p.id.startsWith('synthesis-')));
    if (explicitlyResolve) assert.deepEqual(completed.result.resolvedDeferrals, [{ checkId: 'cross-1-2/timeline', resolvedByStageId: followup.id }]);
    const tampered = structuredClone(run);
    tampered.stages.find(s => s.followupFor)!.unitIds.pop();
    assert.throws(() => completeDesignReviewRun(tampered), /覆盖或跨批检查未完成/);
  }
});

test('v6 reports separate nonadjacent excerpts and preserve provable UTF-16 positions without inventing locations', () => {
  const early = '"sinceChapter": 18, "untilChapter": 26';
  const late = '"trigger": "72章归乡当面交接"';
  const original = `😀前文\n${early}\n第18章共同查阅记录。\n第72章的新阶段。\n${late}\n重复文字 重复文字`;
  const result: DesignReviewResult = { summary: '分期认知', checks: [{ criterion: 'knowledge', verdict: 'pass', explanation: '两个独立阶段', revisionAdvice: '', evidence: [early, late, '重复文字'].map(quote => ({ sourceId: 'review-unit/1', quote })) }] };
  const before = structuredClone(result);
  const rendered = renderDesignReviewReport(result, () => ({ sourceId: 'story/secrets/one', unitId: 'review-unit/1', start: 100, text: original }));
  const metadata = [...rendered.matchAll(/BEGIN INDEPENDENT QUOTE [^\n]+\n([^\n]+)/g)].map(match => JSON.parse(match[1]));
  assert.equal(metadata.length, 3);
  assert.equal(metadata[0].start, 100 + original.indexOf(early));
  assert.equal(metadata[0].end, metadata[0].start + early.length);
  assert.equal(metadata[1].start, 100 + original.indexOf(late));
  assert.ok(metadata[1].start > metadata[0].end, 'the omitted interval remains visible');
  assert.equal(metadata[2].unique, false);
  assert.equal(metadata[2].start, undefined, 'repeated text must not be assigned its first matching position');
  assert.ok(rendered.includes(`\n${early}\nEND INDEPENDENT QUOTE 1.1`));
  assert.ok(rendered.includes(`\n${late}\nEND INDEPENDENT QUOTE 1.2`));
  assert.deepEqual(result, before);
});

test('v5 frozen report JSON survives restore while v6 synthesizes and validates annotated independent quotations', () => {
  for (const version of [5, 6] as const) {
    const run = createDesignReviewRun(largeInput(), undefined, version);
    for (const stage of run.stages) {
      const input = designReviewStageInput(run, stage);
      if (stage.kind === 'synthesis') {
        const source = input.sources.find(s => s.id === `review-result/${stage.children[0]}`)!;
        const child = run.stages.find(s => s.id === stage.children[0])!;
        if (version === 5) assert.equal(source.text, JSON.stringify(child.result, null, 2));
        else assert.ok(source.text.includes('BEGIN INDEPENDENT QUOTE'));
        const restored = JSON.parse(JSON.stringify(run));
        assert.deepEqual(designReviewStageInput(restored, restored.stages.find((s: { id: string }) => s.id === stage.id)), input);
      }
      acceptDesignReviewStage(run, stage, stagePass(input));
    }
    assert.equal(completeDesignReviewRun(run).result.checks[0].verdict, 'pass');
  }
});

test('v7 scopes local questions without changing raw coverage, legacy inputs or the final global rubric', () => {
  const original: DesignReviewInput = { ...largeInput(), rubric: { ...designReviewRubrics.story } };
  const current = createDesignReviewRun(original, undefined, 7);
  const legacy = createDesignReviewRun(original, undefined, 6);
  assert.deepEqual(current.units, legacy.units);
  assert.deepEqual(current.stages, legacy.stages);
  for (const stage of current.stages) {
    const scoped = designReviewStageInput(current, stage);
    const frozen = designReviewStageInput(legacy, legacy.stages.find(s => s.id === stage.id)!);
    assert.deepEqual(frozen.rubric, original.rubric);
    if (scoped.stage!.coverage!.mode === 'local_sources') {
      assert.deepEqual(scoped.sources, frozen.sources);
      assert.deepEqual(scoped.stage, frozen.stage);
      assert.match(scoped.rubric.opening, /本批未包含前五十章的全部细纲本身不是材料不足/);
      assert.deepEqual(Object.keys(scoped.rubric), Object.keys(original.rubric));
    } else assert.deepEqual(scoped.rubric, original.rubric);
    const verdict = stagePass(scoped);
    // A local failure remains a final blocker even when all syntheses pass.
    if (stage.id === 'batch-1') verdict.checks[0] = { ...verdict.checks[0], verdict: 'revise', explanation: '本批取消已付代价', revisionAdvice: '恢复不可逆后果' };
    acceptDesignReviewStage(current, stage, verdict);
    acceptDesignReviewStage(legacy, legacy.stages.find(s => s.id === stage.id)!, stagePass(frozen));
  }
  const restored = JSON.parse(JSON.stringify(current));
  const completed = completeDesignReviewRun(restored);
  assert.deepEqual(completed.input.rubric, original.rubric);
  assert.equal(completed.result.checks[0].verdict, 'revise');
  assert.deepEqual(original.rubric, designReviewRubrics.story, 'the global standards are not mutated');
  const small = createDesignReviewRun({ ...original, sources: [{ id: 'only', text: '全部材料能够一次读完。' }] });
  assert.deepEqual(designReviewStageInput(small, small.stages[0]).rubric, original.rubric);
  const custom = createDesignReviewRun({ ...largeInput(), rubric: { timeline: '不得省略驿站交接用时这一自定义标准' } });
  assert.match(designReviewStageInput(custom, custom.stages[0]).rubric.timeline, /不得省略驿站交接用时这一自定义标准/);
});

test('v23 scopes growth locally while preserving v22 replay, global standards and actual blockers', () => {
  const input = { ...largeInput(), rubric: { ...designReviewRubrics.story } };
  const old = createDesignReviewRun(input, '2026-10-15T00:00:00Z', 22);
  assert.equal(createHash('sha256').update(JSON.stringify(designReviewStageInput(old, old.stages[0]))).digest('hex'),
    '226d30e06c4906bd286ddf315a5ddf8deaa9367f826f6a8c0dccffd1f9c0eafe', 'saved v22 requests remain byte-for-byte reproducible');
  for (const verdict of ['revise', 'insufficient'] as const) {
    const previous = structuredClone(old);
    const current = createDesignReviewRun(input, old.createdAt, 23);
    assert.deepEqual(current.units, previous.units);
    assert.deepEqual(current.stages, previous.stages, 'raw coverage and cross comparisons stay complete');
    for (const stage of current.stages) {
      const oldStage = previous.stages.find(s => s.id === stage.id)!;
      const before = designReviewStageInput(previous, oldStage);
      const after = designReviewStageInput(current, stage);
      const { rubric, ...rest } = after, { rubric: oldRubric, ...oldRest } = before;
      assert.deepEqual(rest, oldRest, 'source selection, capacities and pending obligations are unchanged');
      if (after.stage!.coverage!.mode === 'local_sources') {
        assert.match(rubric.growth, /本批实际提供的主角成长安排/);
        assert.match(rubric.growth, /本批已给成长缺口或矛盾仍须具体返修/);
        assert.match(rubric.growth, /请求全部必要来源/);
        const { growth, ...others } = rubric, { growth: oldGrowth, ...oldOthers } = oldRubric;
        assert.notEqual(growth, oldGrowth);
        assert.deepEqual(others, oldOthers);
      } else assert.deepEqual(rubric, input.rubric, 'synthesis keeps the full growth promise and all seven standards');
      const result = stagePass(after);
      if (stage.id === 'batch-1') Object.assign(result.checks.find(c => c.criterion === 'growth')!, {
        verdict, explanation: '本批主角只有愿望，没有实际选择或学习条件', revisionAdvice: '补足具体选择与学习条件',
        ...(verdict === 'insufficient' ? { insufficiencyReason: 'missing_design' } : {}),
      });
      acceptDesignReviewStage(current, stage, result);
      acceptDesignReviewStage(previous, oldStage, structuredClone(result));
    }
    const restored = JSON.parse(JSON.stringify(current));
    assert.equal(completeDesignReviewRun(restored).result.checks.find(c => c.criterion === 'growth')!.verdict, verdict);
    assert.equal(completeDesignReviewRun(previous).result.checks.find(c => c.criterion === 'growth')!.verdict, verdict);
  }
  const whole = createDesignReviewRun({ ...input, sources: [{ id: 'all', text: '全部成长材料' }] });
  assert.deepEqual(designReviewStageInput(whole, whole.stages[0]).rubric, input.rubric);
  const custom = createDesignReviewRun({ ...input, rubric: { growth: '作者指定：核对工匠成长中的失败代价' } });
  assert.match(designReviewStageInput(custom, custom.stages[0]).rubric.growth, /作者指定：核对工匠成长中的失败代价/);
  assert.doesNotMatch(designReviewStageInput(custom, custom.stages[0]).rubric.growth, /本批实际提供的主角成长安排/);
});

test('v24 scopes world capacity locally without changing v23 evidence, final standards or negative findings', () => {
  const input: DesignReviewInput = { ...largeInput(), area: 'world', rubric: { ...designReviewRubrics.world } };
  const old = createDesignReviewRun(input, '2026-10-15T00:00:00Z', 23);
  assert.equal(createHash('sha256').update(JSON.stringify(designReviewStageInput(old, old.stages[0]))).digest('hex'),
    'e848d8b7dceb8b4b9447017dc696e76b52bf1622fd256d4cae7589e1a3ffd693', 'frozen v23 requests remain reproducible');
  for (const verdict of ['revise', 'insufficient'] as const) {
    const previous = structuredClone(old), current = createDesignReviewRun(input, old.createdAt, 24);
    assert.deepEqual(current.units, previous.units);
    assert.deepEqual(current.stages, previous.stages, 'all raw text and cross pairs remain required');
    for (const stage of current.stages) {
      const oldStage = previous.stages.find(s => s.id === stage.id)!;
      const before = designReviewStageInput(previous, oldStage), after = designReviewStageInput(current, stage);
      const { rubric, ...rest } = after, { rubric: oldRubric, ...oldRest } = before;
      assert.deepEqual(rest, oldRest, 'source selection, citation rules and capacities are unchanged');
      if (after.stage!.coverage!.mode === 'local_sources') {
        assert.match(rubric.capacity, /本批实际提供的世界差异/);
        assert.match(rubric.capacity, /具体行动矛盾仍须返修/);
        assert.match(rubric.capacity, /请求全部必要来源/);
        const { capacity, ...others } = rubric, { capacity: oldCapacity, ...oldOthers } = oldRubric;
        assert.notEqual(capacity, oldCapacity);
        assert.deepEqual(others, oldOthers);
      } else assert.deepEqual(rubric, input.rubric, 'final synthesis still judges whole-book capacity');
      const result = stagePass(after);
      if (stage.id === 'batch-1') Object.assign(result.checks.find(c => c.criterion === 'capacity')!, {
        verdict, explanation: '已有地域只改名，行动规则与资源代价没有差异', revisionAdvice: '补足影响行动的真实差异',
        ...(verdict === 'insufficient' ? { insufficiencyReason: 'missing_design' } : {}),
      });
      acceptDesignReviewStage(current, stage, result);
      acceptDesignReviewStage(previous, oldStage, structuredClone(result));
    }
    assert.equal(completeDesignReviewRun(JSON.parse(JSON.stringify(current))).result.checks.find(c => c.criterion === 'capacity')!.verdict, verdict);
    assert.equal(completeDesignReviewRun(previous).result.checks.find(c => c.criterion === 'capacity')!.verdict, verdict);
  }
  const whole = createDesignReviewRun({ ...input, sources: [{ id: 'all', text: '一次完整提供的世界材料' }] });
  assert.deepEqual(designReviewStageInput(whole, whole.stages[0]).rubric, input.rubric);
  const custom = createDesignReviewRun({ ...input, rubric: { capacity: '作者指定：必须核对所有地域的差异' } });
  assert.match(designReviewStageInput(custom, custom.stages[0]).rubric.capacity, /作者指定：必须核对所有地域的差异/);
  assert.doesNotMatch(designReviewStageInput(custom, custom.stages[0]).rubric.capacity, /本批实际提供的世界差异/);
});

test('v25 scopes characters locally while preserving evidence, global standards and every negative criterion', () => {
  const input: DesignReviewInput = { ...largeInput(), area: 'characters', rubric: { ...designReviewRubrics.characters } };
  const old = createDesignReviewRun(input, '2026-10-15T00:00:00Z', 24);
  const markers = { agency: /核验本批实际提供的人物目标/, relationships: /核对本批实际出现的关系初始状态/, knowledge: /核验本批人物知道、相信或误解什么/ };
  for (const verdict of ['revise', 'insufficient'] as const) {
    const previous = structuredClone(old), current = createDesignReviewRun(input, old.createdAt, 25);
    assert.deepEqual(current.units, previous.units);
    assert.deepEqual(current.stages, previous.stages, 'every raw partition and cross pair is retained');
    for (const stage of current.stages) {
      const oldStage = previous.stages.find(s => s.id === stage.id)!;
      const before = designReviewStageInput(previous, oldStage), after = designReviewStageInput(current, stage);
      const { rubric, ...rest } = after, { rubric: oldRubric, ...oldRest } = before;
      assert.deepEqual(rest, oldRest, 'sources, citation rules, capacities and pending findings stay identical');
      if (after.stage!.coverage!.mode === 'local_sources') {
        for (const [criterion, marker] of Object.entries(markers)) {
          assert.match(rubric[criterion], marker);
          assert.doesNotMatch(oldRubric[criterion], marker, 'explicit v24 remains reproducible');
          assert.ok(oldRubric[criterion].includes(input.rubric[criterion]));
          assert.match(rubric[criterion], /请求全部必要来源/);
          assert.match(rubric[criterion], /返修/);
        }
        assert.deepEqual(Object.keys(rubric), Object.keys(input.rubric));
      } else assert.deepEqual(rubric, input.rubric, 'synthesis still judges the complete character design');
      const result = stagePass(after);
      if (stage.id === 'batch-1') for (const check of result.checks) Object.assign(check, {
        verdict, explanation: '人物无动机改变态度且提前知道秘密', revisionAdvice: '补足选择、关系转变与知情来源',
        ...(verdict === 'insufficient' ? { insufficiencyReason: 'missing_design' } : {}),
      });
      acceptDesignReviewStage(current, stage, result);
      acceptDesignReviewStage(previous, oldStage, structuredClone(result));
    }
    for (const run of [JSON.parse(JSON.stringify(current)), previous]) {
      const completed = completeDesignReviewRun(run);
      assert.deepEqual(completed.input.rubric, input.rubric);
      assert.deepEqual(completed.result.checks.map(c => c.verdict), Object.keys(input.rubric).map(() => verdict));
    }
  }
  const whole = createDesignReviewRun({ ...input, sources: [{ id: 'all', text: '完整人物材料' }] });
  assert.deepEqual(designReviewStageInput(whole, whole.stages[0]).rubric, input.rubric);
  const customInput = { ...input, rubric: Object.fromEntries(Object.keys(markers).map(key => [key, `作者自定义人物标准：${key}`])) };
  const chapterInput: DesignReviewInput = { ...input, purpose: 'chapter_review' };
  for (const unchanged of [customInput, chapterInput]) {
    const previous = createDesignReviewRun(unchanged, old.createdAt, 24), current = createDesignReviewRun(unchanged, old.createdAt, 25);
    assert.deepEqual(designReviewStageInput(current, current.stages[0]), designReviewStageInput(previous, previous.stages[0]));
  }
});

test('v8 changes only local summary guidance and preserves v7 replay and real revision blockers', () => {
  const input: DesignReviewInput = { ...largeInput(), area: 'power', rubric: { ...designReviewRubrics.power } };
  const old = createDesignReviewRun(input, undefined, 7);
  const current = createDesignReviewRun(input, undefined, 8);
  assert.deepEqual(current.units, old.units);
  assert.deepEqual(current.stages, old.stages);
  for (const stage of current.stages) {
    const before = designReviewStageInput(old, old.stages.find(s => s.id === stage.id)!);
    const after = designReviewStageInput(current, stage);
    assert.deepEqual(after.sources, before.sources, 'no missing-source claim may be repaired by invented source text');
    assert.deepEqual(after.stage, before.stage);
    if (after.stage!.coverage!.mode === 'local_sources') {
      assert.doesNotMatch(before.rubric.costs, /摘要未列某项费用/);
      assert.match(after.rubric.costs, /摘要未列某项费用/);
      assert.match(after.rubric.costs, /规则自身缺陷仍须独立检查/);
    } else assert.deepEqual(after.rubric, input.rubric);
    const result = stagePass(after);
    if (stage.id === 'batch-1') result.checks[0] = { ...result.checks[0], verdict: 'revise', explanation: '已提供规则明确取消代价', revisionAdvice: '保留原代价' };
    acceptDesignReviewStage(current, stage, result);
    acceptDesignReviewStage(old, old.stages.find(s => s.id === stage.id)!, structuredClone(result));
  }
  assert.equal(completeDesignReviewRun(JSON.parse(JSON.stringify(current))).result.checks[0].verdict, 'revise');
  assert.equal(completeDesignReviewRun(JSON.parse(JSON.stringify(old))).result.checks[0].verdict, 'revise');
  const whole = createDesignReviewRun({ ...input, sources: [{ id: 'complete', text: '当前已提供完整规则和细纲' }] });
  assert.deepEqual(designReviewStageInput(whole, whole.stages[0]).rubric, input.rubric);
});

test('v9 locates existing macro sources by chapter range without granting unread evidence or removing blockers', () => {
  const input: DesignReviewInput = { ...largeInput(), area: 'world', rubric: { geography: '核对跨海的日期、航款与准入' } };
  const boundary = { id: 'plan/milestones/boundary', text: JSON.stringify({ title: '北港救援', startChapter: 61, endChapter: 66, setup: ['船已到港，但入港许可仍未取得。'] }) };
  input.sources.unshift({ id: 'plan/overview', text: JSON.stringify({ targetChapterCount: 100, detailedThroughChapter: 50, outlinedChapterNumbers: [1, 50] }) });
  input.sources.push(boundary,
    { id: 'plan/volumes/second', text: JSON.stringify({ title: '北海', startChapter: 33, endChapter: 66 }) },
    { id: 'plan/milestones/invalid', text: JSON.stringify({ startChapter: 80, endChapter: 60 }) },
    { id: 'plan/milestones/text', text: '没有结构化的章号，不能靠名称猜范围。' },
    { id: 'story/volumes/not-a-plan-range', text: JSON.stringify({ startChapter: 61, endChapter: 66 }) });
  const current = createDesignReviewRun(input, undefined, 9), legacy = createDesignReviewRun(input, undefined, 8);
  assert.deepEqual(current.units, legacy.units);
  assert.deepEqual(current.stages, legacy.stages);
  const first = designReviewStageInput(current, current.stages[0]);
  assert.ok(!first.stage!.sourceMap.some(u => u.sourceId === boundary.id));
  assert.deepEqual(first.stage!.coverage!.planRanges, [
    { sourceId: boundary.id, startChapter: 61, endChapter: 66, title: '北港救援' },
    { sourceId: 'plan/volumes/second', startChapter: 33, endChapter: 66, title: '北海' },
  ]);
  assert.equal(Object.hasOwn(first.stage!.coverage!.sourceLengths, 'plan/chapters/61'), false);
  const unreadCitation = stagePass(first);
  unreadCitation.checks[0].evidence = [{ sourceId: boundary.id, quote: boundary.text }];
  assert.throws(() => acceptDesignReviewStage(current, current.stages[0], unreadCitation), /引用不在原文/);
  const invented = stagePass(first);
  invented.checks[0] = { ...invented.checks[0], verdict: 'insufficient', revisionAdvice: '补读不存在的细纲', awaitingSources: ['plan/chapters/61'] };
  assert.throws(() => acceptDesignReviewStage(current, current.stages[0], invented), /不在完整目录/);
  for (const stage of current.stages) {
    const after = designReviewStageInput(current, stage);
    const oldStage = legacy.stages.find(s => s.id === stage.id)!;
    const before = designReviewStageInput(legacy, oldStage);
    assert.equal(before.stage!.coverage!.planRanges, undefined);
    assert.deepEqual(after.sources, before.sources);
    if (after.stage!.coverage!.mode === 'local_sources') {
      assert.match(after.rubric.geography, /目录没有某章不等于作品缺少该章/);
      assert.doesNotMatch(before.rubric.geography, /coverage.planRanges/);
    }
    const result = stagePass(after);
    if (stage.id === 'batch-1') result.checks[0] = { ...result.checks[0], verdict: 'insufficient', explanation: '尚无法确认具体准入条件', revisionAdvice: '核实准入而不是自动放行' };
    acceptDesignReviewStage(current, stage, result);
    acceptDesignReviewStage(legacy, oldStage, result);
    const restored = JSON.parse(JSON.stringify(current));
    assert.deepEqual(designReviewStageInput(restored, restored.stages.find((s: { id: string }) => s.id === stage.id)), after);
  }
  assert.equal(completeDesignReviewRun(current).result.checks[0].verdict, 'insufficient');
  assert.equal(completeDesignReviewRun(legacy).result.checks[0].verdict, 'insufficient');
});

test('legacy v26: dedicated follow-ups cannot recursively defer or omit evidence, and unresolved oversized questions remain blockers', () => {
  const run = threePartitionRun(); finishRawWithThirdPartitionQuestion(run);
  const stage = run.stages.find(s => s.followupFor)!;
  const input = designReviewStageInput(run, stage);
  const recursive = stagePass(input);
  recursive.checks[0] = { ...recursive.checks[0], verdict: 'insufficient', revisionAdvice: '还要第三条来源', awaitingSources: ['other'] };
  assert.throws(() => acceptDesignReviewStage(run, stage, recursive), /不得递归/);
  const partial = resolvePending(input);
  partial.checks[0].evidence = partial.checks[0].evidence.filter(e => e.sourceId !== input.stage!.coverage!.pendingChecks![0].questionSourceId);
  assert.throws(() => acceptDesignReviewStage(run, stage, partial), /必须引用原问题/);
  for (const version of [4, 5] as const) {
    const oversized = threePartitionRun(version);
    // With no cited basis, narrowing an over-capacity original batch would
    // invent relevance. V4 must also retain its historical frozen schedule.
    finishRawWithThirdPartitionQuestion(oversized, false);
    assert.ok(!oversized.stages.some(s => s.followupFor));
    for (const s of oversized.stages.filter(s => !s.result)) acceptDesignReviewStage(oversized, s, stagePass(designReviewStageInput(oversized, s)));
    assert.equal(completeDesignReviewRun(oversized).result.checks[0].verdict, 'insufficient');
  }
  const hugeInput = threePartitionRun().input;
  hugeInput.sources.find(s => s.id === 'early')!.text += '不可截去的原始上下文。'.repeat(14000);
  const huge = createDesignReviewRun(hugeInput, undefined, 26);
  finishRawWithThirdPartitionQuestion(huge);
  assert.ok(!huge.stages.some(s => s.followupFor), 'a cited source too large to co-read must not be reduced to its quotation');
  for (const s of huge.stages.filter(s => !s.result)) acceptDesignReviewStage(huge, s, stagePass(designReviewStageInput(huge, s)));
  assert.equal(completeDesignReviewRun(huge).result.checks[0].verdict, 'insufficient');
});

test('a follow-up expands cited sources split outside the original batch even when the original batch fits', () => {
  const input = threePartitionRun().input;
  input.sources = [
    { id: 'early', text: '第9日寄出书信，送达前收信人不能知情。' + '日程说明。'.repeat(24000) },
    { id: 'other', text: '独立支线。'.repeat(24000) },
    { id: 'arrival', text: '第12日书信实际送达。' + '送达说明。'.repeat(8000) },
  ];
  const run = createDesignReviewRun(input);
  for (const stage of run.stages.filter(s => s.kind !== 'synthesis')) {
    const staged = designReviewStageInput(run, stage), result = stagePass(staged);
    if (stage.id === 'batch-1') result.checks[0] = { ...result.checks[0], verdict: 'insufficient', explanation: '需核验书信送达', revisionAdvice: '补读送达原文', awaitingSources: ['arrival'] };
    acceptDesignReviewStage(run, stage, result);
  }
  const followup = run.stages.find(s => s.followupFor === 'batch-1/timeline')!;
  const staged = designReviewStageInput(run, followup);
  for (const sourceId of ['early', 'arrival']) {
    const ids = staged.stage!.sourceMap.filter(u => u.sourceId === sourceId).map(u => u.id);
    assert.equal(staged.sources.filter(s => ids.includes(s.id)).map(s => s.text).join(''), input.sources.find(s => s.id === sourceId)!.text);
  }
  assert.ok(JSON.stringify(staged.sources).length <= 240_000);
});

test('legacy v26: v10 names locate the correct unread artifact without turning directory labels into evidence', () => {
  const input = largeInput();
  input.area = 'power';
  input.rubric = { tiers: '核剑器承载，不可拿符佩替代' };
  const sword = { id: 'world/artifacts/art_03', text: JSON.stringify({ name: '赤霞斩铁剑', limitations: ['不得强灌玄府元罡'], detail: '原始器身规则。'.repeat(1000) }) };
  input.sources = [
    { id: 'world/axioms/fill', text: JSON.stringify({ title: '公共规则', content: '规'.repeat(38_000) }) },
    ...input.sources,
    { id: 'world/artifacts/art_02', text: JSON.stringify({ name: '青木护身符佩', detail: '护身不是剑器。'.repeat(1000) }) },
    sword,
    { id: 'world/artifacts/invalid', text: '不是结构化名称' },
    { id: 'world/artifacts/array', text: JSON.stringify([{ name: '不能捏造条目名' }]) },
  ];
  const run = createDesignReviewRun(input, undefined, 26), legacy = createDesignReviewRun(input, undefined, 9);
  assert.deepEqual(run.units, legacy.units);
  assert.deepEqual(run.stages, legacy.stages);
  const first = designReviewStageInput(run, run.stages[0]);
  assert.ok(!first.stage!.sourceMap.some(u => u.sourceId === sword.id));
  assert.equal(first.stage!.coverage!.sourceNames![sword.id], '赤霞斩铁剑');
  assert.equal(first.stage!.coverage!.sourceNames!['world/artifacts/art_02'], '青木护身符佩');
  assert.equal(first.stage!.coverage!.sourceNames!['world/artifacts/invalid'], undefined);
  assert.equal(first.stage!.coverage!.sourceNames!['world/artifacts/array'], undefined);
  assert.equal(designReviewStageInput(legacy, legacy.stages[0]).stage!.coverage!.sourceNames, undefined);
  assert.deepEqual(designReviewStageInput(JSON.parse(JSON.stringify(run)), run.stages[0]), first);
  const unread = stagePass(first);
  unread.checks[0].evidence = [{ sourceId: sword.id, quote: '赤霞斩铁剑' }];
  assert.throws(() => acceptDesignReviewStage(run, run.stages[0], unread), /引用不在原文/);
  const pending = stagePass(first);
  pending.checks[0] = { ...pending.checks[0], verdict: 'insufficient', explanation: '待核剑器承载', revisionAdvice: '按名称定位剑器原文', awaitingSources: [sword.id] };
  acceptDesignReviewStage(run, run.stages[0], pending);
  let coRead = false;
  for (let i = 1; i < run.stages.length; i++) {
    const stage = run.stages[i];
    const staged = designReviewStageInput(run, stage), result = stagePass(staged);
    const unit = staged.stage!.sourceMap.find(u => u.sourceId === sword.id);
    if (unit && stage.kind !== 'synthesis') {
      coRead = true;
      result.checks[0] = { ...result.checks[0], verdict: 'revise', explanation: '原文明确限制玄府强灌，仍需处理违规使用', revisionAdvice: '保留承载限制', evidence: [{ sourceId: unit.id, quote: '不得强灌玄府元罡' }] };
    }
    acceptDesignReviewStage(run, stage, result);
  }
  assert.ok(coRead);
  assert.equal(completeDesignReviewRun(run).result.checks[0].verdict, 'revise');
});

test('v11 distinguishes partial report trees from complete coverage without replacing v10 materials or criteria', () => {
  const input = largeInput();
  const current = createDesignReviewRun(input, undefined, 11), legacy = createDesignReviewRun(input, current.createdAt, 10);
  assert.deepEqual(current.units, legacy.units);
  assert.deepEqual(current.stages, legacy.stages);
  const rawIds = current.stages.filter(s => s.kind !== 'synthesis').map(s => s.id);
  let intermediate = 0, complete = 0;
  for (let i = 0; i < current.stages.length; i++) {
    const stage = current.stages[i], oldStage = legacy.stages[i];
    const next = designReviewStageInput(current, stage), old = designReviewStageInput(legacy, oldStage);
    assert.deepEqual(next.rubric, old.rubric);
    assert.deepEqual(next.sources, old.sources);
    assert.equal(old.stage!.coverage!.synthesis, undefined);
    const tree = next.stage!.coverage!.synthesis;
    if (stage.kind === 'synthesis') {
      assert.ok(tree);
      assert.equal(tree.totalStages, rawIds.length);
      assert.equal(new Set(tree.coveredStageIds).size, tree.coveredStageIds.length);
      assert.ok(tree.coveredStageIds.every(id => rawIds.includes(id)));
      if (i === current.stages.length - 1) {
        complete++;
        assert.equal(tree.scope, 'complete_reports');
        assert.deepEqual(tree.coveredStageIds, rawIds);
      } else {
        intermediate++;
        assert.equal(tree.scope, 'partial_reports');
        assert.ok(tree.coveredStageIds.length < rawIds.length);
      }
      if (stage.id === 'synthesis-1') assert.deepEqual(tree.coveredStageIds, stage.children);
      const restored = JSON.parse(JSON.stringify(current));
      assert.deepEqual(designReviewStageInput(restored, restored.stages[i]), next);
      const withoutScope = structuredClone(next);
      delete withoutScope.stage!.coverage!.synthesis;
      assert.deepEqual(withoutScope, old);
    } else assert.equal(tree, undefined);
    acceptDesignReviewStage(current, stage, stagePass(next));
    acceptDesignReviewStage(legacy, oldStage, stagePass(old));
  }
  assert.ok(intermediate > 0);
  assert.equal(complete, 1);
  assert.equal(completeDesignReviewRun(current).result.checks[0].verdict, 'pass');
  assert.equal(completeDesignReviewRun(legacy).result.checks[0].verdict, 'pass');
});

test('legacy v26: partial synthesis coverage cannot erase a raw insufficiency or an intermediate contradiction', () => {
  const input = largeInput();
  input.rubric = { timeline: '检查日历', causality: '检查前置因果' };
  const run = createDesignReviewRun(input, undefined, 26);
  for (const stage of run.stages) {
    const staged = designReviewStageInput(run, stage), result = stagePass(staged);
    if (stage.id === 'batch-1') Object.assign(result.checks[0], { verdict: 'insufficient', explanation: '本批明确缺少书信的实际寄出日期', revisionAdvice: '提供寄出日期' });
    if (stage.id === 'synthesis-1') {
      assert.equal(staged.stage!.coverage!.synthesis!.scope, 'partial_reports');
      Object.assign(result.checks[1], { verdict: 'revise', explanation: '前置报告之间存在未支付收入的冲突', revisionAdvice: '修复收入来源' });
      const invalid = structuredClone(result);
      invalid.checks[1].evidence = [{ sourceId: 'coverage.synthesis', quote: 'partial_reports' }];
      assert.throws(() => acceptDesignReviewStage(run, stage, invalid), /引用不在原文/);
    }
    acceptDesignReviewStage(run, stage, result);
  }
  assert.ok(run.stages.at(-1)!.result!.checks.every(c => c.verdict === 'pass'));
  const final = completeDesignReviewRun(run).result;
  assert.equal(final.checks.find(c => c.criterion === 'timeline')!.verdict, 'insufficient');
  assert.equal(final.checks.find(c => c.criterion === 'causality')!.verdict, 'revise');
});

test('v11 complete report coverage includes scheduled followups and still blocks unresolved questions', () => {
  const run = threePartitionRun(11);
  finishRawWithThirdPartitionQuestion(run);
  const followup = run.stages.find(s => s.followupFor)!;
  assert.ok(followup);
  for (const stage of run.stages.filter(s => !s.result)) {
    const input = designReviewStageInput(run, stage);
    acceptDesignReviewStage(run, stage, stagePass(input));
  }
  const finalInput = designReviewStageInput(run, run.stages.at(-1)!);
  const scope = finalInput.stage!.coverage!.synthesis!;
  assert.equal(scope.scope, 'complete_reports');
  assert.ok(scope.coveredStageIds.includes(followup.id));
  assert.deepEqual(scope.coveredStageIds, run.stages.filter(s => s.kind !== 'synthesis').map(s => s.id));
  assert.equal(scope.totalStages, 7);
  const final = completeDesignReviewRun(run).result;
  assert.equal(final.checks[0].verdict, 'insufficient', 'a pass without explicit evidenced resolution cannot clear the original question');
  assert.equal(final.checks[1].verdict, 'revise');
});

test('v12 shows validated resolutions beside historical waits without erasing findings or changing old report rendering', () => {
  for (const explicitlyResolve of [false, true]) {
    const run = threePartitionRun(12);
    finishRawWithThirdPartitionQuestion(run);
    const original = structuredClone(run.stages.find(s => s.id === 'cross-1-2')!.result);
    const followup = run.stages.find(s => s.followupFor)!;
    const input = designReviewStageInput(run, followup);
    const result = explicitlyResolve ? resolvePending(input) : stagePass(input);
    if (explicitlyResolve) {
      const unit = input.stage!.sourceMap.find(u => u.sourceId === 'early')!;
      result.checks[0].evidence.push({ sourceId: unit.id, quote: '第9日寄出书信，送达前收信人不能知情。' });
    }
    acceptDesignReviewStage(run, followup, result);
    const stage = run.stages.find(s => s.kind === 'synthesis' && s.children.includes('cross-1-2'))!;
    const next = designReviewStageInput(run, stage);
    const source = next.sources.find(s => s.id === 'review-result/cross-1-2')!;
    assert.match(source.text, /"verdict": "insufficient"/);
    assert.ok(source.text.includes(original!.checks[0].explanation));
    assert.ok(source.text.includes(original!.checks[0].evidence[0].quote));
    assert.equal(source.text.includes('CURRENT DISPOSITION'), explicitlyResolve);
    const legacy = structuredClone(run); legacy.scheduleVersion = 11;
    const oldSource = designReviewStageInput(legacy, stage).sources.find(s => s.id === source.id)!;
    assert.ok(!oldSource.text.includes('CURRENT DISPOSITION'));
    if (explicitlyResolve) {
      assert.ok(source.text.includes(followup.id));
      assert.ok(source.text.includes(result.checks[0].explanation));
      assert.match(source.text, /resolved_by_raw_review/);
    } else assert.equal(source.text, oldSource.text);
    assert.deepEqual(run.stages.find(s => s.id === 'cross-1-2')!.result, original);
    const restored = JSON.parse(JSON.stringify(run));
    assert.deepEqual(designReviewStageInput(restored, stage), next);
    for (const remaining of run.stages.filter(s => !s.result)) acceptDesignReviewStage(run, remaining, stagePass(designReviewStageInput(run, remaining)));
    const final = completeDesignReviewRun(run).result;
    assert.equal(final.checks[0].verdict, explicitlyResolve ? 'pass' : 'insufficient');
    assert.equal(final.checks[1].verdict, 'revise');
  }
});

test('v12 refuses a resolution note when the underlying raw review evidence is invalid', () => {
  const run = threePartitionRun(12);
  finishRawWithThirdPartitionQuestion(run);
  const followup = run.stages.find(s => s.followupFor)!;
  const input = designReviewStageInput(run, followup), result = resolvePending(input);
  const unit = input.stage!.sourceMap.find(u => u.sourceId === 'early')!;
  result.checks[0].evidence.push({ sourceId: unit.id, quote: '第9日寄出书信，送达前收信人不能知情。' });
  acceptDesignReviewStage(run, followup, result);
  const stage = run.stages.find(s => s.kind === 'synthesis' && s.children.includes('cross-1-2'))!;
  followup.result!.checks[0].evidence = [{ sourceId: unit.id, quote: '捏造的送达证据不能解除等待' }];
  assert.throws(() => designReviewStageInput(run, stage), /引用不在原文|每个原始来源|补读/);
  const ordinary = stagePass(input);
  assert.throws(() => renderDesignReviewReport(ordinary, () => undefined, { timeline: { checkId: 'batch-1/timeline', resolvedByStageId: followup.id, explanation: '无权解除普通判定' } }), /只有显式等待补读项/);
});

test('v16 can cite 63 requested sources plus four original sources without changing a v15 schedule', () => {
  const originals = ['a', 'b', 'c', 'd'].map(id => ({ id: `original/${id}`, text: `原始关系依据${id}，必须与后续全部变更一起核验。` }));
  const requested = Array.from({ length: 63 }, (_, i) => ({ id: `relation/${i + 1}`, text: `关系阶段${i + 1}的独立变化依据。` + '原文条件与选择。'.repeat(160) }));
  const input: DesignReviewInput = { ...largeInput(), area: 'characters', rubric: { relationships: '每个关系变化均须有原始依据' }, sources: [
    ...originals, { id: 'padding-a', text: '旁支背景。'.repeat(16000) }, { id: 'padding-b', text: '另一旁支。'.repeat(16000) }, ...requested,
  ] };
  const results = [];
  for (const version of [15, 16] as const) {
    let run = createDesignReviewRun(input, '2026-10-14T00:00:00Z', version);
    const raw = run.stages.filter(s => s.kind !== 'synthesis');
    for (const stage of raw) {
      const staged = designReviewStageInput(run, stage), result = stagePass(staged);
      if (stage.id === 'batch-1') {
        assert.ok(requested.every(s => !staged.stage!.sourceMap.some(u => u.sourceId === s.id)));
        result.checks[0] = { ...result.checks[0], verdict: 'insufficient', explanation: '四项原始依据与63个关系阶段须一起核对', revisionAdvice: '补读全部63个来源', awaitingSources: requested.map(s => s.id), evidence: originals.map(s => ({ sourceId: staged.stage!.sourceMap.find(u => u.sourceId === s.id)!.id, quote: s.text })) };
      }
      acceptDesignReviewStage(run, stage, result);
    }
    run = JSON.parse(JSON.stringify(run));
    const followup = run.stages.find(s => s.followupFor === 'batch-1/relationships');
    assert.equal(Boolean(followup), version === 16);
    if (followup) {
      const staged = designReviewStageInput(run, followup);
      assert.equal(staged.stage!.evidenceLimit, 96);
      assert.ok(JSON.stringify(staged.sources).length <= 240000);
      for (const source of [...originals, ...requested]) {
        const units = staged.stage!.sourceMap.filter(u => u.sourceId === source.id);
        assert.equal(units.map(u => staged.sources.find(s => s.id === u.id)!.text).join(''), source.text);
      }
      const pending = staged.stage!.coverage!.pendingChecks!.find(p => p.id === followup.followupFor)!;
      const ids = [pending.questionSourceId, ...[...originals, ...requested].map(s => staged.stage!.sourceMap.find(u => u.sourceId === s.id)!.id)];
      const result = stagePass(staged);
      result.checks[0].resolves = [pending.id];
      result.checks[0].evidence = ids.map(id => ({ sourceId: id, quote: staged.sources.find(s => s.id === id)!.text.slice(0, 40) }));
      assert.equal(result.checks[0].evidence.length, 68);
      designReviewResultSchema.parse(result);
      const missing = structuredClone(result); missing.checks[0].evidence.pop();
      assert.throws(() => acceptDesignReviewStage(run, followup, missing), /每个新增来源/);
      const oversized = structuredClone(result);
      oversized.checks[0].evidence = Array.from({ length: 97 }, () => result.checks[0].evidence[0]);
      assert.throws(() => acceptDesignReviewStage(run, followup, oversized), /不得超过96条/);
      acceptDesignReviewStage(run, followup, result);
    }
    for (const stage of run.stages.filter(s => !s.result)) {
      const staged = designReviewStageInput(run, stage);
      assert.ok(JSON.stringify(staged.sources).length <= 240000);
      if (version === 15) assert.equal(staged.stage!.evidenceLimit, undefined);
      acceptDesignReviewStage(run, stage, stagePass(staged));
    }
    results.push(completeDesignReviewRun(JSON.parse(JSON.stringify(run))).result);
    assert.equal(run.stages[0].result!.checks[0].verdict, 'insufficient', 'original finding remains immutable');
  }
  assert.equal(results[0].checks[0].verdict, 'insufficient');
  assert.equal(results[1].checks[0].verdict, 'pass');
  assert.deepEqual(results[1].resolvedDeferrals, [{ checkId: 'batch-1/relationships', resolvedByStageId: 'followup-batch-1/relationships' }]);
});

test('v17 predicts exact saved report envelopes and retains v16 request reconstruction', () => {
  const request = largeInput();
  const current = createDesignReviewRun(request, undefined, 17);
  assert.equal(current.scheduleVersion, 17);
  const legacy = createDesignReviewRun(request, current.createdAt, 16);
  assert.deepEqual(current.units, legacy.units);
  assert.deepEqual(current.stages, legacy.stages);
  const sizes = new Map<string, number>();
  for (const stage of current.stages) {
    const input = designReviewStageInput(current, stage);
    assert.deepEqual(input.stage!.reportBudget, { sourceId: `review-result/${stage.id}`, maxCharacters: 90000 });
    for (const child of stage.children) {
      const source = input.sources.find(s => s.id === `review-result/${child}`)!;
      assert.equal(JSON.stringify([source]).length, sizes.get(child), 'same quote positions, uniqueness, escaping and envelope as the scheduler');
    }
    const result = stagePass(input);
    sizes.set(stage.id, designReviewReportEnvelopeSize(input, result, `review-result/${stage.id}`));
    acceptDesignReviewStage(current, stage, result);
    const oldStage = legacy.stages.find(s => s.id === stage.id)!;
    const oldInput = designReviewStageInput(legacy, oldStage);
    assert.equal(oldInput.stage!.reportBudget, undefined);
    const withoutBudget = structuredClone(input);
    delete withoutBudget.stage!.reportBudget;
    assert.deepEqual(oldInput, withoutBudget, 'legacy sources, rubric, evidence limits and offsets stay unchanged');
    acceptDesignReviewStage(legacy, oldStage, result);
  }
  assert.equal(completeDesignReviewRun(JSON.parse(JSON.stringify(current))).result.checks[0].verdict, 'pass');
  assert.equal(completeDesignReviewRun(JSON.parse(JSON.stringify(legacy))).result.checks[0].verdict, 'pass');
});

test('v18 classifies new local model judgments without changing legacy raw coverage or synthesis', () => {
  const input = largeInput(), current = createDesignReviewRun(input, undefined, 18), previous = createDesignReviewRun(input, current.createdAt, 17);
  assert.equal(current.scheduleVersion, 18);
  assert.deepEqual(current.units, previous.units);
  assert.deepEqual(current.stages, previous.stages);
  for (const stage of current.stages) {
    const staged = designReviewStageInput(current, stage);
    assert.equal(staged.stage!.requireInsufficiencyReason, stage.kind === 'synthesis' ? undefined : true);
    const oldStage = previous.stages.find(s => s.id === stage.id)!;
    const oldInput = designReviewStageInput(previous, oldStage);
    const copy = structuredClone(staged); delete copy.stage!.requireInsufficiencyReason;
    assert.deepEqual(copy, oldInput);
    const result = stagePass(staged);
    acceptDesignReviewStage(current, stage, result);
    acceptDesignReviewStage(previous, oldStage, result);
  }
  assert.deepEqual(completeDesignReviewRun(current).result, completeDesignReviewRun(previous).result);
});
