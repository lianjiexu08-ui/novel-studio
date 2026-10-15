import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ChapterWorkflow, InMemoryWorkRepository, type DesignProvider, type PlanProvider } from '../src/index.ts';
import { JsonWorkRepository } from '../../persistence/src/json-repository.ts';
import { DesignQuestionConflictError, retainDesignQuestions } from '../../../novel-service-core/src/design-questions.ts';
import { minimalPlan, minimalOutline, minimalWorldPack, minimalStoryBible, createReadyWork } from './fixtures.ts';
import type { UnresolvedQuestion } from '../../../novel-service-core/src/world.ts';
const writer = { generateChapter: () => ({ content: 'unused', proposedEvents: [] }) };
const ledger: UnresolvedQuestion[] = [
  { id: 'cost', question: '突破的寿储来源尚未核实', blocking: true, status: 'open' },
  { id: 'travel', question: '返航的许可和费用须落实', blocking: true, status: 'deferred' },
  { id: 'past', question: '已经明确处理过的旧问题仍保留记录', blocking: false, status: 'resolved' },
];
const extra: UnresolvedQuestion = { id: 'new', question: '新区域资源来源待核', blocking: false, status: 'open' };

test('question retention preserves omitted history, appends only new IDs and rejects ambiguous rewrites', () => {
  const merged = retainDesignQuestions(ledger, [extra]);
  assert.deepEqual(merged, [...ledger, extra]);
  merged[0].question = 'external mutation';
  assert.notEqual(merged[0].question, ledger[0].question);
  for (const change of [{ status: 'resolved' }, { blocking: false }, { question: '直接忽略费用' }]) {
    assert.throws(() => retainDesignQuestions(ledger, [{ ...ledger[0], ...change } as UnresolvedQuestion]), DesignQuestionConflictError);
  }
  assert.throws(() => retainDesignQuestions(ledger, [extra, extra]), /编号重复/);
  assert.throws(() => retainDesignQuestions([ledger[0], ledger[0]], []), /编号重复/);
});

for (const kind of ['world', 'story'] as const) test(`${kind} regeneration carries all retained questions through provider mutation and JSON restart`, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'novel-question-ledger-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'work.json'), world = minimalWorldPack();
  let seen = false;
  const read = (input: { retainedQuestions?: UnresolvedQuestion[] }) => {
    assert.deepEqual(input.retainedQuestions, ledger); seen = true;
    input.retainedQuestions![0].status = 'resolved'; input.retainedQuestions!.pop();
  };
  const design: DesignProvider = {
    generateWorldPack: async input => { read(input); return { ...world, unresolvedQuestions: [extra] }; },
    generateStoryBible: async input => { read(input); input.worldPack.unresolvedQuestions = []; return { ...minimalStoryBible(world), unresolvedQuestions: [extra] }; },
  };
  const workflow = new ChapterWorkflow(new JsonWorkRepository(file), writer, design), work = await workflow.createWork('问题不能消失');
  await workflow.saveWorldPack(work.id, { ...world, unresolvedQuestions: structuredClone(ledger) });
  if (kind === 'story') await workflow.saveStoryBible(work.id, { ...minimalStoryBible(world), unresolvedQuestions: structuredClone(ledger) });
  const before = await new JsonWorkRepository(file).get(work.id), oldHistory = structuredClone([...before!.designHistory]);
  const generated = kind === 'world' ? await workflow.generateWorldPack(work.id) : await workflow.generateStoryBible(work.id);
  assert.ok(seen); assert.equal(generated.status, 'proposed');
  assert.deepEqual(generated.unresolvedQuestions, [...ledger, extra]);
  const restored = (await new JsonWorkRepository(file).get(work.id))!;
  assert.deepEqual((kind === 'world' ? restored.worldPack : restored.storyBible)!.unresolvedQuestions, [...ledger, extra]);
  for (const [id, snapshot] of oldHistory) assert.deepEqual(restored.designHistory.get(id), snapshot);
  if (kind === 'story') assert.deepEqual(restored.worldPack, before!.worldPack);
  await assert.rejects(() => kind === 'world' ? workflow.reviewWorldPack(work.id) : workflow.reviewStoryBible(work.id), /blocking/);
});

