import { createHash, randomUUID } from 'node:crypto';
import type { Work } from './core.ts';

export const designReviewAreas = ['world', 'power', 'characters', 'story'] as const;
export type DesignReviewArea = typeof designReviewAreas[number];
export const designReviewRubrics: Record<DesignReviewArea, Record<string, string>> = {
  world: {
    geography: '大陆、地点与势力的资源来源、利益冲突、跨域通行条件是否能支撑分卷，而非换地图重复打怪',
    history: '历史的原因、代价和后果能否解释现状，势力是否会独立行动',
    capacity: '世界的差异性、规则和扩展空间是否匹配目标篇幅，不能以条目数量替代复杂度',
  },
  power: {
    tiers: '境界、功法、法宝、资源的分级和使用门槛是否一致，角色起点与规划的晋阶是否合理',
    costs: '力量的来源、消耗、恢复、冷却和不可逆代价是否守恒，资源的使用门槛、剂量、效用及重复使用上限是否明确；疗伤不能自动当成延寿，结局有没有取消核心代价',
    counters: '能力上限、反制和越阶胜利条件是否明确，是否与绝对压制规则矛盾',
  },
  characters: {
    agency: '主角与主要配角是否有独立目标、利益冲突、关键选择、失败代价和对主线的影响',
    relationships: '关系是否有初始状态、促成变化的选择和付出、生效时点，避免用终局关系概括初识',
    knowledge: '秘密、误解和揭示条件是否限制角色认知，人物弧光是否有因果而非仅列节点',
  },
  story: {
    causality: '主线、分卷目标、转折、高潮与收束是否因果相连，避免重复兑现同一法宝或伏笔',
    timeline: '晋阶、跨陆、战斗、重建需要的时间是否合理，分卷边界和章纲是否统一',
    payoff: '伏笔、秘密、承诺和开放线是否有铺垫、兑现条件、代价与明确归宿',
    opening: '前五十章的冲突、人物选择和后果是否递进，高潮分布是否合理，有无过早终局或重复模板',
  },
};

export interface DesignReviewSource { id: string; text: string }
export interface DesignReviewInput {
  area: DesignReviewArea;
  inputHash: string;
  scope: { worldPackRevision: number; storyBibleRevision: number; planRevisionId: string; planRevision: number };
  sources: DesignReviewSource[];
  rubric: Record<string, string>;
}
export interface DesignReviewCheck {
  criterion: string;
  verdict: 'pass' | 'revise' | 'insufficient';
  explanation: string;
  evidence: Array<{ sourceId: string; quote: string }>;
  revisionAdvice: string;
}
export interface DesignReviewResult { summary: string; checks: DesignReviewCheck[] }
export interface DesignContentReview extends DesignReviewResult {
  id: string;
  area: DesignReviewArea;
  inputHash: string;
  scope: DesignReviewInput['scope'];
  status: 'passed' | 'needs_revision' | 'inconclusive';
  /** Exact materials sent to the reviewer; never presented as adopted story facts. */
  sources: DesignReviewSource[];
  createdAt: string;
}
export class DesignReviewError extends Error {}

export interface DesignReviewCitationProblem {
  criterion: string; evidenceIndex: number; sourceId: string; rejectedQuote: string; sourceText?: string;
  /** Exact text matches only; these are suggestions, never automatic citation repairs. */
  matchingSourceIds: string[];
}

export class DesignReviewCitationError extends DesignReviewError {
  readonly citationProblem: DesignReviewCitationProblem;
  readonly citationProblems: DesignReviewCitationProblem[];

  constructor(citationProblems: DesignReviewCitationProblem[]) {
    super(`评审引用不在原文中：${citationProblems.map((problem) => `${problem.sourceId}（${problem.criterion}，证据 ${problem.evidenceIndex + 1}）`).join('；')}`);
    this.citationProblem = citationProblems[0];
    this.citationProblems = citationProblems;
  }
}

