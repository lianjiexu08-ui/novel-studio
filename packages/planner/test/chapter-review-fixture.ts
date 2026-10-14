import assert from 'node:assert/strict';

/** Citation-only model double: tests execution/provenance, never literary quality. */
export function passingStageOutput(request: { user: string }, reviseFirstPower = false) {
  const input = JSON.parse(request.user);
  assert.equal(input.task, 'review_chapter_stage', input.problems);
  const families = new Set<string>();
  const fragments = input.sources.flatMap((s: { id: string; origin?: { sourceId: string }; fragments: Array<{ id: string; text: string }> }) => {
    const key = s.origin?.sourceId ?? s.id;
    if (families.has(key)) return [];
    families.add(key);
    return s.fragments.filter(f => f.text.trim().length >= 4).slice(0, 1);
  });
  return JSON.stringify({ requestId: input.requestId, summary: '测试批次完成', checks: Object.keys(input.rubric).map(criterion => ({
    criterion, verdict: reviseFirstPower && criterion === 'power' ? 'revise' : 'pass', explanation: '测试逐批证据',
    evidence: fragments.map((f: { id: string }) => ({ fragmentId: f.id })), revisionAdvice: reviseFirstPower ? '保留原始力量问题' : '',
  })) });
}
