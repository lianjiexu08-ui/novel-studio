import { designReviewInput, designReviewOverview, recordDesignReview } from '../../../novel-service-core/src/design-review.ts';
import { fixtureDesignReview } from '../../application/test/fixtures.ts';
import { fixtureChapterReview, createReadyWork } from '../../application/test/fixtures.ts';
import { chapterReviewChecker } from '../../../novel-service-core/src/chapter-review.ts';
import { passingStageOutput } from '../../planner/test/chapter-review-fixture.ts';
import { OpenAICompatibleChapterProvider } from '../../planner/src/index.ts';
import { emptyUsage } from '../../../novel-service-core/src/core.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelProvider } from '../../../novel-service-core/src/core.ts';

const persistenceDir = fileURLToPath(new URL('..', import.meta.url));

function createDatabase(): string {
  const dir = mkdtempSync(join(tmpdir(), 'novel-persistence-'));
  const databasePath = join(dir, 'test.db');
  writeFileSync(databasePath, '');
  const databaseUrl = `file:${databasePath.replaceAll('\\', '/')}`;
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--force-reset'], {
    cwd: persistenceDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
  return databaseUrl;
}

test('independent chapter reports, failures and citations survive reload and still gate adoption', async t => {
  const databaseUrl = createDatabase();
  process.env.DATABASE_URL = databaseUrl;
  const { PrismaWorkRepository } = await import('../src/prisma-repository.ts');
  const { ChapterWorkflow } = await import('../../application/src/index.ts');
  const { passChecker, QualityGateError } = await import('../../../novel-service-core/src/core.ts');
  const first = new PrismaWorkRepository();
  const second = new PrismaWorkRepository();
  t.after(async () => { await first.disconnect(); await second.disconnect(); rmSync(databaseUrl.slice(5), { force: true }); });
  const policy = { version: 'chapter-review-test', required: ['deterministic_rules', chapterReviewChecker] };
  let failing = true;
  const provider: ModelProvider = {
    generateChapter: ({ chapterNumber }) => {
      const events = chapterNumber === 10 ? [
        { eventType: 'arc_progress', subjectId: 'arc', predicate: 'status', value: { status: 'resolved' } },
        { eventType: 'volume_progress', subjectId: 'vol-1', predicate: 'status', value: { status: 'resolved' } },
      ] : [];
      return { content: '他按住伤口，放弃追击，先带同伴回城。', proposedEvents: events, observedEvents: events };
    },
    reviewChapterAsync: async input => { if (failing) throw new Error('测试评审失败'); return fixtureChapterReview(input); },
  };
  const workflow = new ChapterWorkflow(first, provider, undefined, { checkPolicy: policy });
  const work = await createReadyWork(workflow, '正文评审持久化');
  const candidate = await workflow.generate(work.id, 1, 'review');
  await workflow.check(work.id, candidate.id, [passChecker]);
  const restoredWorkflow = new ChapterWorkflow(second, provider, undefined, { checkPolicy: policy });
  await assert.rejects(() => restoredWorkflow.adopt(work.id, candidate.id, 0), QualityGateError);
  failing = false;
  await restoredWorkflow.check(work.id, candidate.id, [passChecker]);
  const reloaded = (await first.get(work.id))!;
  const saved = reloaded.candidates.get(candidate.id)!;
  assert.ok(saved.checkRuns.some(c => c.chapterReview?.error === '测试评审失败'));
  assert.equal(saved.checks.find(c => c.checker === chapterReviewChecker)?.chapterReview?.result?.checks.length, 6);
  assert.equal(saved.checks.find(c => c.checker === chapterReviewChecker)?.chapterReview?.result?.checks[0].evidence[0].sourceId, 'draft');
  const retainedInput = saved.checks.find(c => c.checker === chapterReviewChecker)!.chapterReview!.input!;
  assert.equal(retainedInput.candidateId, candidate.id);
  assert.equal(retainedInput.sources.find(source => source.id === 'draft')?.text, candidate.content);
  assert.equal(retainedInput.inputHash, saved.checks.find(c => c.checker === chapterReviewChecker)!.chapterReview!.result!.inputHash);
  assert.equal((await workflow.adopt(work.id, candidate.id, 0)).version.chapterNumber, 1);
  assert.deepEqual((await second.get(work.id))!.candidates.get(candidate.id)!.checks.find(c => c.checker === chapterReviewChecker)!.chapterReview!.input, retainedInput);
  await workflow.runUntil(work.id, 10, [passChecker], 'remaining-chapters');
  assert.equal((await restoredWorkflow.finalizeManuscript(work.id)).chapterCount, 10, 'saved review inputs remain usable after SQLite reload and later chapter adoption');
});

test('large chapter review checkpoints resume after SQLite restart without losing failures', async t => {
  const databaseUrl = createDatabase();
  process.env.DATABASE_URL = databaseUrl;
  const { PrismaWorkRepository } = await import('../src/prisma-repository.ts');
  const { ChapterWorkflow } = await import('../../application/src/index.ts');
  const { passChecker } = await import('../../../novel-service-core/src/core.ts');
  const first = new PrismaWorkRepository(), second = new PrismaWorkRepository();
  t.after(async () => { await first.disconnect(); await second.disconnect(); rmSync(databaseUrl.slice(5), { force: true }); });
  const policy = { version: 'staged-chapter-review', required: ['deterministic_rules', chapterReviewChecker] };
  let calls = 0;
  const labels: string[] = [];
  const reviewer = new OpenAICompatibleChapterProvider('', '', '', 10, 5000, true, { completeWithUsage: async request => {
    labels.push(JSON.parse(request.user).stage.label);
    if (++calls === 2) throw new Error('第二批网络中断');
    return { text: passingStageOutput(request), usage: { ...emptyUsage(), calls: 1 } };
  } });
  const provider: ModelProvider = { generateChapter: () => ({ content: '他按住伤口，放弃追击，先带同伴回城。', proposedEvents: [], observedEvents: [] }),
    reviewChapterAsync: reviewer.reviewChapterAsync.bind(reviewer) };
  const workflow = new ChapterWorkflow(first, provider, undefined, { checkPolicy: policy });
  const work = await createReadyWork(workflow, '大材料检查点恢复');
  await first.transaction(work.id, ({ work }) => { work.worldPack!.summary = '完整规则不能截断。'.repeat(36_000); });
  const candidate = await workflow.generate(work.id, 1, 'checkpoint');
  await workflow.check(work.id, candidate.id, [passChecker]);
  const interrupted = (await first.get(work.id))!.candidates.get(candidate.id)!;
  assert.equal(calls, 2);
  assert.ok(interrupted.checkRuns.some(c => c.chapterReview?.stage?.result));
  assert.equal(interrupted.checkRuns.find(c => c.chapterReview?.stage?.result)?.chapterReview?.progress?.scheduleVersion, 26);
  assert.ok(interrupted.checkRuns.some(c => c.chapterReview?.stage?.failures?.[0]?.error === '第二批网络中断'));
  await first.disconnect();
  const restored = new ChapterWorkflow(second, provider, undefined, { checkPolicy: policy });
  await restored.check(work.id, candidate.id, [passChecker]);
  assert.equal(labels.filter(label => label === labels[0]).length, 1, 'first completed batch must not be called again');
  const saved = (await second.get(work.id))!.candidates.get(candidate.id)!;
  assert.equal(saved.checks.find(c => c.checker === chapterReviewChecker)?.status, 'passed');
  const proof = saved.checks.find(c => c.checker === chapterReviewChecker)!.chapterReview!.result!.stageProof!;
  assert.equal(proof.scheduleVersion, 26, 'SQLite resume must retain the persisted schedule instead of treating the run as legacy');
  assert.ok(proof.stages.some(s => s.attempts === 2 && s.failures?.[0]?.error === '第二批网络中断'));
  assert.equal((await restored.adopt(work.id, candidate.id, 0)).version.chapterNumber, 1);
});

