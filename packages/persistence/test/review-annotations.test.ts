import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonWorkRepository } from '../src/json-repository.ts';
import { PrismaWorkRepository } from '../src/prisma-repository.ts';
import { PrismaClient } from '@prisma/client';
import { ChapterWorkflow } from '../../application/src/index.ts';
import { annotationFixture, annotationWriter } from '../../application/test/review-annotation-fixture.ts';
import { annotationSources } from '../../../novel-service-core/src/design-review-annotations.ts';

test('JSON annotations survive restart, remain idempotent, and older files load without annotations', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'novel-note-json-')), file = join(dir, 'state.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { workflow, workId, input } = await annotationFixture(new JsonWorkRepository(file));
  const note = await workflow.addDesignReviewAnnotation(workId, input);
  const restored = new JsonWorkRepository(file), work = (await restored.get(workId))!;
  assert.deepEqual(work.designReviewAnnotations.get(note.id), note);
  assert.match(annotationSources(work, note)[0].text, /力量必须支付代价/);
  assert.deepEqual(await new ChapterWorkflow(restored, annotationWriter).addDesignReviewAnnotation(workId, input), note);
  const legacy = JSON.parse(readFileSync(file, 'utf8'));
  delete legacy.works[0].designReviewAnnotations;
  writeFileSync(file, JSON.stringify(legacy));
  assert.equal((await new JsonWorkRepository(file).get(workId))!.designReviewAnnotations.size, 0);
});

test('SQLite schema upgrade defaults old projects to empty notes and preserves notes across restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'novel-note-sqlite-')), databaseUrl = `file:${join(dir, 'test.db')}`;
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'test.db'), '');
  const schema = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));
  const legacySchema = join(dir, 'legacy.prisma');
  writeFileSync(legacySchema, readFileSync(schema, 'utf8').replace(/^.*designReviewAnnotations.*\n/gm, ''));
  const push = (schemaPath: string) => execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--schema', schemaPath], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe',
  });
  push(legacySchema);
  let client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await client.$executeRawUnsafe('INSERT INTO Project (id, title, updatedAt) VALUES (?, ?, ?)', 'old-work', '旧作品', new Date().toISOString());
  const oldRows = await client.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT * FROM Project');
  await client.$disconnect();
  const migration = fileURLToPath(new URL('../../../scripts/migrate-review-annotations.py', import.meta.url));
  const migrate = () => execFileSync('python3', [migration, join(dir, 'test.db')], { encoding: 'utf8' });
  assert.match(migrate(), /Added designReviewAnnotations/);
  assert.match(migrate(), /already exists; no change/);
  assert.equal(readdirSync(join(dir, 'audit-backups')).length, 1);
  client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const repository = new PrismaWorkRepository(client);
  t.after(async () => { await client.$disconnect(); });
  const migratedRows = await client.$queryRawUnsafe<Array<Record<string, unknown>>>('SELECT * FROM Project');
  assert.deepEqual(migratedRows.map(({ designReviewAnnotations, ...row }) => {
    assert.equal(designReviewAnnotations, '[]'); return row;
  }), oldRows, 'migration preserves all original project fields');
  assert.equal((await repository.get('old-work'))!.designReviewAnnotations.size, 0);
  const { workflow, workId, input, run } = await annotationFixture(repository);
  const note = await workflow.addDesignReviewAnnotation(workId, input);
  const adviceInput = { ...input, requestKey: 'advice-restart', claimField: 'revisionAdvice' as const, claimQuote: '补充力量代价。' };
  const adviceNote = await workflow.addDesignReviewAnnotation(workId, adviceInput);
  await client.$disconnect();
  client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const restored = new PrismaWorkRepository(client), work = (await restored.get(workId))!;
  assert.deepEqual(work.designReviewAnnotations.get(note.id), note);
  assert.deepEqual(work.designReviewRuns.get(run.id), JSON.parse(JSON.stringify(run)));
  assert.match(annotationSources(work, note)[0].text, /力量必须支付代价/);
  assert.deepEqual(await new ChapterWorkflow(restored, annotationWriter).addDesignReviewAnnotation(workId, input), note);
  assert.deepEqual(work.designReviewAnnotations.get(adviceNote.id), adviceNote);
  assert.match(annotationSources(work, adviceNote)[0].text, /力量必须支付代价/);
  assert.deepEqual(await new ChapterWorkflow(restored, annotationWriter).addDesignReviewAnnotation(workId, adviceInput), adviceNote);
  assert.equal((await restored.get(workId))!.designReviewAnnotations.size, 2);
});
