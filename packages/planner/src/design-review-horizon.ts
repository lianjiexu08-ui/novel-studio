import type { DesignReviewInput } from '../../../novel-service-core/src/design-review.ts';

/** Navigation only: derive the planning horizon from the complete overview
 * actually supplied to this request, never from a report or a partial slice. */
export function designReviewHorizon(input: DesignReviewInput) {
  const direct = input.sources.find(source => source.id === 'plan/overview');
  const length = input.stage?.coverage?.sourceLengths['plan/overview'];
  const units = input.stage?.sourceMap.filter(unit => unit.sourceId === 'plan/overview').sort((a, b) => a.start - b.start) ?? [];
  let text: string;
  if (units.length) {
    if (!Number.isSafeInteger(length)) return undefined;
    let end = 0;
    const parts: string[] = [];
    for (const unit of units) {
      const source = input.sources.find(source => source.id === unit.id);
      if (!source || unit.start !== end || unit.end <= unit.start || source.text.length !== unit.end - unit.start) return undefined;
      parts.push(source.text); end = unit.end;
    }
    if (end !== length) return undefined;
    text = parts.join('');
  } else {
    if (!direct || length !== undefined && direct.text.length !== length) return undefined;
    text = direct.text;
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { targetChapterCount, detailedThroughChapter, outlinedChapterNumbers } = value as Record<string, unknown>;
  if (typeof targetChapterCount !== 'number' || !Number.isSafeInteger(targetChapterCount) || targetChapterCount < 1
    || typeof detailedThroughChapter !== 'number' || !Number.isSafeInteger(detailedThroughChapter) || detailedThroughChapter < 0
    || !Array.isArray(outlinedChapterNumbers)
    || outlinedChapterNumbers.some(n => typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1 || n > targetChapterCount)
    || new Set(outlinedChapterNumbers).size !== outlinedChapterNumbers.length) return undefined;
  const numbers = [...outlinedChapterNumbers as number[]].sort((a, b) => a - b);
  let through = 0;
  for (const number of numbers) { if (number !== through + 1) break; through = number; }
  if (through !== detailedThroughChapter) return undefined;
  const detailedChapterRanges: Array<{ startChapter: number; endChapter: number }> = [];
  for (const number of numbers) {
    const last = detailedChapterRanges.at(-1);
    if (last?.endChapter === number - 1) last.endChapter = number;
    else detailedChapterRanges.push({ startChapter: number, endChapter: number });
  }
  const undetailedChapterRanges: typeof detailedChapterRanges = [];
  let next = 1;
  for (const range of detailedChapterRanges) {
    if (next < range.startChapter) undetailedChapterRanges.push({ startChapter: next, endChapter: range.startChapter - 1 });
    next = range.endChapter + 1;
  }
  if (next <= targetChapterCount) undetailedChapterRanges.push({ startChapter: next, endChapter: targetChapterCount });
  return { sourceId: 'plan/overview', targetChapterCount, detailedThroughChapter, detailedChapterRanges, undetailedChapterRanges };
}