test('stage usage is durable before final review and survives lease takeover without replay or double counting', async t => {
  const databaseUrl = createDatabase();
  process.env.DATABASE_URL = databaseUrl;
  const { PrismaWorkRepository } = await import('../src/prisma-repository.ts');
  const { ChapterWorkflow, LeaseLostError } = await import('../../application/src/index.ts');
  const { passChecker } = await import('../../../novel-service-core/src/core.ts');
  const first = new PrismaWorkRepository(), second = new PrismaWorkRepository();
  t.after(async () => { await first.disconnect(); await second.disconnect(); rmSync(databaseUrl.slice(5), { force: true }); });
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const signal = new Promise<void>(resolve => { started = resolve; });
  let calls = 0, now = Date.now();
  const labels: string[] = [];
  const firstUsage = { ...emptyUsage(), calls: 1, inputTokens: 101, outputTokens: 17, costUsd: 0.01 };
  const nextUsage = { ...emptyUsage(), calls: 1, inputTokens: 103, outputTokens: 19, costKnown: false };
  const reviewer = new OpenAICompatibleChapterProvider('', '', '', 10, 5000, true, { completeWithUsage: async request => {
    const call = ++calls;
    labels.push(JSON.parse(request.user).stage.label);
    if (call === 2) { started(); await gate; }
    return { text: passingStageOutput(request), usage: call === 1 ? firstUsage : nextUsage };
  } });
  const provider: ModelProvider = { generateChapter: () => ({ content: '他按住伤口，放弃追击，先带同伴回城。', proposedEvents: [], observedEvents: [] }),
    reviewChapterAsync: reviewer.reviewChapterAsync.bind(reviewer) };
  const options = { checkPolicy: { version: 'durable-review-usage', required: ['deterministic_rules', chapterReviewChecker] },
    leaseMs: 86_400_000, now: () => now };
  const workflow = new ChapterWorkflow(first, provider, undefined, options);
  const work = await createReadyWork(workflow, '审读批次原子计量');
  await first.transaction(work.id, ({ work }) => { work.worldPack!.summary = '完整规则不能截断。'.repeat(36_000); });
  const old = workflow.runUntil(work.id, 1, [passChecker], 'durable');
  // Capture rejection now so an assertion failure cannot leave an unhandled old worker.
  const oldResult = old.then(() => undefined, error => error);
  try {
    await signal;
    const during = (await second.get(work.id))!;
    assert.deepEqual(during.checkpoints.get('durable')!.usage, firstUsage, 'usage must already be durable while the next call is parked');
    const candidate = [...during.candidates.values()][0];
    const batch = candidate.checkRuns.find(c => c.chapterReview?.stage?.result)!.chapterReview!;
    assert.deepEqual(batch.progress?.usage, firstUsage);
    assert.ok(!candidate.checkRuns.some(c => c.chapterReview?.result), 'no final review has run yet');
    assert.equal(during.versions.size, 0);

    // A fresh repository/workflow takes over after the unavailable worker's lease expires.
    now += 2 * 86_400_000;
    const restored = new ChapterWorkflow(second, provider, undefined, options);
    const finished = await restored.runUntil(work.id, 1, [passChecker], 'durable');
    assert.equal(finished.phase, 'complete');
    assert.equal(labels.filter(label => label === labels[0]).length, 1);
    const completedNewCalls = calls - 2; // The old in-flight request has not returned or checkpointed.
    assert.deepEqual(finished.usage, { calls: 1 + completedNewCalls, failedCalls: 0,
      inputTokens: 101 + 103 * completedNewCalls, outputTokens: 17 + 19 * completedNewCalls, costUsd: 0.01, costKnown: false });
    release();
    assert.ok(await oldResult instanceof LeaseLostError);
    const final = (await second.get(work.id))!;
    assert.deepEqual(final.checkpoints.get('durable')!.usage, finished.usage, 'fenced worker cannot change the recovered checkpoint');
    assert.equal(final.versions.size, 1);
  } finally { release(); await oldResult; }
});

