import test from 'node:test';
import assert from 'node:assert/strict';
import { ChapterWorkflow, IdempotencyConflictError, InMemoryWorkRepository, LeaseLostError, RunCancelledError, RunInProgressError } from '../src/index.ts';
import type { DesignProvider } from '../src/index.ts';
import {
  chapterLengthChecker, DemoCandidateError, observedEventsChecker, passChecker, QualityGateError, ReadinessError, RulingNotAllowedError, StaleCandidateError, unavailableChecker,
} from '../../../novel-service-core/src/core.ts';
import type { GeneratedChapter, ModelProvider } from '../../../novel-service-core/src/core.ts';
import { chapterBody, createReadyWork, minimalWorldPack, readyCovenant } from './fixtures.ts';

const provider: ModelProvider = {
  generateChapter: ({ chapterNumber }) => {
    const event = { eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: chapterNumber, storyTime: chapterNumber, evidence: 'paragraph 1' };
    return { content: `章节 ${chapterNumber}`, proposedEvents: [event], observedEvents: [event] };
  },
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms))]);
}

/** A provider whose next call parks until the test releases it. */
function gatedProvider(result: (chapterNumber: number) => GeneratedChapter) {
  let release: (() => void) | undefined;
  let signalStarted: (() => void) | undefined;
  let started = new Promise<void>((resolve) => { signalStarted = resolve; });
  let gated = true;
  const provider: ModelProvider = {
    generateChapter: () => { throw new Error('sync path not used'); },
    generateChapterAsync: async ({ chapterNumber }) => {
      if (gated) {
        gated = false;
        signalStarted!();
        await new Promise<void>((resolve) => { release = resolve; });
      }
      return result(chapterNumber);
    },
  };
  return {
    provider,
    started: () => started,
    release: () => release!(),
    regate: () => { gated = true; started = new Promise<void>((resolve) => { signalStarted = resolve; }); },
  };
}

test('adoption writes outbox projections only after the transaction passes', async () => {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, provider);
  const work = await createReadyWork(workflow, '事务作品');
  const candidate = await workflow.generate(work.id, 1, 'run-1');
  await workflow.check(work.id, candidate.id, [passChecker]);
  const result = await workflow.adopt(work.id, candidate.id, work.stateRevision);
  assert.equal(result.version.chapterNumber, 1);
  assert.equal(result.outbox.length, 3);
  assert.deepEqual(((await repository.outbox())).map((event) => event.kind).sort(), ['export', 'projection', 'search_index']);
});

test('repeating an adoption returns the same version and outbox rows', async () => {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, provider);
  const work = await createReadyWork(workflow, '幂等作品');
  const candidate = await workflow.generate(work.id, 1, 'run-1');
  await workflow.check(work.id, candidate.id, [passChecker]);
  const first = await workflow.adopt(work.id, candidate.id, 0);
  const second = await workflow.adopt(work.id, candidate.id, 0);
  assert.equal(second.version.id, first.version.id);
  assert.deepEqual(second.outbox.map((event) => event.id), first.outbox.map((event) => event.id));
  assert.equal((await repository.outbox()).length, 3);
  assert.equal((await repository.get(work.id))?.stateRevision, 1);
});

test('blocked adoption does not create outbox events', async () => {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, provider);
  const work = await createReadyWork(workflow, '阻断作品');
  const candidate = await workflow.generate(work.id, 1, 'run-1');
  await workflow.check(work.id, candidate.id, [passChecker, unavailableChecker]);
  await assert.rejects(() => workflow.adopt(work.id, candidate.id, 0));
  assert.equal(((await repository.outbox())).length, 0);
});

test('stale state revision blocks an adoption request', async () => {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, provider);
  const work = await createReadyWork(workflow, '版本作品');
  const candidate = await workflow.generate(work.id, 1, 'run-1');
  await workflow.check(work.id, candidate.id, [passChecker]);
  await assert.rejects(() => workflow.adopt(work.id, candidate.id, 99));
  assert.equal(work.versions.size, 0);
});

