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
    proof.createdAt = progress.createdAt; proof.scheduleVersion = progress.scheduleVersion; proof.stages.push(stage);
    assert.equal(progress.scheduleVersion, run.scheduleVersion);
    assert.equal(progress.usage?.calls, 1);
    throw new Error('测试进程在首批保存后停止');
  } }), /首批保存/);
  assert.equal(calls, 1);
  const result = await provider.reviewChapterAsync(input, { resume: proof });
  assert.equal(chapterReviewStatus(result), 'passed');
  assert.equal(result.stageProof!.scheduleVersion, run.scheduleVersion);
  assert.equal(calls, result.stageProof!.stages.length);
  assert.equal(result.usage?.calls, calls - 1, 'resume usage counts only newly issued calls');
  assert.equal(validateChapterReview(result, input).stageProof!.stages.length, calls);
  const unversioned = structuredClone(result); delete unversioned.stageProof!.scheduleVersion;
  assert.equal(chapterReviewStatus(validateChapterReview(unversioned, input)), 'passed', 'v21-v23 unversioned chapter envelopes remain replayable');
  const changed = structuredClone(input); changed.inputHash = 'different';
  assert.throws(() => validateChapterReview(result, changed), /不属于当前材料/);
  const missing = structuredClone(result); missing.stageProof!.stages.splice(1, 1);
  assert.throws(() => validateChapterReview(missing, input), /覆盖|检查点/);
});

test('chapter checkpoints pin their original schedule across later defaults and reject unknown versions before model dispatch', async () => {
  const input = await largeInput();
  assert.equal(restoreChapterReviewRun(input).scheduleVersion, 28);
  const legacy: ChapterReviewStageProof = { inputHash: input.inputHash, createdAt: '2026-10-14T00:00:00.000Z', stages: [] };
  assert.equal(restoreChapterReviewRun(input, legacy).scheduleVersion, 21);
  let calls = 0;
  const provider = new OpenAICompatibleChapterProvider('', '', '', 10, 5000, true, { completeWithUsage: async request => {
    calls++;
    return { text: passingStageOutput(request), usage: { ...emptyUsage(), calls: 1 } };
  } });
  await assert.rejects(() => provider.reviewChapterAsync(input, { resume: legacy, onStage: async (stage, progress) => {
    assert.equal(progress.scheduleVersion, 21);
    legacy.stages.push(stage);
    // Simulate the existing unversioned persisted record, then a deployment.
    throw new Error('saved legacy stage');
  } }), /saved legacy stage/);
  const result = await provider.reviewChapterAsync(input, { resume: legacy });
  assert.equal(result.stageProof!.scheduleVersion, 21);
  assert.equal(calls, result.stageProof!.stages.length, 'the saved stage is not reviewed again');
  assert.equal(chapterReviewStatus(validateChapterReview(result, input)), 'passed');
  const oldFinal = structuredClone(result);
  delete oldFinal.stageProof!.scheduleVersion;
  assert.equal(chapterReviewStatus(validateChapterReview(oldFinal, input)), 'passed', 'unversioned final evidence still replays under v21');
  const before = calls;
  for (const scheduleVersion of [999, 0, 1, 20, -1, 22.5, null, '23']) {
    const bad = { ...legacy, scheduleVersion } as unknown as ChapterReviewStageProof;
    await assert.rejects(() => provider.reviewChapterAsync(input, { resume: bad }), /调度版本/);
  }
  assert.equal(calls, before, 'invalid checkpoints must fail before spending a model call');
});

test('legacy v26: a later passing synthesis cannot erase a raw chapter finding', async () => {
  const input = await largeInput();
  let calls = 0;
  const provider = new OpenAICompatibleChapterProvider('', '', '', 10, 5000, true, { completeWithUsage: async request => ({
    text: passingStageOutput(request, ++calls === 1), usage: { ...emptyUsage(), calls: 1 },
  }) });
  const result = await provider.reviewChapterAsync(input, { resume: { inputHash: input.inputHash, createdAt: '2026-10-16T00:00:00Z', scheduleVersion: 26, stages: [] } });
  assert.equal(result.checks.find(c => c.criterion === 'power')?.verdict, 'revise');
  assert.equal(result.stageProof!.stages.at(-1)!.result!.checks.find(c => c.criterion === 'power')?.verdict, 'pass');
  const forged = structuredClone(result); forged.checks.find(c => c.criterion === 'power')!.verdict = 'pass';
  assert.throws(() => validateChapterReview(forged, input), /综合结果/);
});