test('frozen manuscript metadata and exact design references survive database reload', async t => {
  const databaseUrl = createDatabase();
  process.env.DATABASE_URL = databaseUrl;
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaWorkRepository } = await import('../src/prisma-repository.ts');
  const { ChapterWorkflow } = await import('../../application/src/index.ts');
  const { passChecker } = await import('../../../novel-service-core/src/core.ts');
  const { createReadyWork } = await import('../../application/test/fixtures.ts');
  const first = new PrismaWorkRepository();
  const second = new PrismaWorkRepository();
  const prisma = new PrismaClient();
  t.after(async () => {
    await first.disconnect(); await second.disconnect(); await prisma.$disconnect();
    rmSync(databaseUrl.slice(5), { force: true });
  });
  const provider: ModelProvider = { generateChapter: ({ chapterNumber }) => {
    const events = chapterNumber === 10 ? [
      { eventType: 'arc_progress', subjectId: 'arc', predicate: 'status', value: { status: 'resolved' } },
      { eventType: 'volume_progress', subjectId: 'vol-1', predicate: 'status', value: { status: 'resolved' } },
    ] : [];
    return { content: `第${chapterNumber}章`, proposedEvents: events, observedEvents: events };
  } };
  const workflow = new ChapterWorkflow(first, provider);
  const work = await createReadyWork(workflow, '冻结时书名');
  await workflow.runUntil(work.id, 10, [passChecker], 'frozen-book');
  const manuscript = await workflow.finalizeManuscript(work.id);
  assert.ok(manuscript.exportSnapshot);
  await first.transaction(work.id, ({ work }) => {
    work.title = '后来的书名';
    work.recordCovenant({ ...work.covenant, chapterWords: 6000 });
  });
  await workflow.finalizeManuscript(work.id);
  await first.disconnect();
  const restored = (await second.get(work.id))!;
  const previous = restored.manuscripts.get(manuscript.id)!;
  assert.equal(previous.status, 'superseded');
  assert.deepEqual(previous.exportSnapshot, JSON.parse(JSON.stringify(manuscript.exportSnapshot)));
  assert.equal(previous.exportSnapshot!.title, '冻结时书名');
  assert.equal(previous.exportSnapshot!.covenant.chapterWords, 2200);
  assert.equal(restored.title, '后来的书名');
  assert.ok(restored.designHistory.has(previous.exportSnapshot!.worldPackDesignId));
  assert.ok(restored.designHistory.has(previous.exportSnapshot!.storyBibleDesignId));
  assert.equal(previous.exportSnapshot!.closureCoverage.ready, true);
  // Old rows remain unknown, even after a normal repository save.
  await prisma.manuscriptRevision.update({ where: { id: manuscript.id }, data: { exportSnapshot: null } });
  const legacy = (await second.get(work.id))!;
  assert.equal(legacy.manuscripts.get(manuscript.id)!.exportSnapshot, undefined);
  await second.save(legacy);
  assert.equal((await second.get(work.id))!.manuscripts.get(manuscript.id)!.exportSnapshot, undefined);
});

test('early candidate replacement and paused-run recovery survive a database reload', async (t) => {
  const databaseUrl = createDatabase();
  const repositories: Array<{ disconnect(): Promise<void> }> = [];
  t.after(async () => {
    for (const repository of repositories) await repository.disconnect();
    rmSync(databaseUrl.slice(5), { force: true });
  });
  process.env.DATABASE_URL = databaseUrl;
  const { PrismaWorkRepository } = await import('../src/prisma-repository.ts');
  const { ChapterWorkflow } = await import('../../application/src/index.ts');
  const { passChecker } = await import('../../../novel-service-core/src/core.ts');
  const { createReadyWork } = await import('../../application/test/fixtures.ts');
  let replacing = false;
  const calls: number[] = [];
  const provider: ModelProvider = { generateChapter: ({ chapterNumber }) => {
    calls.push(chapterNumber);
    const event = { eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: replacing ? 100 + chapterNumber : chapterNumber, storyTime: chapterNumber, evidence: 'p1' };
    return { content: `第${chapterNumber}章${replacing ? '修订' : '原稿'}`, proposedEvents: [event], observedEvents: [event] };
  } };
  const first = new PrismaWorkRepository();repositories.push(first);
  const workflow = new ChapterWorkflow(first, provider);
  const work = await createReadyWork(workflow, '持久化早章修订');
  await workflow.runUntil(work.id, 3, [passChecker], 'persisted-run');
  const original = (await first.get(work.id))!.adoptedVersions();
  replacing = true;
  const candidate = await workflow.generate(work.id, 1, 'persisted-replacement');
  await workflow.check(work.id, candidate.id, [passChecker]);
  const adopted = await workflow.adopt(work.id, candidate.id, 3);
  await first.disconnect();

  const second = new PrismaWorkRepository();repositories.push(second);
  const reloaded = (await second.get(work.id))!;
  assert.equal(reloaded.currentVersion(1)?.id, adopted.version.id);
  assert.equal(reloaded.currentVersion(2), undefined);
  assert.equal(reloaded.currentVersion(3), undefined);
  assert.equal(reloaded.states.get('hero|power')?.value, 101);
  assert.equal([...reloaded.events.values()].filter(e => e.active).length, 1);
  assert.equal(reloaded.checkpoints.get('persisted-run')?.phase, 'paused');
  assert.equal(reloaded.checkpoints.get('persisted-run')?.nextChapter, 2);
  assert.deepEqual(reloaded.impacts.at(-1)?.affectedChapterNumbers, [2, 3]);
  const resumedWorkflow = new ChapterWorkflow(second, provider);
  await resumedWorkflow.runUntil(work.id, 3, [passChecker], 'persisted-run');
  const after = (await second.get(work.id))!;
  assert.deepEqual(calls, [1, 2, 3, 1, 2, 3]);
  assert.equal(after.adoptedVersions().length, 3);
  assert.equal(after.versions.size, 6);
  assert.equal([...after.events.values()].filter(e => e.active).length, 3);
  assert.equal(after.checkpoints.get('persisted-run')?.phase, 'complete');
  for (const version of original) assert.equal(after.versions.get(version.id)?.content, version.content);
});