test('author settings invalidate planned candidates while preserving story revision', async () => {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, provider);
  const work = await createReadyWork(workflow, '设定版本作品');
  const constraintRevision = work.constraintRevision;
  const candidate = await workflow.generate(work.id, 1, 'settings-run');
  await workflow.check(work.id, candidate.id, [passChecker]);
  await workflow.editSettings(work.id, (draft) => { draft.covenant = { ...draft.covenant, hook: '新的核心冲突', audience: '玄幻读者' }; });
  assert.equal((await repository.get(work.id))?.stateRevision, 0);
  assert.equal((await repository.get(work.id))?.constraintRevision, constraintRevision + 1);
  await assert.rejects(() => workflow.adopt(work.id, candidate.id, 0), /stale/);
});

test('same-work transactions are serialized', async () => {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, provider);
  const work = await workflow.createWork('串行作品');
  const order: string[] = [];
  const first = repository.transaction(work.id, async () => { order.push('first-start'); await new Promise((resolve) => setTimeout(resolve, 20)); order.push('first-end'); });
  const second = repository.transaction(work.id, async () => { order.push('second'); });
  const third = repository.transaction(work.id, async () => { order.push('third'); });
  await Promise.all([first, second, third]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second', 'third']);
});

test('formal generation is refused until the book is ready, listing every blocker', async () => {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, provider);
  const bare = await workflow.createWork('未就绪');
  const blockers = await workflow.readiness(bare.id, 1);
  assert.deepEqual(blockers.map((blocker) => blocker.code), ['COVENANT_INCOMPLETE', 'CANON_NOT_READY', 'PLAN_NOT_APPROVED']);
  await assert.rejects(() => workflow.generate(bare.id, 1, 'run'), (error: unknown) => error instanceof ReadinessError && error.code === 'COVENANT_INCOMPLETE');

  const ready = await createReadyWork(workflow, '已就绪');
  assert.deepEqual(await workflow.readiness(ready.id, 1), []);
  const skipped = await workflow.readiness(ready.id, 2);
  assert.deepEqual(skipped.map((blocker) => blocker.code), ['CHAPTER_PREREQUISITE_MISSING']);
  await assert.rejects(() => workflow.generate(ready.id, 2, 'run'), (error: unknown) => error instanceof ReadinessError && error.code === 'CHAPTER_PREREQUISITE_MISSING');
  assert.equal(ready.candidates.size, 0);
});

test('a placeholder writer cannot produce formal chapters; demo candidates are never adoptable', async () => {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, { ...provider, demo: true });
  const work = await createReadyWork(workflow, '演示隔离');
  assert.equal(workflow.modelConfigured, false);
  await assert.rejects(() => workflow.generate(work.id, 1, 'formal'), (error: unknown) => error instanceof ReadinessError && error.code === 'MODEL_NOT_CONFIGURED');
  const demo = await workflow.generate(work.id, 1, 'demo', 'demo');
  assert.equal(demo.origin, 'demo');
  await workflow.check(work.id, demo.id, [passChecker]);
  await assert.rejects(() => workflow.adopt(work.id, demo.id, 0), DemoCandidateError);
  assert.equal(work.versions.size, 0);
  assert.equal((await repository.outbox()).length, 0);
});

test('required checks must all exist and pass on the current candidate', async () => {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, provider, undefined, { checkPolicy: { version: 'test-policy', required: ['deterministic_rules', 'chapter_length'] } });
  const work = await createReadyWork(workflow, '必需检查');
  const candidate = await workflow.generate(work.id, 1, 'run-1');
  await workflow.check(work.id, candidate.id, [passChecker]);
  await assert.rejects(() => workflow.adopt(work.id, candidate.id, 0), (error: unknown) => error instanceof QualityGateError && /required checks missing: chapter_length/.test(error.message));
  await workflow.check(work.id, candidate.id, [chapterLengthChecker]);
  await assert.rejects(() => workflow.adopt(work.id, candidate.id, 0), (error: unknown) => error instanceof QualityGateError && /chapter_length:failed/.test(error.message));
  const stored = (await repository.get(work.id))!.candidates.get(candidate.id)!;
  assert.equal(stored.checkRuns.length, 2);
  assert.equal(stored.checks.length, 2);
  assert.ok(stored.checkRuns.every((result) => result.policyVersion === 'test-policy'));
  assert.equal(work.versions.size, 0);
});

