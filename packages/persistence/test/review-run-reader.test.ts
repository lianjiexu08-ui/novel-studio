import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createDesignReviewRun, designReviewStageInput } from '../../../novel-service-core/src/design-review-run.ts';
import { PrismaWorkRepository } from '../src/prisma-repository.ts';
import { readDesignReviewRun } from '../src/review-run-reader.ts';

test('SQLite reads only the selected review, preserving evidence, failures and fresh snapshots', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'novel-review-reader-'));
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${join(directory, 'test.db')}` } } });
  t.after(async () => { await prisma.$disconnect(); await rm(directory, { recursive: true, force: true }); });
  // No chapter, manuscript, or other aggregate tables: a detail read must not
  // need them. Exercise real SQLite JSON queries, not a mock of their SQL.
  await prisma.$executeRaw`CREATE TABLE "Project" (id TEXT PRIMARY KEY, "designReviewRuns" TEXT NOT NULL)`;
  const run = createDesignReviewRun({ area: 'power', inputHash: '1'.repeat(64),
    scope: { worldPackRevision: 1, storyBibleRevision: 2, planRevisionId: 'plan', planRevision: 3 },
    rubric: { costs: '不能返还已耗寿元' },
    sources: [{ id: 'world/axioms/cost', text: '寿元😀𠮷\n"\\'.repeat(90) }],
  });
  run.stages[0].attempts = 2;
  run.stages[0].failures = [{ at: run.createdAt, error: '原回答不合格', modelResponses: ['保留原文😀\n"'] }];
  run.stages[0].result = { summary: '待核', checks: [{ criterion: 'costs', verdict: 'insufficient',
    explanation: '仍需核对', revisionAdvice: '补读', insufficiencyReason: 'missing_design',
    evidence: [{ sourceId: run.units[0].id, quote: '寿元😀𠮷' }],
  }] };
  const old = { ...run, status: 'failed' }, unrelated = { ...run, id: 'unrelated', padding: 'UNRELATED'.repeat(300_000) };
  const history = JSON.stringify([old, unrelated, run]);
  await prisma.$executeRaw`INSERT INTO "Project" VALUES (${'work'}, ${history})`;
  await prisma.$executeRaw`INSERT INTO "Project" VALUES (${'other'}, ${JSON.stringify([{ ...run, status: 'failed' }])})`;
  let responses = 0, maxStringLength = 0;
  const saved = await prisma.$transaction(async tx => readDesignReviewRun({
    $queryRaw: (async (query: Parameters<typeof tx.$queryRaw>[0]) => {
      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(query);
      for (const row of rows) for (const value of Object.values(row)) if (typeof value === 'string') {
        responses++; maxStringLength = Math.max(maxStringLength, value.length);
        assert.ok(!value.includes('UNRELATED'));
      }
      return rows;
    }) as typeof tx.$queryRaw,
  }, 'work', run.id, 97));
  assert.deepEqual(saved, run, 'last duplicate must match aggregate Map semantics');
  assert.ok(responses > 1 && maxStringLength <= 194, 'SQLite chunks count code points; UTF-16 may use two units');
  assert.deepEqual(designReviewStageInput(saved!, saved!.stages[0]), designReviewStageInput(run, run.stages[0]));
  const repository = new PrismaWorkRepository(prisma);
  assert.deepEqual(await repository.getDesignReviewRun('work', run.id), run);
  assert.equal((await repository.getDesignReviewRun('other', run.id))!.status, 'failed');
  assert.equal(await repository.getDesignReviewRun('missing', run.id), undefined);
  assert.equal(await repository.getDesignReviewRun('work', "' OR 1=1 --"), undefined);
  assert.equal(await repository.getDesignReviewRun("work' OR 1=1 --", run.id), undefined);
  run.stages[0].error = '新保存的失败';
  await prisma.$executeRaw`UPDATE "Project" SET "designReviewRuns" = ${JSON.stringify([run])} WHERE id = ${'work'}`;
  assert.deepEqual(await repository.getDesignReviewRun('work', run.id), run, 'later reads must not retain old progress');
  await prisma.$transaction(async tx => {
    const auditRepository = new PrismaWorkRepository(tx as PrismaClient);
    assert.deepEqual(await auditRepository.getDesignReviewRun('work', run.id), run, 'do not nest caller transactions');
  });
  const [unchanged] = await prisma.$queryRaw<Array<{ history: string }>>`SELECT "designReviewRuns" AS history FROM "Project" WHERE id = ${'work'}`;
  assert.equal(unchanged.history, JSON.stringify([run]), 'reading must not rewrite the saved record');
  for (const empty of ['[]', '{}', 'not-json']) {
    await prisma.$executeRaw`UPDATE "Project" SET "designReviewRuns" = ${empty} WHERE id = ${'work'}`;
    assert.equal(await repository.getDesignReviewRun('work', run.id), undefined);
  }
});