test('prisma repository persists a full adoption roundtrip', async (t) => {
  const databaseUrl = createDatabase();
  const repositories: Array<{ disconnect(): Promise<void> }> = [];
  t.after(async () => {
    for (const repository of repositories) await repository.disconnect();
    rmSync(databaseUrl.slice(5), { force: true });
  });
  process.env.DATABASE_URL = databaseUrl;

  const { PrismaWorkRepository } = await import('../src/prisma-repository.ts');
  const { ChapterWorkflow } = await import('../../application/src/index.ts');
  const { passChecker } = await import('../../../novel-service-core/src/core.ts');
  const { approveMinimalPlan, lockMinimalDesign } = await import('../../application/test/fixtures.ts');

  const provider: ModelProvider = {
    generateChapter: ({ chapterNumber }) => {
      const event = { eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: chapterNumber, storyTime: chapterNumber, evidence: 'p1' };
      return { content: `第${chapterNumber}章`, proposedEvents: [event], observedEvents: [event] };
    },
  };

  const repository = new PrismaWorkRepository();
  repositories.push(repository);
  const workflow = new ChapterWorkflow(repository, provider);

  const work = await workflow.createWork('持久化验证', {
    entryMode: 'expand', genre: 'xuanhuan', substyle: '',
    audience: '喜欢阶段突破很清楚的读者', hook: '主角用寿命换一次胜利',
    mustKeep: '师徒不反目', lockedNotes: '', avoid: '不要系统面板',
    targetLength: '长篇，篇幅未定', chapterWords: 2200, updateCadence: '日更',
  });
  await lockMinimalDesign(workflow, work.id);
  const approved = await approveMinimalPlan(workflow, work.id);
  const input = designReviewInput((await repository.get(work.id))!, 'power');
  const report = await repository.transaction(work.id, ({ work }) => recordDesignReview(work, input, fixtureDesignReview(input)));
  const confirmed = await workflow.confirmBrief(work.id, 1, { location: '外门演武场' });
  const candidate = await workflow.generate(work.id, 1, 'run-persist');

  const planRepository = new PrismaWorkRepository();
  repositories.push(planRepository);
  const withPlan = await planRepository.get(work.id);
  assert.deepEqual(withPlan?.designContentReviews.get(report.id), report);
  assert.deepEqual(withPlan?.worldPack?.resources[0].usage, (await repository.get(work.id))!.worldPack!.resources[0].usage);
  assert.match(withPlan!.worldPack!.resources[0].usage!.effect, /不增加寿命/);
  assert.equal(designReviewOverview(withPlan!).areas.find((area) => area.area === 'power')?.status, 'passed');
  assert.equal(withPlan?.activePlanId, approved.id);
  assert.equal(withPlan?.plans.get(approved.id)?.status, 'approved');
  assert.equal(withPlan?.plans.get(approved.id)?.contentHash, approved.contentHash);
  assert.equal(withPlan?.plans.get(approved.id)?.reviews.length, 1);
  assert.equal(withPlan?.plans.get(approved.id)?.plan.chapters.length, 10);
  assert.equal(withPlan?.briefs.get(confirmed.id)?.location, '外门演武场');
  assert.equal(withPlan?.candidates.get(candidate.id)?.planRevisionId, approved.id);
  assert.equal(withPlan?.candidates.get(candidate.id)?.brief?.location, '外门演武场');
  assert.equal(withPlan?.covenantHistory.length, 1);

  // Generate, check and adopt each through a fresh repository so every step reloads from the DB.
  const checkRepository = new PrismaWorkRepository();
  repositories.push(checkRepository);
  const afterGenerate = await checkRepository.get(work.id);
  const storedCandidate = afterGenerate?.candidates.get(candidate.id);
  assert.equal(storedCandidate?.generatedAgainstWorldPackRevision, afterGenerate?.worldPack?.revision);
  assert.equal(storedCandidate?.generatedAgainstStoryBibleRevision, afterGenerate?.storyBible?.revision);
  assert.equal(storedCandidate?.contentHash, candidate.contentHash);
  assert.equal(storedCandidate?.origin, 'model');
  await new ChapterWorkflow(checkRepository, provider).check(work.id, candidate.id, [passChecker]);

  const adoptRepository = new PrismaWorkRepository();
  repositories.push(adoptRepository);
  const adopted = await new ChapterWorkflow(adoptRepository, provider).adopt(work.id, candidate.id, 0);
  assert.equal(adopted.version.chapterNumber, 1);
  assert.equal(adopted.outbox.length, 3);

  // A fresh repository instance must rebuild the same aggregate from the DB.
  const freshRepository = new PrismaWorkRepository();
  repositories.push(freshRepository);
  const reloaded = await freshRepository.get(work.id);
  assert.ok(reloaded);
  assert.equal(reloaded.stateRevision, 1);
  assert.equal(reloaded.covenant.hook, '主角用寿命换一次胜利');
  assert.equal(reloaded.covenant.mustKeep, '师徒不反目');
  assert.equal(reloaded.versions.get(adopted.version.id)?.content, '第1章');
  assert.equal(reloaded.events.size, 1);
  assert.equal(reloaded.states.get('hero|power')?.value, 1, 'character state projection rebuilds from events');
  assert.equal(reloaded.candidates.get(candidate.id)?.checks[0]?.status, 'passed');
  assert.equal(reloaded.candidates.get(candidate.id)?.status, 'adopted');

  const outbox = await repository.outbox();
  assert.equal(outbox.length, 3);
  assert.ok(outbox.every((event) => event.workId === work.id));

  const { addCharacter, addSettingRelationship, addWorldRule, removeSettingRelationship, updateSettingRelationship } = await import('../../../novel-service-core/src/bible.ts');
  const person = (name: string) => ({ name, aliases: [], role: 'major' as const, identity: '', goal: '', principles: '', voice: '', notes: '' });
  const created = await workflow.editSettings(work.id, (draft) => {
    const a = addCharacter(draft, { ...person('林渊'), aliases: ['渊哥'], canonicalId: 'hero' });
    const b = addCharacter(draft, person('苏晚'));
    const objective = addSettingRelationship(draft, { fromCharacterId: b.id, toCharacterId: a.id, kind: '身份', value: '亲兄妹', layer: 'objective', note: '' });
    updateSettingRelationship(draft, objective.id, { lockPolicy: 'baseline_locked' });
    const belief = addSettingRelationship(draft, { fromCharacterId: b.id, toCharacterId: a.id, kind: '身份', value: '仇人之子', layer: 'belief', note: '' });
    addWorldRule(draft, { category: 'cost', title: '禁术', content: '折寿' });
    return { objective, belief };
  });
  await workflow.editSettings(work.id, (draft) => removeSettingRelationship(draft, created.belief.id));
  const settingsRepository = new PrismaWorkRepository();
  repositories.push(settingsRepository);
  const withSettings = await settingsRepository.get(work.id);
  assert.ok(withSettings);
  assert.equal(withSettings.stateRevision, 1, 'settings edits do not advance story revision');
  assert.deepEqual([...withSettings.characters.values()].map((item) => item.name), ['林渊', '苏晚']);
  assert.deepEqual([...withSettings.characters.values()][0].aliases, ['渊哥']);
  assert.deepEqual([...withSettings.relationships.keys()], [created.objective.id], 'removed relationship is deleted');
  assert.equal(withSettings.relationships.get(created.objective.id)?.lockPolicy, 'baseline_locked');
  assert.equal(withSettings.relationships.get(created.objective.id)?.locked, true);
  assert.equal([...withSettings.characters.values()][0].canonicalId, 'hero');
  assert.equal(withSettings.worldRules.size, 1);

  // Idempotent re-adoption must not duplicate outbox events and must report the stored ids.
  const again = await workflow.adopt(work.id, candidate.id, 1);
  assert.equal(again.version.id, adopted.version.id);
  assert.equal((await repository.outbox()).length, 3);
  assert.deepEqual(again.outbox.map((event) => event.id).sort(), outbox.map((event) => event.id).sort());
  assert.deepEqual(adopted.outbox.map((event) => event.id).sort(), outbox.map((event) => event.id).sort());
});