test('the model call runs outside the work lock and a result that arrives late is kept but stale', async () => {
  let releaseModel!: () => void;
  let modelStarted!: () => void;
  const started = new Promise<void>((resolve) => { modelStarted = resolve; });
  const slowProvider: ModelProvider = {
    generateChapter: () => { throw new Error('sync path not used'); },
    generateChapterAsync: async () => {
      modelStarted();
      await new Promise<void>((resolve) => { releaseModel = resolve; });
      return { content: '迟到的正文', proposedEvents: [], observedEvents: [] };
    },
  };
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, slowProvider);
  const work = await createReadyWork(workflow, '事务外调用');
  const pending = workflow.generate(work.id, 1, 'slow');
  await started;
  await withTimeout(workflow.editSettings(work.id, (draft) => { draft.covenant = { ...draft.covenant, avoid: '不要后宫' }; }), 1000, 'settings edit during model call');
  releaseModel();
  const candidate = await pending;
  assert.equal(candidate.content, '迟到的正文');
  await workflow.check(work.id, candidate.id, [passChecker]);
  await assert.rejects(() => workflow.adopt(work.id, candidate.id, 0), StaleCandidateError);
});

test('a design result that arrives after the inputs changed only lands in history', async () => {
  let releasePlanner!: () => void;
  let plannerStarted!: () => void;
  const started = new Promise<void>((resolve) => { plannerStarted = resolve; });
  const designProvider: DesignProvider = {
    generateWorldPack: async () => {
      plannerStarted();
      await new Promise<void>((resolve) => { releasePlanner = resolve; });
      return { ...minimalWorldPack(), id: 'late-world' };
    },
    generateStoryBible: async () => { throw new Error('not used'); },
  };
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, provider, designProvider);
  const work = await workflow.createWork('过期设计', readyCovenant());
  const pending = workflow.generateWorldPack(work.id);
  await started;
  await withTimeout(workflow.updateWork(work.id, { title: '改名', covenant: readyCovenant({ hook: '新钩子' }) }), 1000, 'covenant edit during planning');
  releasePlanner();
  await assert.rejects(() => pending, StaleCandidateError);
  const stored = (await repository.get(work.id))!;
  assert.equal(stored.worldPack, undefined);
  assert.ok([...stored.designHistory.values()].some((revision) => revision.snapshot.id === 'late-world' && revision.status === 'proposed'));
});

test('long runs commit each chapter so a failed model call can resume without widening the target', async () => {
  let failChapterTwo = true;
  const flakyProvider: ModelProvider = {
    generateChapter: ({ chapterNumber }) => ({ content: `回退 ${chapterNumber}`, proposedEvents: [] }),
    generateChapterAsync: async ({ chapterNumber }) => {
      if (chapterNumber === 2 && failChapterTwo) throw new Error('model timeout');
      return { content: chapterBody(chapterNumber), proposedEvents: [], observedEvents: [] };
    },
  };
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, flakyProvider);
  const work = await createReadyWork(workflow, '可恢复长跑');
  await assert.rejects(() => workflow.runUntil(work.id, 3, [passChecker], 'resume-run'), /model timeout/);
  assert.deepEqual((await repository.get(work.id))?.adoptedVersions().map((version) => version.chapterNumber), [1]);
  const paused = (await repository.get(work.id))?.checkpoints.get('resume-run');
  assert.equal(paused?.nextChapter, 2);
  assert.equal(paused?.phase, 'paused');
  assert.equal(paused?.error, 'model timeout');
  assert.equal(paused?.targetChapter, 3);
  failChapterTwo = false;
  await assert.rejects(() => workflow.runUntil(work.id, 100, [passChecker], 'resume-run'), IdempotencyConflictError);
  const checkpoint = await workflow.runUntil(work.id, 3, [passChecker], 'resume-run');
  assert.equal(checkpoint.nextChapter, 4);
  assert.equal(checkpoint.targetChapter, 3);
  assert.equal(checkpoint.leaseToken, undefined, 'a finished run releases the work lease');
  assert.deepEqual((await repository.get(work.id))?.adoptedVersions().map((version) => version.chapterNumber), [1, 2, 3]);
});

