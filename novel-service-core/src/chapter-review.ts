import { createHash } from 'node:crypto';
import type { ChapterCandidate, CheckStatus, RunUsage, Work } from './core.ts';
import type { DesignReviewInput } from './design-review.ts';
import { acceptDesignReviewStage, completeDesignReviewRun, createDesignReviewRun, designReviewStageInput, type DesignReviewStage } from './design-review-run.ts';

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
  stageProof?: ChapterReviewStageProof;
}
export interface ChapterReviewStageProof { inputHash: string; createdAt: string; stages: DesignReviewStage[] }
export interface ChapterReviewProgress {
  createdAt: string;
  completed: number;
  total: number;
  /** Cumulative usage in this provider invocation only; resumes start at zero. */
  usage?: RunUsage;
}
export interface ChapterReviewOptions {
  resume?: ChapterReviewStageProof;
  onStage?: (stage: DesignReviewStage, progress: ChapterReviewProgress) => Promise<void>;
}
export interface ChapterReviewInput {
  inputHash: string;
  candidateId: string;
  chapterNumber: number;
  rubric: typeof chapterReviewRubric;
  sources: Array<{ id: string; text: string }>;
}
export function chapterReviewInputHash(input: Omit<ChapterReviewInput, 'inputHash'>, binding: {
  stateRevision: number; constraintRevision: number; planId?: string; candidatePlanId?: string;
}): string {
  return createHash('sha256').update(JSON.stringify({ version: 1, candidateId: input.candidateId, chapterNumber: input.chapterNumber,
    stateRevision: binding.stateRevision, constraintRevision: binding.constraintRevision, planId: binding.planId,
    candidatePlanId: binding.candidatePlanId, sources: input.sources, rubric: input.rubric })).digest('hex');
}
export interface ChapterReviewRecord {
  inputHash: string;
  /** Exact reviewed material, retained with completed checks for later manuscript verification. */
  input?: ChapterReviewInput;
  /** A newer request owns the current review; retain this response only as history. */
  superseded?: boolean;
  result?: ChapterReviewResult;
  error?: string;
  usage?: RunUsage;
  stage?: DesignReviewStage;
  progress?: ChapterReviewProgress;
}
export class ChapterReviewError extends Error {}

export function chapterReviewDesignInput(input: ChapterReviewInput): DesignReviewInput {
  const document = (id: string): Record<string, unknown> => {
    try { const value = JSON.parse(input.sources.find(s => s.id === id)?.text ?? 'null'); return value && typeof value === 'object' ? value : {}; }
    catch { return {}; }
  };
  const world = document('world'), bible = document('bible'), plan = document('plan');
  return { purpose: 'chapter_review', area: 'story', inputHash: input.inputHash,
    // No design acceptance is recorded; the chapter hash also binds candidate and facts.
    scope: { worldPackRevision: Number(world.revision ?? 0), storyBibleRevision: Number(bible.revision ?? 0),
      planRevisionId: typeof plan.id === 'string' ? plan.id : 'unplanned', planRevision: Number(plan.revision ?? 0) },
    rubric: input.rubric, sources: input.sources };
}

/** Restore only valid completed stages on the canonically rebuilt schedule. */
export function restoreChapterReviewRun(input: ChapterReviewInput, proof?: ChapterReviewStageProof) {
  if (proof && (proof.inputHash !== input.inputHash || !Array.isArray(proof.stages) || typeof proof.createdAt !== 'string')) {
    throw new ChapterReviewError('正文评审检查点不属于当前材料');
  }
  const run = createDesignReviewRun(chapterReviewDesignInput(input), proof?.createdAt);
  const seen = new Set<string>();
  for (const stored of proof?.stages ?? []) {
    if (seen.has(stored.id)) throw new ChapterReviewError('正文评审检查点包含重复步骤');
    seen.add(stored.id);
    const next = run.stages.find(s => !s.result);
    if (!next || next.id !== stored.id || next.kind !== stored.kind || JSON.stringify(next.unitIds) !== JSON.stringify(stored.unitIds)
      || JSON.stringify(next.children) !== JSON.stringify(stored.children) || next.followupFor !== stored.followupFor) {
      throw new ChapterReviewError('正文评审检查点与原文覆盖计划不一致');
    }
    if (stored.result) {
      validateChapterReviewStage(run, next, stored.result);
      acceptDesignReviewStage(run, next, stored.result);
    }
    Object.assign(next, structuredClone(stored));
    if (!stored.result && stored !== proof!.stages.at(-1)) throw new ChapterReviewError('正文评审不能跳过失败步骤');
  }
  return run;
}

export function validateChapterReviewStage(run: ReturnType<typeof createDesignReviewRun>, stage: DesignReviewStage, result: NonNullable<DesignReviewStage['result']>) {
  const local = designReviewStageInput(run, stage);
  validateChapterStageEvidence(local, result);
}

export function validateChapterStageEvidence(local: DesignReviewInput, result: NonNullable<DesignReviewStage['result']>) {
  if (local.stage?.kind === 'synthesis') return;
  const draftIds = local.stage!.sourceMap.filter(s => s.sourceId === 'draft').map(s => s.id);
  for (const check of result.checks) if (check.verdict !== 'insufficient'
    && !check.evidence.some(e => draftIds.includes(e.sourceId))) {
    throw new ChapterReviewError('正文原文批次通过或返修必须引用共享 draft，不能只评设定');
  }
}

export function completedChapterReview(input: ChapterReviewInput, proof: ChapterReviewStageProof): ChapterReviewResult {
  const run = restoreChapterReviewRun(input, proof);
  const completed = completeDesignReviewRun(run);
  const result: ChapterReviewResult = { inputHash: input.inputHash, summary: completed.result.summary,
    checks: completed.result.checks as ChapterReviewResult['checks'], stageProof: proof };
  // A collection of locally passing reports still needs the expected rule/brief evidence.
  for (const [criterion, family] of Object.entries({ characters: 'bible', power: 'world', obligations: 'brief', continuity: 'bible' })) {
    if (result.checks.find(c => c.criterion === criterion)?.verdict !== 'pass') continue;
    const supported = run.stages.filter(s => s.kind !== 'synthesis').some(s => s.result!.checks.some(c => c.criterion === criterion && c.verdict === 'pass'
      && c.evidence.some(e => run.units.some(u => u.id === e.sourceId && !['null', '[]', '{}'].includes(input.sources.find(source => source.id === u.sourceId)!.text)
        && (u.sourceId === family || criterion === 'continuity' && (u.sourceId === 'facts' || u.sourceId.startsWith('chapter:')))))));
    if (!supported) throw new ChapterReviewError(`${criterion} 缺少原文规则或任务卡依据，不能合成通过`);
  }
  return result;
}

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
  const input = { candidateId: candidate.id, chapterNumber: candidate.chapterNumber, sources, rubric: chapterReviewRubric };
  return { ...input, inputHash: chapterReviewInputHash(input, {
    stateRevision: work.stateRevision, constraintRevision: work.constraintRevision, planId: work.activePlanId,
    candidatePlanId: candidate.planRevisionId,
  }) };
}

export function validateChapterReview(value: unknown, input: ChapterReviewInput): ChapterReviewResult {
  const record = value as ChapterReviewResult | null;
  if (record?.stageProof) {
    const verified = completedChapterReview(input, record.stageProof);
    if (record.inputHash !== verified.inputHash || record.summary !== verified.summary || JSON.stringify(record.checks) !== JSON.stringify(verified.checks)) {
      throw new ChapterReviewError('正文综合结果与完整原文检查记录不一致');
    }
    return verified;
  }
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