/** Status is excluded only for the plan, whose content and id are immutable.
 * Locking a world/bible advances its revision and intentionally requires re-review. */
export function designReviewHash(work: Work, planId?: string): string | undefined {
  const selectedId = planId ?? work.activePlanId;
  const plan = selectedId ? work.plans.get(selectedId) : undefined;
  if (!work.worldPack || !work.storyBible || !plan || plan.status === 'superseded' || (planId === undefined && plan.status !== 'approved')) return undefined;
  return createHash('sha256').update(JSON.stringify({
    rubricVersion: 3, title: work.title, covenant: work.covenant,
    world: work.worldPack, bible: work.storyBible, planId: plan.id, plan: plan.plan,
    characters: [...work.characters.values()].sort((a, b) => a.id.localeCompare(b.id)),
    relationships: [...work.relationships.values()].sort((a, b) => a.id.localeCompare(b.id)),
    worldRules: [...work.worldRules.values()].sort((a, b) => a.id.localeCompare(b.id)),
    ...(work.plotNodes.size ? { plotNodes: [...work.plotNodes.values()].sort((a, b) => a.id.localeCompare(b.id)) } : {}),
  })).digest('hex');
}

export function designReviewInput(work: Work, area: DesignReviewArea, planId?: string): DesignReviewInput {
  const inputHash = designReviewHash(work, planId);
  if (!inputHash) throw new DesignReviewError('先准备世界包、故事圣经及待评审计划；已被替代的计划不能作为当前评审对象');
  const world = work.worldPack!;
  const bible = work.storyBible!;
  const plan = work.plans.get(planId ?? work.activePlanId!)!;
  const sources: DesignReviewSource[] = [];
  const add = (id: string, value: unknown) => { if (value !== undefined) sources.push({ id, text: JSON.stringify(value, null, 2) }); };
  const group = (prefix: string, items: Array<{ id: string }> = []) => items.forEach((item) => add(`${prefix}/${item.id}`, item));
  add('author', { title: work.title, covenant: work.covenant });
  add('world/overview', { title: world.title, summary: world.summary, unresolvedQuestions: world.unresolvedQuestions });
  group('world/axioms', world.axioms);
  const groups = area === 'world'
    ? ['locations', 'factions', 'historicalEvents', 'resources'] as const
    : area === 'power'
      ? ['powerSystems', 'tierLadders', 'realms', 'techniques', 'artifacts', 'resources'] as const
      : area === 'characters' ? ['factions', 'realms'] as const : ['locations', 'realms', 'techniques', 'artifacts', 'resources'] as const;
  for (const key of groups) group(`world/${key}`, world[key]);
  add('story/overview', { coreConflict: bible.coreConflict, endingDirection: bible.endingDirection, unresolvedQuestions: bible.unresolvedQuestions });
  for (const key of ['characters', 'relationships', 'arcs', 'arcBeats', 'secrets', 'promises', 'openThreads', 'volumes'] as const) group(`story/${key}`, bible[key]);
  if (area !== 'world') group('story/chapterPlans', bible.chapterPlans);
  add('plan/overview', { targetChapterCount: plan.plan.targetChapterCount, volumeCount: plan.plan.volumeCount, openQuestions: plan.plan.openQuestions, dependencies: plan.plan.dependencies });
  group('plan/volumes', plan.plan.volumes);
  group('plan/milestones', plan.plan.milestones);
  // All currently outlined chapters are reviewed. Never truncate a large design silently.
  if (area !== 'world') for (const chapter of plan.plan.chapters) add(`plan/chapters/${chapter.chapterNumber}`, chapter);
  group('settings/characters', [...work.characters.values()]);
  group('settings/relationships', [...work.relationships.values()]);
  group('settings/worldRules', [...work.worldRules.values()]);
  group('settings/plotNodes', [...work.plotNodes.values()]);
  if (JSON.stringify(sources).length > 240_000) throw new DesignReviewError('本项材料超出单次评审容量，尚未评审；请分阶段整理设计，不能用截断材料的评审放行');
  return { area, inputHash, scope: { worldPackRevision: world.revision, storyBibleRevision: bible.revision, planRevisionId: plan.id, planRevision: plan.revision }, sources, rubric: designReviewRubrics[area] };
}

