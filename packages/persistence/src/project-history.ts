import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

type Reader = Pick<PrismaClient, 'project' | '$queryRaw'>;
export const projectHistoryColumns = ['designHistory', 'designContentReviews', 'designReviewRuns', 'designReviewAnnotations', 'covenantHistory'] as const;
type HistoryColumn = typeof projectHistoryColumns[number];
const chunkCharacters = 8 * 1024 * 1024;

/** Histories contain plain JSON records. Never stringify the entire accumulated
 * array or pass it through a single Prisma JSON request. Keep surrogate pairs
 * together so both UTF-8 hashing and database transport preserve every byte. */
export function* historyJsonChunks(records: Iterable<unknown>, limit = chunkCharacters): Generator<string> {
  if (!Number.isSafeInteger(limit) || limit < 2) throw new Error('Invalid history chunk size');
  function* fragments() {
    yield '['; let first = true;
    for (const record of records) {
      if (!first) yield ',';
      first = false;
      yield JSON.stringify(record) ?? 'null';
    }
    yield ']';
  }
  let buffer = '';
  for (const fragment of fragments()) {
    let offset = 0;
    while (offset < fragment.length) {
      let end = Math.min(fragment.length, offset + limit - buffer.length);
      if (end < fragment.length && /[\uD800-\uDBFF]/.test(fragment[end - 1] ?? '')) end--;
      if (end === offset) { yield buffer; buffer = ''; continue; }
      buffer += fragment.slice(offset, end); offset = end;
      if (buffer.length === limit) { yield buffer; buffer = ''; }
    }
  }
  if (buffer) yield buffer;
}

export function historyJsonHash(records: Iterable<unknown>): string {
  const digest = createHash('sha256');
  for (const chunk of historyJsonChunks(records)) digest.update(chunk);
  return digest.digest('hex');
}

/** The caller must hold a database transaction, including its optimistic fence.
 * Partial chunks must never become visible if serialization or a write fails. */
export async function writeProjectHistory(tx: Pick<PrismaClient, '$executeRaw'>, workId: string, column: HistoryColumn, records: Iterable<unknown>) {
  if (!projectHistoryColumns.includes(column)) throw new Error('Unknown history column');
  const identifier = Prisma.raw(`"${column}"`);
  let first = true;
  for (const chunk of historyJsonChunks(records)) {
    const changed = first
      ? await tx.$executeRaw(Prisma.sql`UPDATE "Project" SET ${identifier} = ${chunk} WHERE id = ${workId}`)
      : await tx.$executeRaw(Prisma.sql`UPDATE "Project" SET ${identifier} = CAST(${identifier} AS TEXT) || ${chunk} WHERE id = ${workId}`);
    if (changed !== 1) throw new Error('Project disappeared during history write');
    first = false;
  }
}

// A single project's accumulated review evidence can exceed V8's string limit
// once Prisma escapes all of its JSON columns into one native response. Bound
// each response without pruning evidence. The caller must provide a transaction
// so every chunk belongs to the same database snapshot.
export async function readProjectWithHistory(tx: Reader, workId: string) {
  const project = await tx.project.findFirst({ where: { id: workId }, select: {
    id: true, title: true, stateRevision: true, constraintRevision: true,
    covenant: true, worldPack: true, storyBible: true, activePlanId: true,
  } });
  if (!project) return undefined;
  const histories = {} as Record<HistoryColumn, string>;
  for (const column of projectHistoryColumns) {
    // Identifiers come exclusively from the fixed allowlist; values remain
    // parameters. CAST and substr work for SQLite text and PostgreSQL JSON.
    const identifier = Prisma.raw(`"${column}"`);
    const [size] = await tx.$queryRaw<Array<{ size: bigint | number }>>(Prisma.sql`
      SELECT length(CAST(${identifier} AS TEXT)) AS size FROM "Project" WHERE id = ${workId}`);
    if (!size) throw new Error('Project disappeared during history read');
    const length = Number(size.size);
    if (!Number.isSafeInteger(length) || length < 0) throw new Error('Invalid history length');
    const chunks: string[] = [];
    for (let offset = 1; offset <= length; offset += chunkCharacters) {
      const [row] = await tx.$queryRaw<Array<{ chunk: string }>>(Prisma.sql`
        SELECT substr(CAST(${identifier} AS TEXT), ${offset}, ${chunkCharacters}) AS chunk
        FROM "Project" WHERE id = ${workId}`);
      if (!row || typeof row.chunk !== 'string' || !row.chunk.length) throw new Error('Missing history chunk');
      chunks.push(row.chunk);
    }
    histories[column] = chunks.join('');
  }
  return { ...project, ...histories };
}