test('prisma repository keeps legacy candidates without design revisions stale and appends check history', async (t) => {
  const databaseUrl = createDatabase();
  const repositories: Array<{ disconnect(): Promise<void> }> = [];
  t.after(async () => {
    for (const repository of repositories) await repository.disconnect();
    rmSync(databaseUrl.slice(5), { force: true });
  });
  process.env.DATABASE_URL = databaseUrl;

  const { PrismaClient } = await import('@prisma/client');
  const { PrismaWorkRepository } = await import('../src/prisma-repository.ts');
  const { ChapterWorkflow } = await import('../../application/src/index.ts');
  const { passChecker, StaleCandidateError } = await import('../../../novel-service-core/src/core.ts');
  const { createReadyWork } = await import('../../application/test/fixtures.ts');
  const provider: ModelProvider = { generateChapter: ({ chapterNumber }) => ({ content: `第${chapterNumber}章`, proposedEvents: [], observedEvents: [] }) };

  const repository = new PrismaWorkRepository();
  repositories.push(repository);
  const workflow = new ChapterWorkflow(repository, provider);
  const work = await createReadyWork(workflow, '旧数据');
  const candidate = await workflow.generate(work.id, 1, 'legacy');
  const failingFirst = { name: passChecker.name, check: ({ candidate: item }: { candidate: { id: string } }) => ({ checker: passChecker.name, status: 'failed' as const, message: 'first attempt', candidateId: item.id, checkedAt: new Date().toISOString() }) };
  await workflow.check(work.id, candidate.id, [failingFirst]);
  await workflow.check(work.id, candidate.id, [passChecker]);

  const prisma = new PrismaClient();
  repositories.push({ disconnect: () => prisma.$disconnect() });
  assert.equal(await prisma.checkExecution.count({ where: { candidateId: candidate.id } }), 2, 'every check execution is kept');
  await prisma.chapterCandidate.update({ where: { id: candidate.id }, data: { generatedAgainstWorldPackRev: null, generatedAgainstStoryBibleRev: null } });

  const fresh = new PrismaWorkRepository();
  repositories.push(fresh);
  const reloaded = await fresh.get(work.id);
  assert.equal(reloaded?.candidates.get(candidate.id)?.checkRuns.length, 2);
  assert.deepEqual(reloaded?.candidates.get(candidate.id)?.checkRuns.map((check) => check.status), ['failed', 'passed']);
  assert.deepEqual(reloaded?.candidates.get(candidate.id)?.checks.map((check) => check.status), ['passed'], 'the latest execution per checker decides');
  await assert.rejects(() => new ChapterWorkflow(fresh, provider).adopt(work.id, candidate.id, 0), StaleCandidateError);
});