for (const kind of ['world', 'story', 'plan'] as const) test(`${kind} conflicting model question cannot save a downgraded proposal`, async () => {
  const output = [{ ...ledger[0], blocking: false, status: 'resolved' as const }];
  const design: DesignProvider = {
    generateWorldPack: async () => ({ ...minimalWorldPack(), unresolvedQuestions: output }),
    generateStoryBible: async ({ worldPack }) => ({ ...minimalStoryBible(worldPack), unresolvedQuestions: output }),
  };
  let outlines = 0;
  const planProvider: PlanProvider = {
    generatePlanSkeleton: async () => ({ ...minimalPlan(), openQuestions: output }),
    generateChapterOutlines: async () => { outlines++; return []; },
  };
  const repository = new InMemoryWorkRepository(), workflow = new ChapterWorkflow(repository, writer, design, { planProvider });
  const work = await createReadyWork(workflow);
  if (kind === 'world') await workflow.saveWorldPack(work.id, { ...work.worldPack!, unresolvedQuestions: structuredClone(ledger) });
  if (kind === 'story') await workflow.saveStoryBible(work.id, { ...work.storyBible!, unresolvedQuestions: structuredClone(ledger) });
  if (kind === 'plan') await workflow.savePlan(work.id, { baseRevisionId: work.activePlanId, plan: { ...minimalPlan(), openQuestions: structuredClone(ledger) } });
  const before = structuredClone(work);
  await assert.rejects(() => kind === 'world' ? workflow.generateWorldPack(work.id) : kind === 'story' ? workflow.generateStoryBible(work.id)
    : workflow.generatePlan(work.id, { targetChapterCount: 10, volumeCount: 1 }), DesignQuestionConflictError);
  assert.deepEqual(structuredClone(work), before); assert.equal(outlines, 0, 'reject the weakened skeleton before generating chapters');
});

test('full plan regeneration retains latest proposal questions separately from the approved narrative baseline', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'novel-plan-questions-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'work.json');
  const provider: PlanProvider = {
    generatePlanSkeleton: async input => {
      assert.deepEqual(input.previousPlan!.openQuestions, []);
      assert.deepEqual(input.retainedQuestions, ledger);
      input.retainedQuestions!.splice(0); input.previousPlan!.openQuestions.push(extra);
      const { chapters, ...skeleton } = minimalPlan(); return { ...skeleton, openQuestions: [extra] };
    },
    generateChapterOutlines: async input => {
      assert.deepEqual(input.skeleton.openQuestions, [...ledger, extra]);
      input.skeleton.openQuestions = []; // must not mutate server baseline across batches
      return Array.from({ length: input.to - input.from + 1 }, (_, i) => minimalOutline(input.from + i));
    },
  };
  const workflow = new ChapterWorkflow(new JsonWorkRepository(file), writer, undefined, { planProvider: provider, outlineBatchSize: 5 });
  const work = await createReadyWork(workflow), active = work.activePlanId!;
  const proposal = await workflow.savePlan(work.id, { baseRevisionId: active, plan: { ...minimalPlan(), openQuestions: structuredClone(ledger) } });
  const result = await workflow.generatePlan(work.id, { targetChapterCount: 10, volumeCount: 1 });
  const restored = (await new JsonWorkRepository(file).get(work.id))!;
  assert.deepEqual(restored.plans.get(result.id)!.plan.openQuestions, [...ledger, extra]);
  assert.deepEqual(restored.plans.get(proposal.id)!.plan.openQuestions, ledger);
  assert.deepEqual(restored.plans.get(active)!.plan.openQuestions, []);
  assert.equal(restored.activePlanId, active); assert.equal(result.status, 'proposed');
  const review = await workflow.reviewPlan(work.id, result.id); assert.equal(review.passed, false);
});
