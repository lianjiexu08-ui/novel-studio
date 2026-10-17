import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesignReviewRun, designReviewStageInput, acceptDesignReviewStage, completeDesignReviewRun, type DesignReviewRun, type DesignReviewStage } from '../../../novel-service-core/src/design-review-run.ts';
import { validateDesignReview, type DesignReviewInput, type DesignReviewResult } from '../../../novel-service-core/src/design-review.ts';
import { prepareDesignReviewEvidence } from '../../planner/src/design-review-evidence.ts';
import { JsonDesignPlanner } from '../../planner/src/index.ts';

const source = (id: string, value: unknown) => ({ id, text: JSON.stringify(value) });
function fixture(version: 32 | 33 = 33, stormText = '风暴中只移动无载索头，水手和船桩承重。') {
  const input: DesignReviewInput = { area: 'story', inputHash: 'a'.repeat(64),
    scope: { worldPackRevision: 1, storyBibleRevision: 1, planRevisionId: 'plan', planRevision: 1 },
    rubric: { causality: '核对货索的实际承力者' }, sources: [
      source('plan/chapters/1', { chapterNumber: 1, scenes: ['里程碑说搬动货索，须核具体动作。'] }),
      { id: 'padding/a', text: '完整原文'.repeat(22500) },
      { id: 'padding/b', text: '完整原文'.repeat(22500) },
      source('plan/chapters/31', { chapterNumber: 31, scenes: ['验货登船，没有风暴搬箱。'] }),
      { id: 'padding/c', text: '完整原文'.repeat(22500) },
      source('plan/chapters/32', { chapterNumber: 32, scenes: [stormText] }),
      { id: 'padding/d', text: '完整原文'.repeat(22500) },
      source('plan/chapters/33', { chapterNumber: 33, scenes: ['之后到港交割，先核借符余量。'] }),
      { id: 'padding/e', text: '完整原文'.repeat(22500) },
      source('plan/chapters/34', { chapterNumber: 34, scenes: ['下一日的独立费用。'] }),
    ] };
  const run = createDesignReviewRun(input, undefined, version);
  for (const stage of [...run.stages.filter(s => s.kind !== 'synthesis')]) {
    const request = designReviewStageInput(run, stage);
    const result = answer(request);
    if (stage.id === 'batch-1') {
      result.checks[0] = { ...result.checks[0], verdict: 'insufficient', explanation: '目录指到第31章，尚未读到具体承力动作。',
        revisionAdvice: '先补读31章。', awaitingSources: ['plan/chapters/31'] };
    }
    acceptDesignReviewStage(run, stage, result);
  }
  return run;
}
function answer(input: DesignReviewInput, resolves?: string[]): DesignReviewResult {
  const check = { criterion: 'causality', verdict: 'pass' as const, explanation: '按本批实际原文核对承力者，不据摘要推断。', revisionAdvice: '',
    evidence: input.sources.map(s => ({ sourceId: s.id, quote: s.text.slice(0, 40) })), ...(resolves ? { resolves } : {}) };
  // Most fixtures have fewer sources than the citation limit, but ordinary
  // batches need only a representative quote; followups cite their whole basis.
  if (!input.stage?.followupFor) check.evidence = check.evidence.slice(0, 1);
  return { summary: '实际核对结论', checks: [check] };
}
function unread(run: DesignReviewRun, stage: DesignReviewStage, chapter: number) {
  const input = designReviewStageInput(run, stage);
  const result = answer(input);
  result.checks[0] = { ...result.checks[0], verdict: 'insufficient', explanation: `已读材料尚不能核对，需第${chapter}章的实际动作。`,
    revisionAdvice: `读取第${chapter}章并保留原问题。`, awaitingSources: [`plan/chapters/${chapter}`] };
  return result;
}
const nextRaw = (run: DesignReviewRun) => run.stages.find(s => s.kind !== 'synthesis' && !s.result)!;