test('prisma repository serializes a third waiter behind the first two', async (t) => {
  const databaseUrl = createDatabase();
  const repositories: Array<{ disconnect(): Promise<void> }> = [];
  t.after(async () => {
    for (const repository of repositories) await repository.disconnect();
    rmSync(databaseUrl.slice(5), { force: true });
  });
  process.env.DATABASE_URL = databaseUrl;
  const { PrismaWorkRepository } = await import('../src/prisma-repository.ts');
  const { ChapterWorkflow } = await import('../../application/src/index.ts');
  const repository = new PrismaWorkRepository();
  repositories.push(repository);
  const work = await new ChapterWorkflow(repository, { generateChapter: () => ({ content: '', proposedEvents: [] }) }).createWork('串行');
  const order: string[] = [];
  const first = repository.transaction(work.id, async () => { order.push('first-start'); await new Promise((resolve) => setTimeout(resolve, 30)); order.push('first-end'); });
  const second = repository.transaction(work.id, async () => { order.push('second-start'); await new Promise((resolve) => setTimeout(resolve, 30)); order.push('second-end'); });
  const third = repository.transaction(work.id, async () => { order.push('third'); });
  await Promise.all([first, second, third]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second-start', 'second-end', 'third']);
});

test('prisma repository resumes the same generation checkpoint after restart', async (t) => {
  const databaseUrl = createDatabase();
  const repositories: Array<{ disconnect(): Promise<void> }> = [];
  t.after(async () => {
    for (const repository of repositories) await repository.disconnect();
    rmSync(databaseUrl.slice(5), { force: true });
  });
  process.env.DATABASE_URL = databaseUrl;

  const { PrismaWorkRepository } = await import('../src/prisma-repository.ts');
  const { ChapterWorkflow, IdempotencyConflictError } = await import('../../application/src/index.ts');
  const { passChecker } = await import('../../../novel-service-core/src/core.ts');
  const provider: ModelProvider = {
    generateChapter: ({ chapterNumber }) => {
      const event = { eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: chapterNumber, storyTime: chapterNumber, evidence: 'p1' };
      return { content: `第${chapterNumber}章`, proposedEvents: [event], observedEvents: [event] };
    },
  };

  const { createReadyWork } = await import('../../application/test/fixtures.ts');
  const failingProvider: ModelProvider = {
    generateChapter: (input) => {
      if (input.chapterNumber === 3) throw new Error('model timeout');
      return provider.generateChapter(input);
    },
  };

  const firstRepository = new PrismaWorkRepository();
  repositories.push(firstRepository);
  const firstWorkflow = new ChapterWorkflow(firstRepository, failingProvider);
  const work = await createReadyWork(firstWorkflow, '断点恢复');
  await assert.rejects(() => firstWorkflow.runUntil(work.id, 4, [passChecker], 'durable-run'), /model timeout/);

  const freshRepository = new PrismaWorkRepository();
  repositories.push(freshRepository);
  const paused = (await freshRepository.get(work.id))?.checkpoints.get('durable-run');
  assert.equal(paused?.phase, 'paused');
  assert.equal(paused?.nextChapter, 3);
  assert.equal(paused?.leaseToken, undefined, 'a paused run does not keep the lease');
  const freshWorkflow = new ChapterWorkflow(freshRepository, provider);
  await assert.rejects(() => freshWorkflow.runUntil(work.id, 99, [passChecker], 'durable-run'), IdempotencyConflictError);
  const resumed = await freshWorkflow.runUntil(work.id, 4, [passChecker], 'durable-run');
  assert.equal(resumed.nextChapter, 5);
  assert.equal(resumed.targetChapter, 4);
  const reloaded = await freshRepository.get(work.id);
  assert.ok(reloaded);
  assert.equal(reloaded.versions.size, 4);
  assert.equal(reloaded.checkpoints.get('durable-run')?.nextChapter, 5);
  assert.equal(reloaded.checkpoints.get('durable-run')?.phase, 'complete');
  assert.equal((await freshRepository.outbox()).length, 12, 'run adoptions write the same outbox events as manual adoption');
});

test('prisma repository round-trips leases, control, attempts, usage, check inputs and rulings', async (t) => {
  const databaseUrl = createDatabase();
  const repositories: Array<{ disconnect(): Promise<void> }> = [];
  t.after(async () => {
    for (const repository of repositories) await repository.disconnect();
    rmSync(databaseUrl.slice(5), { force: true });
  });
  process.env.DATABASE_URL = databaseUrl;

  const { PrismaWorkRepository } = await import('../src/prisma-repository.ts');
  const { ChapterWorkflow } = await import('../../application/src/index.ts');
  const { chapterLengthChecker } = await import('../../../novel-service-core/src/core.ts');
  const { createReadyWork } = await import('../../application/test/fixtures.ts');
  const policy = { version: 'p', required: ['chapter_length'], overridable: ['chapter_length'] };
  const shortWriter: ModelProvider = {
    generateChapter: () => { throw new Error('sync path not used'); },
    generateChapterAsync: async () => ({ content: '短章', proposedEvents: [], observedEvents: [], usage: { calls: 1, failedCalls: 0, inputTokens: 10, outputTokens: 20, costUsd: 0.5, costKnown: true } }),
  };

  const repository = new PrismaWorkRepository();
  repositories.push(repository);
  const workflow = new ChapterWorkflow(repository, shortWriter, undefined, { checkPolicy: policy });
  const work = await createReadyWork(workflow, '持久裁决');
  await assert.rejects(() => workflow.runUntil(work.id, 1, [chapterLengthChecker], 'refused'), /chapter_length/);
  await workflow.controlRun(work.id, 'refused', 'pause');

  const fresh = new PrismaWorkRepository();
  repositories.push(fresh);
  const reloaded = (await fresh.get(work.id))!;
  const checkpoint = reloaded.checkpoints.get('refused')!;
  assert.equal(checkpoint.phase, 'paused');
  assert.equal(checkpoint.leaseToken, undefined);
  assert.deepEqual(checkpoint.attempts, { 1: 2 });
  assert.deepEqual(checkpoint.usage, { calls: 1, failedCalls: 0, inputTokens: 10, outputTokens: 20, costUsd: 0.5, costKnown: true });
  const [candidate] = [...reloaded.candidates.values()];
  assert.equal(candidate.usage?.outputTokens, 20);
  const check = candidate.checks[0];
  assert.equal(check.contentHash, candidate.contentHash);
  assert.equal(check.policyVersion, 'p');
  assert.equal(check.inputs?.worldPackRevision, reloaded.worldPack?.revision);
  assert.equal(check.inputs?.stateRevision, 0);

  // The refused candidate stays open for the author; a ruling on it must survive a reload.
  const manual = await new ChapterWorkflow(fresh, shortWriter, undefined, { checkPolicy: policy }).generate(work.id, 1, 'manual');
  const manualWorkflow = new ChapterWorkflow(fresh, shortWriter, undefined, { checkPolicy: policy });
  await manualWorkflow.check(work.id, manual.id, [chapterLengthChecker]);
  const checkId = (await fresh.get(work.id))!.candidates.get(manual.id)!.checks[0].id!;
  const ruling = await manualWorkflow.recordRuling(work.id, manual.id, { checkId, reason: '楔子', evidence: '本章是楔子' });

  const third = new PrismaWorkRepository();
  repositories.push(third);
  const withRuling = (await third.get(work.id))!.candidates.get(manual.id)!;
  assert.deepEqual(withRuling.rulings.map((item) => [item.id, item.checkId, item.checker, item.decision]), [[ruling.id, checkId, 'chapter_length', 'false_positive']]);
  assert.equal(withRuling.checks[0].id, checkId, 'check execution ids are stable across reloads');
  const adopted = await new ChapterWorkflow(third, shortWriter, undefined, { checkPolicy: policy }).adopt(work.id, manual.id, 0);
  assert.equal(adopted.version.chapterNumber, 1);
});

test('SQLite review checkpoints survive repository restart and resume without repeating a batch', async t => {
  const databaseUrl = createDatabase();
  process.env.DATABASE_URL = databaseUrl;
  const { PrismaWorkRepository } = await import('../src/prisma-repository.ts');
  const { ChapterWorkflow } = await import('../../application/src/index.ts');
  const { createReadyWork, fixtureDesignReview } = await import('../../application/test/fixtures.ts');
  const first = new PrismaWorkRepository();
  const second = new PrismaWorkRepository();
  t.after(async () => { await first.disconnect(); await second.disconnect(); rmSync(databaseUrl.slice(5), { force: true }); });
  const provider = { generateChapter: () => ({ content: 'unused', proposedEvents: [] }) };
  const reviewer = { generateWorldPack: async () => { throw Error('unused'); }, generateStoryBible: async () => { throw Error('unused'); }, reviewDesignContent: async (input: Parameters<typeof fixtureDesignReview>[0]) => fixtureDesignReview(input) };
  const workflow = new ChapterWorkflow(first, provider, reviewer);
  const created = await createReadyWork(workflow, '分批评审恢复');
  const work = (await first.get(created.id))!;
  const proposed = structuredClone(work.plans.get(work.activePlanId!)!.plan);
  proposed.chapters[0].summary = '巨大材料'.repeat(70000);
  await workflow.savePlan(work.id, { baseRevisionId: work.activePlanId, plan: proposed });
  const run = await workflow.startDesignReview(work.id, 'story');
  await workflow.stepDesignReview(work.id, run.id);
  const restored = (await second.get(work.id))!.designReviewRuns.get(run.id)!;
  assert.deepEqual(restored.input, run.input);
  assert.equal(restored.stages[0].attempts, 1);
  assert.ok(restored.stages[0].result);
  assert.equal((await second.get(work.id))!.designContentReviews.size, 0);
  const resumed = new ChapterWorkflow(second, provider, reviewer);
  let progress = await resumed.stepDesignReview(work.id, run.id);
  while (progress.status !== 'completed') progress = await resumed.stepDesignReview(work.id, run.id);
  const final = (await first.get(work.id))!;
  assert.equal(final.designReviewRuns.get(run.id)!.stages[0].attempts, 1);
  assert.equal(final.designContentReviews.get(progress.reportId!)!.runId, run.id);
  assert.equal(final.versions.size, 0);
});

test('parallel detail reads keep separate response envelopes and bookshelf reads omit full histories', async t => {
  const databaseUrl = createDatabase();
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaWorkRepository } = await import('../src/prisma-repository.ts');
  const { ChapterWorkflow } = await import('../../application/src/index.ts');
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [{ emit: 'event', level: 'query' }] });
  const queries: string[] = [];
  prisma.$on('query', event => { if (/^SELECT .* FROM [`"]?(?:main[`"]?\.)?[`"]?Project[`"]?\s/.test(event.query)) queries.push(event.query); });
  const repository = new PrismaWorkRepository(prisma);
  t.after(async () => { await repository.disconnect(); rmSync(databaseUrl.slice(5), { force: true }); });
  const workflow = new ChapterWorkflow(repository, { generateChapter: () => ({ content: 'unused', proposedEvents: [] }) });
  const a = await createReadyWork(workflow, '作品甲'), b = await createReadyWork(workflow, '作品乙');
  await repository.transaction(a.id, ({ work }) => { const input = designReviewInput(work, 'world'); recordDesignReview(work, input, fixtureDesignReview(input)); });
  const expectedA = (await repository.get(a.id))!;
  queries.length = 0;
  const [readA, readB, missing] = await Promise.all([repository.get(a.id), repository.get(b.id), repository.get('absent')]);
  assert.equal(queries.length, 3, 'driver must not merge large detail responses into one JSON string');
  assert.deepEqual(readA!.designContentReviews, expectedA.designContentReviews);
  assert.deepEqual(readA!.designHistory, expectedA.designHistory);
  assert.equal(readB!.id, b.id);
  assert.equal(missing, undefined);
  queries.length = 0;
  const listed = await repository.list();
  assert.equal(listed.length, 2);
  for (const row of listed) {
    const original = row.id === a.id ? readA! : readB!;
    assert.deepEqual(row, { id: original.id, title: original.title, stateRevision: original.stateRevision,
      constraintRevision: original.constraintRevision, covenant: original.covenant });
  }
  assert.equal(queries.length, 1);
  assert.doesNotMatch(queries[0], /designHistory|designReviewRuns|designContentReviews|worldPack|storyBible/,
    'listing must not transfer growing design or review history through the driver');
  assert.equal((await repository.get(a.id))!.designContentReviews.size, expectedA.designContentReviews.size);
});

test('review-only saves skip historical rows while nested edits and rollback remain atomic', async t => {
  const databaseUrl = createDatabase();
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaWorkRepository } = await import('../src/prisma-repository.ts');
  const { ChapterWorkflow } = await import('../../application/src/index.ts');
  const { createReadyWork } = await import('../../application/test/fixtures.ts');
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [{ emit: 'event', level: 'query' }] });
  const writes: string[] = [];
  prisma.$on('query', event => { if (/^(INSERT|UPDATE|DELETE)/.test(event.query)) writes.push(event.query); });
  const repository = new PrismaWorkRepository(prisma);
  t.after(async () => { await repository.disconnect(); rmSync(databaseUrl.slice(5), { force: true }); });
  const workflow = new ChapterWorkflow(repository, { generateChapter: () => ({ content: 'unused', proposedEvents: [] }) });
  const created = await createReadyWork(workflow, '增量持久化');
  const initial = (await repository.get(created.id))!;
  const planId = initial.activePlanId!;
  const input = designReviewInput(initial, 'power');
  writes.length = 0;
  await repository.transaction(created.id, ({ work }) => recordDesignReview(work, input, fixtureDesignReview(input)));
  assert.equal(writes.length, 1, 'review progress only updates the project row');
  assert.match(writes[0], /UPDATE .*Project/);
  assert.doesNotMatch(writes[0], /"designHistory"\s*=|"storyBible"\s*=|"worldPack"\s*=/, 'unchanged large JSON fields are not rewritten');
  const reviewed = (await repository.get(created.id))!;
  assert.equal(reviewed.designContentReviews.size, initial.designContentReviews.size + 1);
  assert.deepEqual(reviewed.plans, initial.plans);

  writes.length = 0;
  await repository.transaction(created.id, ({ work }) => { work.plans.get(planId)!.reviews[0].passed = false; });
  assert.equal((await repository.get(created.id))!.plans.get(planId)!.reviews[0].passed, false);
  assert.ok(writes.some(query => /PlanRevision/.test(query)));
  assert.ok(writes.every(query => /Project|PlanRevision/.test(query)), 'unrelated tables stay untouched');

  await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_test_outbox BEFORE INSERT ON OutboxEvent
    WHEN NEW.dedupeKey = 'rollback' BEGIN SELECT RAISE(ABORT, 'rollback'); END`);
  await assert.rejects(repository.transaction(created.id, ({ work, enqueue }) => {
    work.title = 'rolled back';
    work.plans.get(planId)!.reviews[0].passed = true;
    enqueue({ workId: work.id, dedupeKey: 'rollback', kind: 'export', aggregateId: work.id, payload: {} });
  }));
  const after = (await repository.get(created.id))!;
  assert.equal(after.title, created.title);
  assert.equal(after.plans.get(planId)!.reviews[0].passed, false);
  assert.equal((await repository.outbox()).length, 0);
});

test('atomic aggregate saves can finish beyond the default five-second transaction deadline', async t => {
  const databaseUrl = createDatabase();
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaWorkRepository } = await import('../src/prisma-repository.ts');
  const { Work } = await import('../../../novel-service-core/src/core.ts');
  const repository = new PrismaWorkRepository(new PrismaClient({ datasources: { db: { url: databaseUrl } } }));
  t.after(async () => { await repository.disconnect(); rmSync(databaseUrl.slice(5), { force: true }); });
  const work = new Work('长篇汇总保存');
  await repository.save(work);
  await repository.transaction(work.id, async ({ work: current, enqueue }) => {
    // Reproduce time spent preparing a large report before the final SQL write.
    await new Promise(resolve => setTimeout(resolve, 5200));
    current.title = '汇总已保存';
    current.constraintRevision += 1;
    enqueue({ workId: work.id, dedupeKey: 'slow-final-save', kind: 'export', aggregateId: work.id, payload: {} });
  });
  assert.equal((await repository.get(work.id))!.title, '汇总已保存');
  assert.equal((await repository.get(work.id))!.constraintRevision, work.constraintRevision + 1);
  assert.equal((await repository.outbox()).length, 1);
});

