import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { parseCovenant } from '../../../novel-service-core/src/core.ts';
import { PrismaWorkRepository } from '../src/prisma-repository.ts';

test('current metadata and design reads need no aggregate tables or history columns', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'novel-design-reader-'));
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${join(directory, 'test.db')}` } } });
  t.after(async () => { await prisma.$disconnect(); await rm(directory, { recursive: true, force: true }); });
  await prisma.$executeRaw`CREATE TABLE "Project" (id TEXT PRIMARY KEY, title TEXT NOT NULL, "stateRevision" INTEGER NOT NULL, "constraintRevision" INTEGER NOT NULL, covenant TEXT NOT NULL, "worldPack" TEXT NOT NULL, "storyBible" TEXT NOT NULL)`;
  const worldPack = { revision: 41, text: '寿元😀𠮷\n"\\' }, storyBible = { revision: 74, text: '人物关系' };
  const covenant = parseCovenant(undefined);
  await prisma.$executeRaw`INSERT INTO "Project" VALUES (${'work'}, ${'三界😀'}, ${12}, ${7}, ${JSON.stringify(covenant)}, ${JSON.stringify(worldPack)}, ${JSON.stringify(storyBible)})`;
  const repository = new PrismaWorkRepository(prisma);
  const expected = { worldPack, storyBible, constraintRevision: 7 };
  assert.deepEqual(await repository.getWorkSummary('work'), { id: 'work', title: '三界😀', stateRevision: 12, constraintRevision: 7, covenant: parseCovenant(covenant) });
  assert.deepEqual(await repository.getDesignSnapshot('work'), expected);
  for (const missing of ['missing', "work' OR 1=1 --"]) {
    assert.equal(await repository.getWorkSummary(missing), undefined);
    assert.equal(await repository.getDesignSnapshot(missing), undefined);
  }
  await prisma.$transaction(async tx => {
    const nested = new PrismaWorkRepository(tx as PrismaClient);
    assert.deepEqual(await nested.getDesignSnapshot('work'), expected);
    assert.equal((await nested.getWorkSummary('work'))!.title, '三界😀');
  });
  for (const raw of ['{}', '[]', 'null', '42', '"text"', 'not-json', '']) {
    await prisma.$executeRaw`UPDATE "Project" SET covenant = ${raw}, "worldPack" = ${raw}, "storyBible" = ${raw}, "constraintRevision" = ${8} WHERE id = ${'work'}`;
    assert.deepEqual(await repository.getDesignSnapshot('work'), { worldPack: undefined, storyBible: undefined, constraintRevision: 8 });
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
    assert.deepEqual((await repository.getWorkSummary('work'))!.covenant, parseCovenant(parsed));
    const [saved] = await prisma.$queryRaw<Array<{ covenant: string; worldPack: string; storyBible: string }>>`SELECT covenant, "worldPack", "storyBible" FROM "Project" WHERE id = ${'work'}`;
    assert.deepEqual(saved, { covenant: raw, worldPack: raw, storyBible: raw }, 'normalization must not write back');
  }
  await prisma.$executeRaw`UPDATE "Project" SET title = ${'新名称'}, "worldPack" = ${JSON.stringify({ ...worldPack, revision: 42 })} WHERE id = ${'work'}`;
  assert.equal((await repository.getWorkSummary('work'))!.title, '新名称');
  assert.equal((await repository.getDesignSnapshot('work'))!.worldPack!.revision, 42, 'reads must not retain old designs');
});