test('run adoption goes through the shared path and writes outbox events per chapter', async () => {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, provider);
  const work = await createReadyWork(workflow, '连续采用');
  await workflow.runUntil(work.id, 2, [passChecker], 'outbox-run');
  const events = await repository.outbox();
  assert.equal(events.length, 6);
  assert.equal(new Set(events.map((event) => event.dedupeKey)).size, 6);
  const versionIds = (await repository.get(work.id))!.adoptedVersions().map((version) => version.id);
  assert.deepEqual([...new Set(events.map((event) => event.aggregateId))].sort(), [...versionIds].sort());
});

test('a single-chapter run never generates beyond its target', async () => {
  const generated: number[] = [];
  const counting: ModelProvider = {
    generateChapter: ({ chapterNumber }) => { generated.push(chapterNumber); return { content: `章节 ${chapterNumber}`, proposedEvents: [], observedEvents: [] }; },
  };
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, counting);
  const work = await createReadyWork(workflow, '单章边界');
  const checkpoint = await workflow.runUntil(work.id, 1, [passChecker], 'one');
  assert.equal(checkpoint.nextChapter, 2);
  assert.deepEqual(generated, [1]);
});

const plainChapter = (chapterNumber: number): GeneratedChapter => ({ content: `章节 ${chapterNumber}`, proposedEvents: [], observedEvents: [] });

test('while one run holds the lease, another run and manual adoption are refused', async () => {
  const gate = gatedProvider(plainChapter);
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, gate.provider);
  const work = await createReadyWork(workflow, '同书互斥');
  const manual = await new ChapterWorkflow(repository, provider).generate(work.id, 1, 'manual');
  await workflow.check(work.id, manual.id, [passChecker]);

  const running = workflow.runUntil(work.id, 1, [passChecker], 'run-a');
  await gate.started();
  await assert.rejects(() => workflow.runUntil(work.id, 2, [passChecker], 'run-b'), RunInProgressError);
  await assert.rejects(() => workflow.adopt(work.id, manual.id, 0), RunInProgressError);
  gate.release();
  const done = await running;
  assert.equal(done.phase, 'complete');
  assert.equal((await repository.get(work.id))?.checkpoints.has('run-b'), false, 'a refused run leaves no checkpoint behind');
  assert.deepEqual(work.adoptedVersions().map((version) => version.chapterNumber), [1]);
});

test('a process whose lease expired cannot commit after another took the run over', async () => {
  let clock = 1_000_000;
  const gate = gatedProvider(plainChapter);
  const repository = new InMemoryWorkRepository();
  const stale = new ChapterWorkflow(repository, gate.provider, undefined, { leaseMs: 1_000, now: () => clock });
  const work = await createReadyWork(stale, '租约');
  const first = stale.runUntil(work.id, 1, [passChecker], 'shared-run');
  await gate.started();
  clock += 5_000;
  const takeover = new ChapterWorkflow(repository, provider, undefined, { leaseMs: 1_000, now: () => clock });
  const done = await takeover.runUntil(work.id, 1, [passChecker], 'shared-run');
  assert.equal(done.nextChapter, 2);
  gate.release();
  await assert.rejects(() => first, LeaseLostError);
  assert.equal(work.adoptedVersions().length, 1);
  assert.equal([...work.candidates.values()].filter((candidate) => candidate.chapterNumber === 1).length, 1, 'the late result was not committed');
  assert.equal(work.checkpoints.get('shared-run')?.phase, 'complete');
});

