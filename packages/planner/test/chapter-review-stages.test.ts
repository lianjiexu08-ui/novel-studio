import { passingStageOutput } from './chapter-review-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleChapterProvider } from '../src/index.ts';
import { ChapterWorkflow, InMemoryWorkRepository } from '../../application/src/index.ts';
import { createReadyWork } from '../../application/test/fixtures.ts';
import { chapterReviewInput, chapterReviewStatus, restoreChapterReviewRun, validateChapterReview, type ChapterReviewStageProof } from '../../../novel-service-core/src/chapter-review.ts';
import { emptyUsage } from '../../../novel-service-core/src/core.ts';

async function largeInput() {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, { generateChapter: () => ({ content: '他按住伤口，放弃追击，先将同伴带回城中。', proposedEvents: [], observedEvents: [] }) });
  const work = await createReadyWork(workflow, '大材料正文评审');
  await repository.transaction(work.id, ({ work }) => {
    work.worldPack!.summary = '完整世界规则需要逐条核对。'.repeat(12_000);
    work.storyBible!.summary = '人物和剧情材料全部保留。'.repeat(14_000);
  });
  const candidate = await workflow.generate(work.id, 1, 'large');
  return chapterReviewInput((await repository.get(work.id))!, candidate);
}

test('large chapter review keeps full draft in each raw batch and resumes without repeating completed calls', async () => {
  const input = await largeInput();
  assert.ok(JSON.stringify(input).length > 300_000);
  const run = restoreChapterReviewRun(input);
  const draftIds = run.units.filter(u => u.sourceId === 'draft').map(u => u.id);
  assert.ok(run.stages.filter(s => s.kind !== 'synthesis').every(s => draftIds.every(id => s.unitIds.includes(id))));
  for (const source of input.sources) {
    const units = run.units.filter(u => u.sourceId === source.id);
    assert.equal(units.map(u => source.text.slice(u.start, u.end)).join(''), source.text);
  }
  const proof: ChapterReviewStageProof = { inputHash: input.inputHash, createdAt: run.createdAt, stages: [] };
  let calls = 0;
  const provider = new OpenAICompatibleChapterProvider('', '', '', 10, 5000, true, { completeWithUsage: async request => {
    calls++;
    return { text: passingStageOutput(request), usage: { ...emptyUsage(), calls: 1 } };
  } });
  await assert.rejects(() => provider.reviewChapterAsync(input, { onStage: async (stage, progress) => {
    proof.createdAt = progress.createdAt; proof.stages.push(stage);
    throw new Error('测试进程在首批保存后停止');
  } }), /首批保存/);
  assert.equal(calls, 1);
  const result = await provider.reviewChapterAsync(input, { resume: proof });
  assert.equal(chapterReviewStatus(result), 'passed');
  assert.equal(calls, result.stageProof!.stages.length);
  assert.equal(result.usage?.calls, calls - 1, 'resume usage counts only newly issued calls');
  assert.equal(validateChapterReview(result, input).stageProof!.stages.length, calls);
  const changed = structuredClone(input); changed.inputHash = 'different';
  assert.throws(() => validateChapterReview(result, changed), /不属于当前材料/);
  const missing = structuredClone(result); missing.stageProof!.stages.splice(1, 1);
  assert.throws(() => validateChapterReview(missing, input), /覆盖|检查点/);
});

test('a later passing synthesis cannot erase a raw chapter finding', async () => {
  const input = await largeInput();
  let calls = 0;
  const provider = new OpenAICompatibleChapterProvider('', '', '', 10, 5000, true, { completeWithUsage: async request => ({
    text: passingStageOutput(request, ++calls === 1), usage: { ...emptyUsage(), calls: 1 },
  }) });
  const result = await provider.reviewChapterAsync(input);
  assert.equal(result.checks.find(c => c.criterion === 'power')?.verdict, 'revise');
  assert.equal(result.stageProof!.stages.at(-1)!.result!.checks.find(c => c.criterion === 'power')?.verdict, 'pass');
  const forged = structuredClone(result); forged.checks.find(c => c.criterion === 'power')!.verdict = 'pass';
  assert.throws(() => validateChapterReview(forged, input), /综合结果/);
});

test('staged citation repair keeps fragment-only format when the model cites an empty source', async () => {
  const input = await largeInput();
  let repaired = false;
  const provider = new OpenAICompatibleChapterProvider('', '', '', 10, 5000, true, { completeWithUsage: async request => {
    const sent = JSON.parse(request.user);
    if (sent.task === 'repair_previous_output') {
      assert.match(sent.instruction, /严禁增加 quote 或 sourceId/);
      repaired = true;
      return { text: passingStageOutput({ user: JSON.stringify(sent.originalRequest) }), usage: emptyUsage() };
    }
    const result = JSON.parse(passingStageOutput(request));
    const empty = sent.sources.flatMap((s: { fragments: Array<{ id: string; text: string }> }) => s.fragments).find((f: { text: string }) => f.text === '[]');
    assert.ok(empty);
    result.checks[0].evidence.push({ fragmentId: empty.id });
    return { text: JSON.stringify(result), usage: emptyUsage() };
  } });
  await assert.rejects(() => provider.reviewChapterAsync(input, { onStage: async stage => {
    assert.ok(stage.result); throw new Error('stop after repaired stage');
  } }), /stop after repaired stage/);
  assert.equal(repaired, true);
});
