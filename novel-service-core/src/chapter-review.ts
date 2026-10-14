import { createHash } from 'node:crypto';
import type { ChapterCandidate, CheckStatus, RunUsage, Work } from './core.ts';

export const chapterReviewChecker = 'chapter_content_review';
export const chapterReviewRubric = {
  causality: '目标、阻碍、行动、转折、结果之间有因果；解决困境不能凭空补条件。',
  characters: '选择符合人物利益、关系阶段与已知信息；不能全知、强行降智或无理由转变。',
  power: '境界、功法、法宝、肉身与普通机关遵守限制；具体动作的负载、代价、资源余额与反制成立。',
  continuity: '地点、时间、伤势、物品和已发生事件连续；过去事实不能重置、重复兑现或被计划覆盖。',
  obligations: '正文实际完成本章任务卡的 mustDo 与 endState；遵守 mustNotHappen、前置及伏笔揭示时机。',
  prose: '冲突与人物行动写成具体场景，节奏、转折、信息密度和结尾有阅读价值；无重复灌水或提纲式总结。',
} as const;
export type ChapterReviewCriterion = keyof typeof chapterReviewRubric;
export interface ChapterReviewResult {
  inputHash: string;
  summary: string;
  checks: Array<{ criterion: ChapterReviewCriterion; verdict: 'pass' | 'revise' | 'insufficient'; explanation: string;
    evidence: Array<{ sourceId: string; quote: string }>; revisionAdvice: string }>;
  usage?: RunUsage;
}
export interface ChapterReviewInput {
  inputHash: string;
  candidateId: string;
  chapterNumber: number;
  rubric: typeof chapterReviewRubric;
  sources: Array<{ id: string; text: string }>;
}
export interface ChapterReviewRecord {
  inputHash: string;
  result?: ChapterReviewResult;
  error?: string;
  usage?: RunUsage;
}
export class ChapterReviewError extends Error {}

/** Full sources, never silent truncation. Capacity overflow is a failed review attempt. */
export function chapterReviewInput(work: Work, candidate: ChapterCandidate): ChapterReviewInput {
  const json = (value: unknown) => JSON.stringify(value ?? null);
  const prior = work.adoptedVersions().filter(v => !v.stale && v.chapterNumber < candidate.chapterNumber)
    .sort((a, b) => a.chapterNumber - b.chapterNumber).slice(-8);
  const facts = [...work.events.values()].filter(e => e.active && e.chapterNumber < candidate.chapterNumber)
    .sort((a, b) => a.chapterNumber - b.chapterNumber || a.id.localeCompare(b.id));
  const sources = [
    { id: 'draft', text: candidate.content },
    { id: 'covenant', text: json(work.covenant) },
    { id: 'world', text: json(work.worldPack) },
    { id: 'bible', text: json(work.storyBible) },
    { id: 'plan', text: json(work.activePlanId ? work.plans.get(work.activePlanId) : null) },
    { id: 'brief', text: json(candidate.brief) },
    { id: 'facts', text: json(facts) },
    { id: 'proposed_events', text: json(candidate.proposedEvents) },
    { id: 'observed_events', text: json(candidate.observedEvents) },
    ...prior.map(v => ({ id: `chapter:${v.id}`, text: v.content })),
  ];
  const binding = { version: 1, candidateId: candidate.id, chapterNumber: candidate.chapterNumber,
    stateRevision: work.stateRevision, constraintRevision: work.constraintRevision, planId: work.activePlanId,
    candidatePlanId: candidate.planRevisionId, sources, rubric: chapterReviewRubric };
  return { candidateId: candidate.id, chapterNumber: candidate.chapterNumber, sources, rubric: chapterReviewRubric,
    inputHash: createHash('sha256').update(json(binding)).digest('hex') };
}

export function validateChapterReview(value: unknown, input: ChapterReviewInput): ChapterReviewResult {
  const record = value as ChapterReviewResult | null;
  const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  if (!record || record.inputHash !== input.inputHash || !text(record.summary) || !Array.isArray(record.checks)) {
    throw new ChapterReviewError('正文评审缺少正确 inputHash、summary 或 checks');
  }
  const expected = Object.keys(chapterReviewRubric);
  if (record.checks.length !== expected.length || new Set(record.checks.map(c => c?.criterion)).size !== expected.length) {
    throw new ChapterReviewError('正文评审必须完整且不重复地检查六个维度');
  }
  for (const check of record.checks) {
    if (!check || !expected.includes(check.criterion) || !['pass', 'revise', 'insufficient'].includes(check.verdict)
      || !text(check.explanation) || typeof check.revisionAdvice !== 'string' || !Array.isArray(check.evidence)) {
      throw new ChapterReviewError('正文评审检查项格式不合规');
    }
    if (check.verdict !== 'pass' && !text(check.revisionAdvice)) throw new ChapterReviewError('返修或不足必须说明下一步');
    if (check.evidence.length > 12) throw new ChapterReviewError('每项最多十二条必要引文');
    for (const citation of check.evidence) {
      const source = input.sources.find(s => s.id === citation?.sourceId);
      if (!source || typeof citation.quote !== 'string' || citation.quote.trim().length < 4 || citation.quote.length > 2000
        || !source.text.includes(citation.quote)) throw new ChapterReviewError('正文评审引文必须是指定来源中至少四字的连续原文');
    }
    if (check.verdict !== 'insufficient' && !check.evidence.some(e => e.sourceId === 'draft')) {
      throw new ChapterReviewError('通过或返修必须引用候选正文');
    }
    const requiredSources: Partial<Record<ChapterReviewCriterion, string[]>> = {
      characters: ['bible'], power: ['world'], obligations: ['brief'],
      continuity: ['facts', 'bible', ...input.sources.filter(s => s.id.startsWith('chapter:')).map(s => s.id)],
    };
    if (check.verdict === 'pass' && requiredSources[check.criterion]
      && !check.evidence.some(e => requiredSources[check.criterion]!.includes(e.sourceId)
        && !['null', '[]', '{}'].includes(input.sources.find(s => s.id === e.sourceId)!.text))) {
      throw new ChapterReviewError(`${check.criterion} 通过必须引用对应的有效材料：${requiredSources[check.criterion]!.join(', ')}`);
    }
  }
  // Usage is trusted only when supplied by the provider's transport wrapper.
  return { inputHash: record.inputHash, summary: record.summary, checks: record.checks };
}

export function chapterReviewStatus(result: ChapterReviewResult): CheckStatus {
  return result.checks.some(c => c.verdict === 'revise') ? 'failed'
    : result.checks.some(c => c.verdict === 'insufficient') ? 'inconclusive' : 'passed';
}