test('planner transport carries chained questions and binds both resolutions to actual source fragments', async () => {
  const run = fixture(), first = nextRaw(run);
  let calls = 0;
  const planner = new JsonDesignPlanner({ complete: async request => {
    const sent = JSON.parse(request.user);
    assert.match(request.system, /不能因子问题通过就自动解除祖先/);
    const pending = sent.stage.coverage.pendingChecks;
    assert.equal(sent.pendingCitationRequirements.length, calls + 1);
    assert.equal(sent.stage.followupBudget.remainingRounds, 2 - calls);
    const check = calls++ === 0
      ? { verdict: 'insufficient', explanation: '31章只有登船验货，具体承力动作需补读32章。', revisionAdvice: '读取32章核定。', awaitingSources: ['plan/chapters/32'] }
      : { verdict: 'pass', explanation: '31章没有搬箱动作；32章限定无载索头，水手和船桩承重，同时解决原始承力问题和错章定位问题。', revisionAdvice: '', resolves: pending.map((p: { id: string }) => p.id) };
    const ids = [...new Set<string>(sent.pendingCitationRequirements.flatMap((p: { requiredSources: Array<{ units: Array<{ fragmentIds: string[] }> }> }) =>
      p.requiredSources.map(s => s.units[0].fragmentIds[0])))];
    return JSON.stringify({ requestId: sent.requestId, summary: '按实际原文复核', checks: [{ criterion: 'causality', ...check, evidence: ids.map(fragmentId => ({ fragmentId })) }] });
  } });
  for (let round = 0; round < 2; round++) {
    const stage = nextRaw(run), request = designReviewStageInput(run, stage);
    const { modelResponses, ...result } = await planner.reviewDesignContent(request);
    assert.equal(modelResponses!.length, 1);
    acceptDesignReviewStage(run, stage, result);
  }
  assert.equal(calls, 2);
  assert.equal(first.result!.checks[0].verdict, 'insufficient');
  const synthesis = run.stages.find(s => s.kind === 'synthesis')!;
  assert.equal(designReviewStageInput(run, synthesis).stage!.coverage!.resolvedDeferrals!.length, 2);
});

test('correcting a chapter lookup retains the original question and requires explicit evidence for both resolutions', () => {
  const run = fixture(), first = nextRaw(run);
  const before = structuredClone(first);
  const firstInput = designReviewStageInput(run, first);
  assert.equal(firstInput.stage!.followupBudget!.remainingRounds, 2);
  assert.ok(!firstInput.stage!.sourceMap.some(u => u.sourceId === 'plan/chapters/32'));
  acceptDesignReviewStage(run, first, unread(run, first, 32));
  const second = nextRaw(run), input = designReviewStageInput(run, second);
  assert.equal(input.stage!.followupBudget!.remainingRounds, 1);
  const pending = input.stage!.coverage!.pendingChecks!;
  assert.deepEqual(pending.map(p => p.id), [before.followupFor, `${first.id}/causality`]);
  for (const id of ['plan/chapters/31', 'plan/chapters/32']) {
    const units = input.stage!.sourceMap.filter(u => u.sourceId === id).sort((a,b) => a.start-b.start);
    assert.equal(units.map(u => input.sources.find(s => s.id === u.id)!.text).join(''), run.input.sources.find(s => s.id === id)!.text);
  }
  const packet = prepareDesignReviewEvidence(input);
  assert.deepEqual(packet.pendingCitationRequirements!.map(p => p.checkId), pending.map(p => p.id));
  const pass = answer(input, pending.map(p => p.id));
  const incomplete = structuredClone(pass);
  incomplete.checks[0].evidence = incomplete.checks[0].evidence.filter(e => e.sourceId !== pending[0].questionSourceId);
  assert.throws(() => validateDesignReview(input, incomplete), /必须引用|缺少/);
  acceptDesignReviewStage(run, second, pass);
  assert.equal(first.result!.checks[0].verdict, 'insufficient', 'Reading the right chapter never rewrites the earlier result');
  for (const stage of run.stages.filter(s => s.kind === 'synthesis')) acceptDesignReviewStage(run, stage, answer(designReviewStageInput(run, stage)));
  const final = completeDesignReviewRun(run);
  assert.equal(final.result.checks[0].verdict, 'pass');
  assert.deepEqual(final.result.resolvedDeferrals?.map(r => r.checkId), pending.map(p => p.id));
  assert.deepEqual(completeDesignReviewRun(JSON.parse(JSON.stringify(run))), final, 'Restart reconstructs every added round');
  const tampered = structuredClone(run); tampered.stages = tampered.stages.filter(s => s.id !== second.id);
  assert.throws(() => completeDesignReviewRun(tampered), /未完成/);
});