test('SQLite reload keeps a newer rejection current when an older passing response arrives late', async t => {
  const databaseUrl = createDatabase();
  process.env.DATABASE_URL = databaseUrl;
  const { PrismaWorkRepository } = await import('../src/prisma-repository.ts');
  const { ChapterWorkflow } = await import('../../application/src/index.ts');
  const { passChecker, QualityGateError } = await import('../../../novel-service-core/src/core.ts');
  const first = new PrismaWorkRepository(), second = new PrismaWorkRepository();
  t.after(async () => { await first.disconnect(); await second.disconnect(); rmSync(databaseUrl.slice(5), { force: true }); });
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const signal = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  const provider: ModelProvider = {
    generateChapter: () => ({ content: '他按住伤口，放弃追击，先带同伴回城。', proposedEvents: [], observedEvents: [] }),
    reviewChapterAsync: async input => {
      const old = ++calls === 1;
      if (old) { started(); await gate; }
      const result = await fixtureChapterReview(input);
      if (!old) Object.assign(result.checks[0], { verdict: 'revise', revisionAdvice: '转折缺乏因果依据' });
      return result;
    },
  };
  const policy = { version: 'concurrent-chapter-review', required: ['deterministic_rules', chapterReviewChecker] };
  const workflow = new ChapterWorkflow(first, provider, undefined, { checkPolicy: policy });
  const work = await createReadyWork(workflow, '并发评审持久化');
  const candidate = await workflow.generate(work.id, 1, 'concurrent');
  const old = workflow.check(work.id, candidate.id, [passChecker]);
  await signal;
  await workflow.check(work.id, candidate.id, [passChecker]);
  const currentId = (await first.get(work.id))!.candidates.get(candidate.id)!.checks.find(c => c.checker === chapterReviewChecker)!.id;
  release(); await old;
  await first.disconnect();
  const saved = (await second.get(work.id))!.candidates.get(candidate.id)!;
  assert.equal(saved.checks.find(c => c.checker === chapterReviewChecker)?.id, currentId);
  assert.equal(saved.checks.find(c => c.checker === chapterReviewChecker)?.status, 'failed');
  assert.equal(saved.checkRuns.at(-1)?.chapterReview?.superseded, true);
  assert.equal(saved.checkRuns.at(-1)?.chapterReview?.result?.checks[0].verdict, 'pass');
  await assert.rejects(() => new ChapterWorkflow(second, provider, undefined, { checkPolicy: policy }).adopt(work.id, candidate.id, 0), QualityGateError);
});

