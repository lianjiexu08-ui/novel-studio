import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { Work } from '../../../novel-service-core/src/core.ts';
import { minimalWorldPack } from '../../application/test/fixtures.ts';
import { PrismaWorkRepository } from '../src/prisma-repository.ts';

test('current reads wait for a slow repository write and see the committed snapshot', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'novel-queued-read-'));
  const databaseUrl = `file:${join(directory, 'test.db')}`;
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  t.after(async () => { await client.$disconnect(); await rm(directory, { recursive: true, force: true }); });
  await client.$executeRaw`CREATE TABLE "Project" (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, genre TEXT NOT NULL DEFAULT 'xuanhuan',
    covenant TEXT NOT NULL DEFAULT '{}', "stateRevision" INTEGER NOT NULL DEFAULT 0,
    "constraintRevision" INTEGER NOT NULL DEFAULT 0, "worldPack" TEXT NOT NULL DEFAULT '{}',
    "storyBible" TEXT NOT NULL DEFAULT '{}', "activePlanId" TEXT,
    "designHistory" TEXT NOT NULL DEFAULT '[]', "designContentReviews" TEXT NOT NULL DEFAULT '[]',
    "covenantHistory" TEXT NOT NULL DEFAULT '[]', "designReviewRuns" TEXT NOT NULL DEFAULT '[]',
    "designReviewAnnotations" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
  )`;
  for (const table of ['Relationship', 'Character', 'WorldRule', 'PlotNode', 'RunCheckpoint', 'ManuscriptRevision']) {
    await client.$executeRawUnsafe(`CREATE TABLE "${table}" (id TEXT PRIMARY KEY, "projectId" TEXT NOT NULL)`);
  }
  await client.$executeRaw`CREATE TABLE "OutboxEvent" (
    id TEXT PRIMARY KEY, "dedupeKey" TEXT NOT NULL, "projectId" TEXT NOT NULL,
    kind TEXT NOT NULL, "aggregateId" TEXT NOT NULL, payload TEXT NOT NULL,
    "publishedAt" DATETIME, attempts INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;
  assert.deepEqual(await client.$queryRaw`PRAGMA journal_mode`, [{ journal_mode: 'delete' }]);
  const writer = new PrismaWorkRepository(client), reader = new PrismaWorkRepository(client);
  const work = new Work('原名称', 'work');
  await writer.save(work);
  let entered!: () => void, release!: () => void;
  const writeEntered = new Promise<void>(resolve => { entered = resolve; });
  const writeRelease = new Promise<void>(resolve => { release = resolve; });
  let holding = false;
  client.$use(async (params, next) => {
    const result = await next(params);
    if (!holding && params.model === 'Project' && params.action === 'upsert') {
      holding = true; entered(); await writeRelease;
    }
    return result;
  });
  work.title = '已提交名称'; work.constraintRevision = 9;
  work.worldPack = minimalWorldPack();
  work.worldPack.summary = '规则'.repeat(4_000_000);
  const writing = writer.save(work);
  await writeEntered;
  // Exceed SQLite's default busy deadline with a genuine open write. Readers
  // must wait outside Prisma, not time out inside it or retry a mutation.
  const timer = setTimeout(release, 6_000);
  let results: PromiseSettledResult<unknown>[];
  try {
    results = await Promise.allSettled([reader.getWorkSummary('work'), reader.getDesignSnapshot('work'), reader.list(), reader.outbox()]);
  } finally { release(); clearTimeout(timer); await writing; }
  for (const result of results) assert.equal(result.status, 'fulfilled', result.status === 'rejected' ? String(result.reason) : '');
  const [summary, design, list, outbox] = results.map(result => (result as PromiseFulfilledResult<any>).value);
  assert.equal(summary.title, '已提交名称');
  assert.equal(summary.constraintRevision, 9);
  assert.equal(design.constraintRevision, 9);
  assert.equal(list[0].title, '已提交名称');
  assert.deepEqual(outbox, []);
  assert.equal((await writer.getWorkSummary('work'))!.title, '已提交名称');
  let failNextRead = true;
  client.$use(async (params, next) => {
    if (failNextRead && params.model === 'Project' && params.action === 'findUnique') {
      failNextRead = false; throw new Error('isolated read failure');
    }
    return next(params);
  });
  await assert.rejects(() => reader.getWorkSummary('work'), /isolated read failure/);
  assert.equal((await writer.getWorkSummary('work'))!.title, '已提交名称', 'a failed read must release the queue');
});