test('passing a child question never implicitly resolves its ancestor', () => {
  const run = fixture(), first = nextRaw(run);
  acceptDesignReviewStage(run, first, unread(run, first, 32));
  const second = nextRaw(run), input = designReviewStageInput(run, second);
  acceptDesignReviewStage(run, second, answer(input, [second.followupFor!]));
  const next = run.stages.find(s => s.kind === 'synthesis')!;
  const resolved = designReviewStageInput(run, next).stage!.coverage!.resolvedDeferrals!;
  assert.ok(resolved.some(r => r.checkId === second.followupFor));
  assert.ok(!resolved.some(r => r.checkId === first.followupFor));
});

test('nested source reads stop after three rounds and cannot rerequest supplied material', () => {
  const run = fixture(), first = nextRaw(run);
  assert.throws(() => acceptDesignReviewStage(run, first, unread(run, first, 31)), /已完整提供/);
  acceptDesignReviewStage(run, first, unread(run, first, 32));
  const second = nextRaw(run); acceptDesignReviewStage(run, second, unread(run, second, 33));
  const third = nextRaw(run), input = designReviewStageInput(run, third);
  assert.equal(input.stage!.followupBudget!.remainingRounds, 0);
  assert.throws(() => acceptDesignReviewStage(run, third, unread(run, third, 34)), /不得递归/);
  const unresolved = answer(input); unresolved.checks[0] = { ...unresolved.checks[0], verdict: 'insufficient', revisionAdvice: '保留未核对范围，另行处理。' };
  acceptDesignReviewStage(run, third, unresolved);
  assert.equal(run.stages.filter(s => s.followupFor).length, 3);
  assert.equal(nextRaw(run), undefined);
});

test('schedule32 retains its one-round rule and ordinary insufficiency cannot create new reads', () => {
  const legacy = fixture(32), stage = nextRaw(legacy);
  assert.equal(designReviewStageInput(legacy, stage).stage!.followupBudget, undefined);
  assert.throws(() => acceptDesignReviewStage(legacy, stage, unread(legacy, stage, 32)), /不得递归/);
  const run = fixture(), current = nextRaw(run), input = designReviewStageInput(run, current);
  const result = answer(input); result.checks[0] = { ...result.checks[0], verdict: 'revise', revisionAdvice: '原规则互相矛盾，必须修订。' };
  acceptDesignReviewStage(run, current, result);
  assert.equal(nextRaw(run), undefined);
  assert.equal(current.result!.checks[0].verdict, 'revise');
});

test('an oversized next source stays unresolved rather than truncating it or dropping ancestor evidence', () => {
  const run = fixture(33, '不可截断的后续动作。'.repeat(30000)), first = nextRaw(run);
  acceptDesignReviewStage(run, first, unread(run, first, 32));
  assert.equal(run.stages.filter(s => s.followupFor).length, 1);
  assert.equal(nextRaw(run), undefined);
  assert.deepEqual(first.result!.checks[0].awaitingSources, ['plan/chapters/32']);
  for (const stage of run.stages.filter(s => s.kind === 'synthesis')) {
    const result = answer(designReviewStageInput(run, stage));
    result.checks[0] = { ...result.checks[0], verdict: 'insufficient', revisionAdvice: '完整所需来源超过容量，保留原等待。' };
    acceptDesignReviewStage(run, stage, result);
  }
  assert.equal(completeDesignReviewRun(run).result.checks[0].verdict, 'insufficient');
  assert.equal(run.input.sources.find(s => s.id === 'plan/chapters/32')!.text.length > 240000, true);
});
