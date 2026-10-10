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
  const confirmed = await workflow.confirmBrief(work.id, 1, { location: '外门演武场' });
  const candidate = await workflow.generate(work.id, 1, 'run-persist');

  const planRepository = new PrismaWorkRepository();
  repositories.push(planRepository);
  const withPlan = await planRepository.get(work.id);
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
