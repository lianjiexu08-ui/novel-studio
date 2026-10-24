/** Check only explicit adjacent traditional-hour / clock pairs. This is not a
 * chronology parser: bare hours, ranges and separate events remain for review.
 * 初 / 正 denote the first / second hour; 末 is checked only against the full
 * two-hour window because it does not specify an exact minute.
 */
export function explicitStoryTimeConflicts(text: string): string[] {
  const branches = '子丑寅卯辰巳午未申酉戌亥';
  const conflicts: string[] = [];
  const pairs = /([子丑寅卯辰巳午未申酉戌亥])(初|正|末|时)\s*(?:[（(]\s*)?([01]?\d|2[0-3])[:：]([0-5]\d)(?![\d:：])/gu;
  for (const match of text.matchAll(pairs)) {
    const [, branch, part, hour, minute] = match;
    const start = (branches.indexOf(branch) * 2 + 23) % 24;
    const offset = (Number(hour) * 60 + Number(minute) - start * 60 + 1440) % 1440;
    const lower = part === '正' ? 60 : 0;
    const upper = part === '初' ? 60 : 120;
    if (offset < lower || offset >= upper) {
      const format = (value: number) => String(value % 24).padStart(2, '0') + ':00';
      conflicts.push(`“${match[0]}”的时辰与钟点不一致；按常用时辰换算，${branch}${part}应在 ${format(start + lower / 60)} 至 ${format(start + upper / 60)} 之前，请统一时间标注`);
    }
  }
  return conflicts;
}