test('v27 chapter synthesis repairs a false pass and retains the rejected response in the stage proof', async () => {
  const input = await largeInput();
  let calls = 0, repairCalls = 0, rejectedOnce = false;
  const provider = new OpenAICompatibleChapterProvider('', '', '', 10, 5000, true, { completeWithUsage: async request => {
    calls++;
    const body = JSON.parse(request.user);
    const repairing = body.task === 'repair_previous_output';
    const original = repairing ? body.originalRequest : body;
    if (repairing) {
      repairCalls++;
      assert.match(body.problems, /不得弱化/);
    }
    const output = JSON.parse(passingStageOutput({ ...request, user: JSON.stringify(original) }, calls === 1));
    const required = original.stage.coverage?.synthesis?.requiredFindings ?? [];
    if (required.length) {
      assert.match(request.system, /requiredFindings/);
      if (!rejectedOnce) rejectedOnce = true;
      else for (const finding of required) Object.assign(output.checks.find((check: { criterion: string }) => check.criterion === finding.criterion), {
        verdict: finding.verdict, revisionAdvice: '保留原文返修',
      });
    }
    return { text: JSON.stringify(output), usage: { ...emptyUsage(), calls: 1 } };
  } });
  const result = await provider.reviewChapterAsync(input);
  assert.equal(repairCalls, 1);
  assert.equal(result.stageProof!.scheduleVersion, 28);
  assert.equal(result.checks.find(check => check.criterion === 'power')!.verdict, 'revise');
  assert.equal(result.stageProof!.stages.at(-1)!.result!.checks.find(check => check.criterion === 'power')!.verdict, 'revise');
  const repairedStage = result.stageProof!.stages.find(stage => stage.modelResponses?.length === 2)!;
  assert.ok(repairedStage);
  assert.equal(JSON.parse(repairedStage.modelResponses![0]).checks.find((check: { criterion: string }) => check.criterion === 'power').verdict, 'pass');
  assert.equal(JSON.parse(repairedStage.modelResponses![1]).checks.find((check: { criterion: string }) => check.criterion === 'power').verdict, 'revise');
  assert.equal(chapterReviewStatus(validateChapterReview(result, input)), 'failed');
});

test('staged citation repair keeps fragment-only format when the model cites an empty source', async () => {
  const input = await largeInput();
  let repaired = false;
  const provider = new OpenAICompatibleChapterProvider('', '', '', 10, 5000, true, { completeWithUsage: async request => {
    const sent = JSON.parse(request.user);
    if (sent.task === 'repair_previous_output') {
      assert.match(sent.instruction, /严禁增加 quote 或 sourceId/);
      repaired = true;
      return { text: passingStageOutput({ user: JSON.stringify(sent.originalRequest) }), usage: { ...emptyUsage(), calls: 1, inputTokens: 30 } };
    }
    const result = JSON.parse(passingStageOutput(request));
    const empty = sent.sources.flatMap((s: { fragments: Array<{ id: string; text: string }> }) => s.fragments).find((f: { text: string }) => f.text === '[]');
    assert.ok(empty);
    result.checks[0].evidence.push({ fragmentId: empty.id });
    return { text: JSON.stringify(result), usage: { ...emptyUsage(), calls: 1, inputTokens: 50, costKnown: false } };
  } });
  await assert.rejects(() => provider.reviewChapterAsync(input, { onStage: async (stage, progress) => {
    assert.deepEqual(progress.usage, { ...emptyUsage(), calls: 2, inputTokens: 80, costKnown: false });
    assert.ok(stage.result); throw new Error('stop after repaired stage');
  } }), /stop after repaired stage/);
  assert.equal(repaired, true);
});