test('pausing during a model call keeps the late result and stops before checks; resume adopts it', async () => {
  const gate = gatedProvider(plainChapter);
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, gate.provider);
  const work = await createReadyWork(workflow, '暂停');
  const running = workflow.runUntil(work.id, 2, [passChecker], 'pausable');
  await gate.started();
  const requested = await workflow.controlRun(work.id, 'pausable', 'pause');
  assert.equal(requested.control, 'pause');
  gate.release();
  const paused = await running;
  assert.equal(paused.phase, 'paused');
  const candidate = work.candidates.get(paused.candidateIds[1])!;
  assert.equal(candidate.checks.length, 0, 'no automatic checks after a pause');
  assert.equal(work.versions.size, 0, 'no automatic adoption after a pause');

  const resumed = await workflow.runUntil(work.id, 2, [passChecker], 'pausable');
  assert.equal(resumed.phase, 'complete');
  assert.equal(work.currentVersion(1)?.sourceCandidateId, candidate.id, 'the stored result is reused, not regenerated');
});

test('cancelling stores the late result without adopting and the run cannot be resumed', async () => {
  const gate = gatedProvider(plainChapter);
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, gate.provider);
  const work = await createReadyWork(workflow, '取消');
  const running = workflow.runUntil(work.id, 1, [passChecker], 'cancellable');
  await gate.started();
  await workflow.controlRun(work.id, 'cancellable', 'cancel');
  gate.release();
  const cancelled = await running;
  assert.equal(cancelled.phase, 'cancelled');
  assert.equal(work.candidates.size, 1);
  assert.equal(work.versions.size, 0);
  await assert.rejects(() => workflow.runUntil(work.id, 1, [passChecker], 'cancellable'), RunCancelledError);
});

test('a refused candidate is kept on record but the next resume writes a fresh attempt', async () => {
  let short = true;
  const writer: ModelProvider = { generateChapter: ({ chapterNumber }) => ({ content: short ? '太短' : chapterBody(chapterNumber), proposedEvents: [], observedEvents: [] }) };
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, writer, undefined, { checkPolicy: { version: 'p', required: ['chapter_length'] } });
  const work = await createReadyWork(workflow, '重试');
  await assert.rejects(() => workflow.runUntil(work.id, 1, [chapterLengthChecker], 'retry'), QualityGateError);
  const paused = work.checkpoints.get('retry')!;
  assert.equal(paused.attempts?.[1], 2);
  assert.equal(paused.candidateIds[1], undefined);
  short = false;
  const done = await workflow.runUntil(work.id, 1, [chapterLengthChecker], 'retry');
  assert.equal(done.phase, 'complete');
  assert.equal(work.candidates.size, 2, 'the refused attempt stays on record');
  assert.notEqual(work.currentVersion(1)?.content, '太短');
});

test('an idempotency key returns the same candidate for the same request and conflicts for a different one', async () => {
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, provider);
  const work = await createReadyWork(workflow, '幂等键');
  const first = await workflow.generate(work.id, 1, 'key-1');
  const again = await workflow.generate(work.id, 1, 'key-1');
  assert.equal(again.id, first.id);
  await assert.rejects(() => workflow.generate(work.id, 1, 'key-1', 'demo'), IdempotencyConflictError);
  const other = await workflow.generate(work.id, 1, 'key-2');
  assert.notEqual(other.id, first.id, 'a new key is a new attempt');
});

