import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ModelProvider } from '../../../novel-service-core/src/core.ts';

const persistenceDir = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replaceAll('/', '\\');

function createDatabase(): string {
  const dir = mkdtempSync(join(tmpdir(), 'novel-persistence-'));
  const databaseUrl = `file:${join(dir, 'test.db').replaceAll('\\', '/')}`;
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
  const candidate = await workflow.generate(work.id, 1, 'run-persist');
  await workflow.check(work.id, candidate.id, [passChecker]);
  const adopted = await workflow.adopt(work.id, candidate.id, 0);
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

  const { addCharacter, addSettingRelationship, addWorldRule, removeSettingRelationship } = await import('../../../novel-service-core/src/bible.ts');
  const person = (name: string) => ({ name, aliases: [], role: 'major' as const, identity: '', goal: '', principles: '', voice: '', notes: '' });
  const created = await workflow.editSettings(work.id, (draft) => {
    const a = addCharacter(draft, { ...person('林渊'), aliases: ['渊哥'] });
    const b = addCharacter(draft, person('苏晚'));
    const objective = addSettingRelationship(draft, { fromCharacterId: b.id, toCharacterId: a.id, kind: '身份', value: '亲兄妹', layer: 'objective', note: '' });
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
  assert.equal(withSettings.worldRules.size, 1);

  // Idempotent re-adoption must not duplicate outbox events.
  const again = await workflow.adopt(work.id, candidate.id, 1);
  assert.equal(again.version.id, adopted.version.id);
  assert.equal((await repository.outbox()).length, 3);
});