/** A model cannot invent citations or omit a difficult criterion to pass. */
export function validateDesignReview(input: DesignReviewInput, result: DesignReviewResult): void {
  const criteria = Object.keys(input.rubric);
  const citationProblems: DesignReviewCitationProblem[] = [];
  if (!result.summary?.trim() || !Array.isArray(result.checks) || result.checks.length !== criteria.length || new Set(result.checks.map((check) => check.criterion)).size !== criteria.length) throw new DesignReviewError('内容评审必须逐项覆盖全部标准');
  for (const check of result.checks) {
    if (!criteria.includes(check.criterion) || !['pass', 'revise', 'insufficient'].includes(check.verdict) || !check.explanation?.trim() || !Array.isArray(check.evidence)) throw new DesignReviewError('内容评审结果不完整');
    if (check.verdict !== 'insufficient' && check.evidence.length === 0) throw new DesignReviewError('通过或返修结论必须提供原文证据');
    if (check.verdict !== 'pass' && !check.revisionAdvice?.trim()) throw new DesignReviewError('未通过项目必须给出补充或返修要求');
    for (const [evidenceIndex, evidence] of check.evidence.entries()) {
      const source = input.sources.find((item) => item.id === evidence.sourceId);
      if (!source || !evidence.quote?.trim() || evidence.quote.trim().length < 4 || !source.text.includes(evidence.quote)) citationProblems.push({
        criterion: check.criterion, evidenceIndex, sourceId: evidence.sourceId, rejectedQuote: evidence.quote, sourceText: source?.text,
        matchingSourceIds: evidence.quote?.trim().length >= 4 ? input.sources.filter((item) => item.text.includes(evidence.quote)).map((item) => item.id) : [],
      });
    }
  }
  if (citationProblems.length) throw new DesignReviewCitationError(citationProblems);
}

export function recordDesignReview(work: Work, input: DesignReviewInput, result: DesignReviewResult): DesignContentReview {
  if (designReviewHash(work, input.scope.planRevisionId) !== input.inputHash) throw new DesignReviewError('评审期间设计或计划已变化，请针对当前版本重新评审');
  validateDesignReview(input, result);
  const record: DesignContentReview = structuredClone({ ...result, id: `design_review_${randomUUID()}`, area: input.area, inputHash: input.inputHash, scope: input.scope, sources: input.sources,
    status: result.checks.some((check) => check.verdict === 'revise') ? 'needs_revision' : result.checks.some((check) => check.verdict === 'insufficient') ? 'inconclusive' : 'passed', createdAt: new Date().toISOString() });
  work.designContentReviews.set(record.id, record);
  // Re-review can discover a blocker: outstanding candidates must be checked again.
  work.constraintRevision += 1;
  return record;
}

export function designReviewOverview(work: Work, planId?: string) {
  const hash = designReviewHash(work, planId);
  const reports = [...work.designContentReviews.values()];
  const areas = designReviewAreas.map((area) => {
    const current = reports.filter((report) => report.area === area && report.inputHash === hash).at(-1);
    const latest = reports.filter((report) => report.area === area).at(-1);
    return { area, status: current?.status ?? (latest ? 'outdated' as const : 'missing' as const), reportId: (current ?? latest)?.id };
  });
  return { ready: areas.every((area) => area.status === 'passed'), inputHash: hash, areas, reports };
}

export function requiresDesignContentReview(work: Work): boolean {
  const plan = work.activePlanId ? work.plans.get(work.activePlanId) : undefined;
  return Math.max(work.covenant.targetChapterCount ?? 0, work.storyBible?.volumes.reduce((sum, volume) => sum + volume.plannedChapterCount, 0) ?? 0, plan?.plan.targetChapterCount ?? 0) >= 100;
}
