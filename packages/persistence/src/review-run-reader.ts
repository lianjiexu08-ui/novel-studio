import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { DesignReviewRun } from '../../../novel-service-core/src/design-review-run.ts';

/** SQLite evidence reader. The caller holds a transaction for all chunks.
 * Filter inside SQLite so unrelated reviews and manuscript history never cross
 * the Prisma bridge. Chunk even the selected record to bound native responses. */
export async function readDesignReviewRun(
  tx: Pick<PrismaClient, '$queryRaw'>, workId: string, runId: string,
  chunkCharacters = 8 * 1024 * 1024,
): Promise<DesignReviewRun | undefined> {
  if (!Number.isSafeInteger(chunkCharacters) || chunkCharacters < 2) throw new Error('Invalid review chunk size');
  const selected = Prisma.sql`
    SELECT entry.value AS record FROM "Project" AS project,
      json_each(CASE WHEN json_valid(project."designReviewRuns") THEN
        CASE WHEN json_type(project."designReviewRuns") = 'array' THEN project."designReviewRuns" ELSE '[]' END
        ELSE '[]' END) AS entry
    WHERE project.id = ${workId}
      AND CASE WHEN entry.type = 'object' THEN json_extract(entry.value, '$.id') END = ${runId}
    ORDER BY entry.key DESC LIMIT 1`;
  // Last duplicate wins, matching the existing aggregate's ordered Map load.
  const [size] = await tx.$queryRaw<Array<{ size: bigint | number }>>(Prisma.sql`
    WITH selected AS (${selected}) SELECT length(record) AS size FROM selected`);
  if (!size) return undefined;
  const length = Number(size.size);
  if (!Number.isSafeInteger(length) || length < 1) throw new Error('Invalid review record length');
  const chunks: string[] = [];
  for (let offset = 1; offset <= length; offset += chunkCharacters) {
    const [row] = await tx.$queryRaw<Array<{ chunk: string }>>(Prisma.sql`
      WITH selected AS (${selected}) SELECT substr(record, ${offset}, ${chunkCharacters}) AS chunk FROM selected`);
    if (!row || typeof row.chunk !== 'string' || !row.chunk.length) throw new Error('Missing review record chunk');
    chunks.push(row.chunk);
  }
  return JSON.parse(chunks.join('')) as DesignReviewRun;
}