test('whole-design save rolls back world and bible when plan insertion fails, then survives reload as one proposal', async t => {
  const databaseUrl = createDatabase(); process.env.DATABASE_URL = databaseUrl;
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaWorkRepository } = await import('../src/prisma-repository.ts');
  const { ChapterWorkflow } = await import('../../application/src/index.ts');
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [{ emit: 'event', level: 'query' }] });
  const repository = new PrismaWorkRepository(prisma), reader = new PrismaWorkRepository();
  t.after(async () => { await repository.disconnect(); await reader.disconnect(); rmSync(databaseUrl.slice(5), { force: true }); });
  const provider = { generateChapter: () => { throw new Error('No prose expected'); } };
  const workflow = new ChapterWorkflow(repository, provider);
  const work = await createReadyWork(workflow, '原子设计修订');
  const baseline = await workflow.designCandidate(work.id);
  baseline.candidate.worldPack.summary += '真实治疗才能恢复。';
  baseline.candidate.storyBible.coreConflict += '修复后的冲突。';
  baseline.candidate.plan.openQuestions.push({ id: 'still-open', question: '内容仍待正式评审', blocking: true, status: 'open' });
  const before = structuredClone(await repository.get(work.id));
  await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_bundle_plan BEFORE INSERT ON PlanRevision WHEN NEW.revision = 2 BEGIN SELECT RAISE(ABORT, 'injected_plan_failure'); END`);
  const queries: string[] = [];
  prisma.$on('query', event => {
    if (event.query.startsWith('UPDATE') && event.query.includes('Project')) queries.push('update_project');
    if (event.query.startsWith('INSERT') && event.query.includes('PlanRevision')) queries.push('insert_plan');
    if (event.query === 'ROLLBACK') queries.push('rollback');
  });
  await assert.rejects(() => workflow.saveDesignCandidate(work.id, baseline));
  assert.deepEqual(queries, ['update_project', 'insert_plan', 'rollback']);
  assert.deepEqual(structuredClone(await reader.get(work.id)), before, 'failed plan INSERT leaves no partial design or history');
  await prisma.$executeRawUnsafe('DROP TRIGGER fail_bundle_plan');
  const saved = await workflow.saveDesignCandidate(work.id, baseline), restored = (await reader.get(work.id))!;
  assert.equal(restored.worldPack!.revision, before!.worldPack!.revision + 1);
  assert.equal(restored.storyBible!.worldPackRevision, restored.worldPack!.revision);
  assert.equal(restored.plans.get(saved.plan.id)!.storyBibleRevision, restored.storyBible!.revision);
  assert.deepEqual(restored.plans.get(saved.plan.id)!.plan, baseline.candidate.plan);
  assert.equal(restored.activePlanId, before!.activePlanId);
  assert.deepEqual(restored.plans.get(restored.activePlanId!), before!.plans.get(before!.activePlanId!));
  assert.equal(restored.plans.get(saved.plan.id)!.status, 'proposed');
  assert.equal(saved.validation.blockers.length, 1);
  assert.equal(saved.contentReview.ready, false);
});

test('SQLite restart and early replacement preserve same-chapter transition order and all old events', async t => {
  const { eventOrderFixture, assertEventOrderStates } = await import('../../../novel-service-core/test/event-order-fixture.ts');
  const { NovelService, passChecker } = await import('../../../novel-service-core/src/core.ts');
  const { resolveStoryEventOrder } = await import('../../../novel-service-core/src/event-order.ts');
  const databaseUrl = createDatabase();
  process.env.DATABASE_URL = databaseUrl;
  const { PrismaWorkRepository } = await import('../src/prisma-repository.ts');
  const first = new PrismaWorkRepository();
  const second = new PrismaWorkRepository();
  t.after(async () => { await first.disconnect(); await second.disconnect(); rmSync(databaseUrl.slice(5), { force: true }); });
  const { work, drafts } = eventOrderFixture();
  const oldIds = [...work.events.keys()];
  await first.save(work);
  const reloaded = (await second.get(work.id))!;
  assert.equal(reloaded.states.get('hero|power')?.value, 8);
  assertEventOrderStates(reloaded);
  const service = new NovelService({ generateChapter: () => ({ content: '后章', proposedEvents: drafts, observedEvents: drafts }) });
  service.works.set(reloaded.id, reloaded);
  const candidate = service.generateCandidate(reloaded.id, 2, 'after-restart');
  service.runChecks(reloaded.id, candidate.id, [passChecker]);
  const downstream = service.adoptCandidate(reloaded.id, candidate.id);
  await second.save(reloaded);
  service.editAdoptedChapter(reloaded.id, 1, '改字后仍然收到十枚，花掉两枚。', [passChecker]);
  await second.save(reloaded);
  const restored = (await first.get(work.id))!;
  assertEventOrderStates(restored);
  assert.equal(restored.versions.get(downstream.id)?.stale, true);
  for (const id of oldIds) assert.equal(restored.events.get(id)?.active, false);
  assert.equal(restored.events.size, work.events.size * 3);
  assert.deepEqual(resolveStoryEventOrder(restored, [...restored.events.values()].filter(event => event.active)).issues, []);
});
