import test from 'node:test';
import assert from 'node:assert/strict';
import { ChapterWorkflow, InMemoryWorkRepository, type DesignProvider } from '../src/index.ts';
import { createReadyWork } from './fixtures.ts';
import { designReviewInput, designReviewOverview, type DesignReviewInput, type DesignReviewResult } from '../../../novel-service-core/src/design-review.ts';
import { createDesignReviewRun, designReviewStageInput, acceptDesignReviewStage, completeDesignReviewRun } from '../../../novel-service-core/src/design-review-run.ts';
import { renderDesignReviewReport } from '../../../novel-service-core/src/design-review-report.ts';

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
  assert.equal(run.scheduleVersion, 6);
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

const chapterPairInput = (): DesignReviewInput => ({ ...largeInput(), sources: [
  { id: 'story/chapterPlans/bible-chapter-50', text: JSON.stringify({ chapterNumber: 50, purpose: '一剑支出二成，结束时余一成半。' }) },
  ...largeInput().sources,
  { id: 'plan/chapters/50', text: JSON.stringify({ chapterNumber: 50, cost: '沿用第48章复测余额三成半，一剑二成后余一成半，停止施术。' }) },
] });

test('chapter summaries and detailed ledgers are co-read without discarding either source', () => {
  const input = chapterPairInput(), run = createDesignReviewRun(input);
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

function threePartitionRun(version: 4 | 5 | 6 = 6) {
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

test('dedicated follow-ups cannot recursively defer or omit evidence, and unresolved oversized questions remain blockers', () => {
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
  const huge = createDesignReviewRun(hugeInput);
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
