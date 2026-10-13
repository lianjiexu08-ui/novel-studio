import test from 'node:test';
import assert from 'node:assert/strict';
import { ChapterWorkflow, InMemoryWorkRepository, type DesignProvider } from '../src/index.ts';
import { createReadyWork } from './fixtures.ts';
import { designReviewInput, designReviewOverview, type DesignReviewInput, type DesignReviewResult } from '../../../novel-service-core/src/design-review.ts';
import { createDesignReviewRun, designReviewStageInput, acceptDesignReviewStage, completeDesignReviewRun } from '../../../novel-service-core/src/design-review-run.ts';

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

test('a contradiction spanning distant partitions cannot be erased by synthesis', () => {
  const run = createDesignReviewRun(largeInput());
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
  assert.equal(run.scheduleVersion, 3);
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

test('synthesis receives the exact rolling horizon but cannot erase a previous insufficient verdict', () => {
  const input = largeInput();
  const overview = { id: 'plan/overview', text: JSON.stringify({ targetChapterCount: 100, detailedThroughChapter: 50, outlinedChapterNumbers: [1, 2, 50], openQuestions: ['261–270日休养来源未定'] }) };
  input.sources.unshift(overview);
  const run = createDesignReviewRun(input);
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
  return createDesignReviewRun(input);
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

test('separately reading pieces of a requested source never settles a joint check', () => {
  const run = createDesignReviewRun(largeInput());
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
