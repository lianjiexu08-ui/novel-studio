import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

type Reader = Pick<PrismaClient, 'project' | '$queryRaw'>;
const columns = ['designHistory', 'designContentReviews', 'designReviewRuns', 'designReviewAnnotations', 'covenantHistory'] as const;
const chunkCharacters = 8 * 1024 * 1024;

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
  const histories = {} as Record<typeof columns[number], string>;
  for (const column of columns) {
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