test('runs record model usage, including calls that failed', async () => {
  let fail = true;
  const metered: ModelProvider = {
    generateChapter: () => { throw new Error('sync path not used'); },
    generateChapterAsync: async ({ chapterNumber }) => {
      if (fail) throw Object.assign(new Error('provider down'), { usage: { calls: 2, failedCalls: 1, inputTokens: 100, outputTokens: 50, costUsd: 0.01, costKnown: true } });
      return { ...plainChapter(chapterNumber), usage: { calls: 2, failedCalls: 0, inputTokens: 300, outputTokens: 900, costUsd: 0, costKnown: false } };
    },
  };
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, metered);
  const work = await createReadyWork(workflow, '用量');
  await assert.rejects(() => workflow.runUntil(work.id, 1, [passChecker], 'metered'), /provider down/);
  fail = false;
  const done = await workflow.runUntil(work.id, 1, [passChecker], 'metered');
  assert.deepEqual(done.usage, { calls: 4, failedCalls: 1, inputTokens: 400, outputTokens: 950, costUsd: 0.01, costKnown: false });
  assert.equal(work.candidates.get(done.candidateIds[1])?.usage?.outputTokens, 900);
});

test('an author ruling clears only an overridable failed check, and only for that execution', async () => {
  const shortWriter: ModelProvider = { generateChapter: () => ({ content: '短章', proposedEvents: [] }) };
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, shortWriter, undefined, {
    checkPolicy: { version: 'p', required: ['chapter_length', 'observed_events'], overridable: ['chapter_length'] },
  });
  const work = await createReadyWork(workflow, '裁决');
  const candidate = await workflow.generate(work.id, 1, 'ruling');
  await workflow.check(work.id, candidate.id, [chapterLengthChecker, observedEventsChecker]);
  const stored = () => work.candidates.get(candidate.id)!;
  const lengthCheck = stored().checks.find((check) => check.checker === 'chapter_length')!;
  const extraction = stored().checks.find((check) => check.checker === 'observed_events')!;
  assert.equal(extraction.status, 'unavailable');
  assert.equal(lengthCheck.contentHash, candidate.contentHash);
  assert.equal(lengthCheck.inputs?.worldPackRevision, work.worldPack?.revision);

  await assert.rejects(() => workflow.recordRuling(work.id, candidate.id, { checkId: extraction.id!, reason: '误报', evidence: '正文第 1 段' }), RulingNotAllowedError);
  await assert.rejects(() => workflow.recordRuling(work.id, candidate.id, { checkId: lengthCheck.id!, reason: '短章是刻意的', evidence: '' }), RulingNotAllowedError);
  const ruling = await workflow.recordRuling(work.id, candidate.id, { checkId: lengthCheck.id!, reason: '短章是刻意的', evidence: '本章是楔子' });
  assert.equal(ruling.checker, 'chapter_length');
  assert.equal(stored().checks.find((check) => check.checker === 'chapter_length')?.status, 'failed', 'the check result itself is unchanged');
  await assert.rejects(() => workflow.adopt(work.id, candidate.id, 0), /observed_events:unavailable/);
});

test('a ruling stops applying once the check is run again', async () => {
  const shortWriter: ModelProvider = { generateChapter: () => ({ content: '短章', proposedEvents: [], observedEvents: [] }) };
  const repository = new InMemoryWorkRepository();
  const workflow = new ChapterWorkflow(repository, shortWriter, undefined, { checkPolicy: { version: 'p', required: ['chapter_length'], overridable: ['chapter_length'] } });
  const work = await createReadyWork(workflow, '裁决失效');
  const candidate = await workflow.generate(work.id, 1, 'ruling');
  await workflow.check(work.id, candidate.id, [chapterLengthChecker]);
  const checkId = work.candidates.get(candidate.id)!.checks[0].id!;
  await workflow.recordRuling(work.id, candidate.id, { checkId, reason: '楔子', evidence: '本章是楔子' });
  await workflow.check(work.id, candidate.id, [chapterLengthChecker]);
  await assert.rejects(() => workflow.adopt(work.id, candidate.id, 0), QualityGateError);
  await workflow.recordRuling(work.id, candidate.id, { checkId: work.candidates.get(candidate.id)!.checks[0].id!, reason: '楔子', evidence: '本章是楔子' });
  const adopted = await workflow.adopt(work.id, candidate.id, 0);
  assert.equal(adopted.version.chapterNumber, 1);
});
