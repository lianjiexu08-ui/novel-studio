import { createHash, randomUUID } from 'node:crypto';
import { maxDesignReviewAwaitingSources, maxDesignReviewEvidence } from '../../packages/contracts/src/index.ts';
import type { Work } from './core.ts';
import type { DesignReviewAnnotationDto } from 'novel-studio-contracts';

export const designReviewAreas = ['world', 'power', 'characters', 'story'] as const;
export type DesignReviewArea = typeof designReviewAreas[number];
export const designReviewRubrics: Record<DesignReviewArea, Record<string, string>> = {
  world: {
    geography: '大陆、地点与势力的资源来源、利益冲突、跨域通行条件是否能支撑分卷，而非换地图重复打怪。先核对本批计划实际写出的每次跨域移动和受限地点进入：从哪里到哪里、实际采用何种交通或能力、谁有资格操作、依据什么取得准入，以及对应的时间、支付和供能是否与世界原文相容；再判断地域差异与分卷作用。不能只复述世界规定的标准航程或计划标题，而忽略同一条计划中的具体动作；实际动作优先接受核验，正确的标题、总日数、票款或结局不能抵消其中未获授权的能力、未经许可的入境或省略的实体行程。已给原文的明确冲突必须revise，并引用规则与冲突行动；未读到必要依据才请求补读，不能以其他材料不足掩盖已证冲突。',
    history: '历史的原因、代价和后果能否解释现状，势力是否会独立行动',
    capacity: '世界的差异性、规则和扩展空间是否匹配目标篇幅，不能以条目数量替代复杂度',
  },
  power: {
    tiers: '境界、功法、法宝、资源的分级和使用门槛是否一致，角色起点与规划的晋阶是否合理。区分作者明示的开篇前已学技能、书内新增学习和仅有境界资格：初始技能可由人物或章纲的作者设定说明，不要求每个配角都在正文从零训练，也不要求用新采纳事件倒填前史；但仍须核对具体技能是否满足规则的训练、实测、对象和使用限制，不能把身份或境界本身当作自动掌握。',
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
    timeline: '晋阶、跨陆、战斗、重建需要的时间是否合理，分卷边界和章纲是否统一。先按人物或队伍分别列清出发地、出发日、途中行动、目的地和抵达日，区分并行路线、插叙所述时间与叙述章节；同一人先离营、数日后抵港本身不是日期冲突，不同队伍同日在不同地点也不矛盾。应指出同一人物在不相容的时空重叠、行程不足、抵达早于出发或消息未送达却已知等实际冲突，并引用对应两端的原文；未读到中间路线时先按现有来源目录补读，不能靠混淆出发与抵达制造矛盾。',
    payoff: '伏笔、秘密、承诺和开放线是否有铺垫、兑现条件、代价与明确归宿',
    opening: '前五十章的冲突、人物选择和后果是否递进，高潮分布是否合理，有无过早终局或重复模板',
    pacing: '逐段检查戏剧目标与阅读节奏：相邻章节是否带来新的危机、发现、关系变化或有意义的喘息，还是反复用核账、问询、训练记录或相同救援结构推进。必要执行账是作者依据，不要求逐条写成场景；但把账移到另一字段不能替代真正的场次重构。相似行动只有在困境、选择或后果实质变化时才构成递进。用具体章节说明问题，不能机械要求每章打斗或升级。',
    genre: '依据作者题材和偏好检查世界体验与成长吸引力。玄幻的地域、修炼、奇异事物和探索应实际影响观察、选择、风险或回报，不能只给普通程序事件贴境界、符箓或货号标签。低阶限制、职业经验与有代价的胜利也可产生满足感；不能以免费升级、新万能法宝或越阶胜利补救吸引力。指出实际成立的场景或最需重构的段落，不把条目数量、账目闭合当成文学质量。',
    growth: '单独核对主角的近期成长承诺，不以世界规则合理或出现玄幻术语替代：在已提供的开篇和阶段计划里，主角具体想学会或改变什么、为何主动选择这条路、下一步能做什么、需要何种条件与代价、读者可以期待什么可观察的阶段回报？区分明确目标、获得学习条件、实际训练与已兑现能力，远期高阶秘术或反复说明不能使用不等于近期成长路径。依据已提供的作者题材和节奏偏好判断，引用作者实际说明的偏好；没有说明时，不得自行假定作者偏好慢热，也不能用这一假定为长期延后成长回报开脱。若作者明确选择慢热，仍需说明当前阶段可观察的推进。目标也可体现为知识、判断、关系或职业能力；不强求固定章数突破，不为制造回报放宽伤势、授业、资源、寿储或权限。用具体场景证明路径已进入人物选择；只有泛泛愿望或规则说明时指出需补强的行动，尚未读到相关计划则请求补读。此项只评估设计支撑力，不宣称已验证正文文笔或真实读者喜好。',
  },
};

export interface DesignReviewSource { id: string; text: string }
export interface DesignReviewInput {
  /** Reuse coverage/provenance machinery without treating prose as a design proposal. */
  purpose?: 'chapter_review';
  area: DesignReviewArea;
  inputHash: string;
  scope: { worldPackRevision: number; storyBibleRevision: number; planRevisionId: string; planRevision: number };
  sources: DesignReviewSource[];
  /** Immutable editorial context captured for a new assessment, never story evidence. */
  annotationContext?: { version: 1; sha256: string; notes: DesignReviewAnnotationDto[] };
  rubric: Record<string, string>;
  stage?: {
    kind: 'batch' | 'cross' | 'synthesis'; label: string; totalBatches: number;
    followupFor?: string;
    reconsiderationFor?: string;
    reconsiderationKind?: 'source_navigation';
    /** v33: finite source navigation after a dedicated follow-up; never approval. */
    followupBudget?: { remainingRounds: number };
    /** v16 gives required new sources, original evidence and the question room together. */
    evidenceLimit?: 96;
    /** v17 checks the expanded report envelope during the model repair loop. */
    reportBudget?: { sourceId: string; maxCharacters: number };
    /** v18 model outputs must classify ordinary local insufficiency explicitly. */
    requireInsufficiencyReason?: true;
    sourceMap: Array<{ id: string; sourceId: string; start: number; end: number }>;
    coverage?: {
      mode: 'whole_input' | 'local_sources' | 'reports_with_context';
      /** Complete inventory of this area's input, not evidence of source contents. */
      sourceLengths: Record<string, number>;
      /** Navigation only: names copied from structured sources, never evidence. */
      sourceNames?: Record<string, string>;
      /** v26: explicit relationship endpoints for navigation, never state or evidence. */
      sourceRelationships?: Record<string, { fromCharacterId: string; toCharacterId: string; fromName?: string; toName?: string; kind?: string }>;
      /** v31: explicit chapter cast and uniquely identified profiles; navigation only.
       * A listed character is not proof of action, knowledge or physical presence. */
      chapterCast?: {
        chapters: Array<{ sourceId: string; chapterNumber: number; characterIds: string[] }>;
        characters: Record<string, { sourceId: string; name?: string }>;
      };
      chapterCastOmitted?: 'capacity';
      /** v32: verbatim declared story times, not inferred dates or proof of events. */
      chapterTimes?: Array<{ sourceId: string; chapterNumber: number; storyTime: string }>;
      chapterTimesOmitted?: 'capacity';
      /** Exact name/ID mentions in plans and (v19+) profiles; never prove mastery or use. */
      entityMentions?: Record<string, string[]>;
      /** Optional navigation is omitted whole if it cannot fit; raw sources are never removed. */
      entityMentionsOmitted?: 'capacity';
      /** Complete raw context candidates added to a follow-up, or omitted for capacity. */
      relatedSourceContext?: { includedSourceIds: string[]; omittedSourceIds: string[] };
      /** v30: complete macro plan sources actually delivered to this raw step;
       * incomplete sources still need reading, and neither list proves quality. */
      macroPlanContext?: { includedSourceIds: string[]; incompleteSourceIds: string[] };
      /** Report-tree coverage, not proof that any design criterion passed. */
      synthesis?: {
        scope: 'partial_reports' | 'complete_reports'; coveredStageIds: string[]; totalStages: number;
        /** v27: unresolved judgments in delivered child reports, not story facts. */
        requiredFindings?: Array<{ stageId: string; criterion: string; verdict: 'revise' | 'insufficient' }>;
      };
      /** Navigation only: ranges stated by existing plan sources, never evidence. */
      planRanges?: Array<{ sourceId: string; startChapter: number; endChapter: number; title?: string }>;
      pendingChecks?: Array<{ id: string; criterion: string; questionSourceId: string; requiredSourceIds: string[]; priorUnitIds: string[]; priorSourceIds?: string[] }>;
      resolvedDeferrals?: Array<{ checkId: string; resolvedByStageId: string; kind?: 'reconsideration' }>;
      sourceNavigationReconsidered?: true;
    };
  };
}
export interface DesignReviewCheck {
  criterion: string;
  verdict: 'pass' | 'revise' | 'insufficient';
  explanation: string;
  evidence: Array<{ sourceId: string; quote: string }>;
  revisionAdvice: string;
  /** Local uncertainty caused only by unread sources present in the inventory. */
  awaitingSources?: string[];
  /** A real design gap, unlocatable evidence, or a bounded review capacity gap. */
  insufficiencyReason?: 'missing_design' | 'unlocatable_sources' | 'capacity_limit';
  /** Explicit, evidenced disposition of an earlier local uncertainty. */
  resolves?: string[];
}
export interface DesignReviewResult { resolvedReconsiderations?: Array<{ checkId: string; resolvedByStageId: string; kind: 'reconsideration' }>; summary: string; checks: DesignReviewCheck[]; modelResponses?: string[]; resolvedDeferrals?: Array<{ checkId: string; resolvedByStageId: string; kind?: 'reconsideration' }> }
export interface DesignContentReview extends DesignReviewResult {
  id: string;
  area: DesignReviewArea;
  inputHash: string;
  scope: DesignReviewInput['scope'];
  status: 'passed' | 'needs_revision' | 'inconclusive';
  /** Exact materials sent to the reviewer; never presented as adopted story facts. */
  sources: DesignReviewSource[];
  createdAt: string;
  runId?: string;
}
export class DesignReviewError extends Error {}
export interface DesignReviewInsufficiencyFieldProblem {
  criterion: string;
  checkIndex: number;
  issues: Array<'non_insufficient_verdict' | 'conflicts_with_awaiting_sources' | 'invalid_reason'>;
}
export class DesignReviewInsufficiencyFieldsError extends DesignReviewError {
  readonly fieldProblems: DesignReviewInsufficiencyFieldProblem[];
  constructor(problems: DesignReviewInsufficiencyFieldProblem[]) {
    const labels = {
      non_insufficient_verdict: '普通不足原因只用于 insufficient，不能用于通过或返修',
      conflicts_with_awaiting_sources: '普通不足原因 insufficiencyReason 与 awaitingSources 不能同时出现',
      invalid_reason: '普通不足原因只接受 missing_design、unlocatable_sources、capacity_limit；解释文字应放在 explanation',
    };
    super(problems.map(p => `checks[${p.checkIndex}]（${p.criterion}）：${p.issues.map(issue => labels[issue]).join('；')}`).join('\n'));
    this.fieldProblems = structuredClone(problems);
  }
}
/** Diagnose optional-field conflicts before schema parsing, without repairing
 * or accepting the response. The full schema and evidence checks still run. */
export function validateDesignReviewInsufficiencyFields(value: unknown): void {
  if (!value || typeof value !== 'object' || !('checks' in value) || !Array.isArray(value.checks)) return;
  const fieldProblems: DesignReviewInsufficiencyFieldProblem[] = [];
  for (const [checkIndex, check] of value.checks.entries()) {
    if (!check || typeof check !== 'object' || typeof check.criterion !== 'string'
      || !['pass', 'revise', 'insufficient'].includes(check.verdict) || check.insufficiencyReason === undefined) continue;
    const issues: DesignReviewInsufficiencyFieldProblem['issues'] = [];
    if (check.verdict !== 'insufficient') issues.push('non_insufficient_verdict');
    if (check.awaitingSources !== undefined) issues.push('conflicts_with_awaiting_sources');
    if (!['missing_design', 'unlocatable_sources', 'capacity_limit'].includes(check.insufficiencyReason)) issues.push('invalid_reason');
    if (issues.length) fieldProblems.push({ criterion: check.criterion, checkIndex, issues });
  }
  if (fieldProblems.length) throw new DesignReviewInsufficiencyFieldsError(fieldProblems);
}
export class DesignReviewCriteriaError extends DesignReviewError {
  readonly expectedCriteria: string[];
  readonly receivedCriteria: string[];
  readonly missingCriteria: string[];
  readonly duplicateCriteria: string[];
  readonly unexpectedCriteria: string[];
  constructor(expectedCriteria: string[], receivedCriteria: string[]) {
    const missing = expectedCriteria.filter(key => !receivedCriteria.includes(key));
    const duplicates = [...new Set(receivedCriteria.filter((key, index) => receivedCriteria.indexOf(key) !== index))];
    const unexpected = [...new Set(receivedCriteria.filter(key => !expectedCriteria.includes(key)))];
    super(`内容评审必须逐项覆盖全部标准；预期：${expectedCriteria.join('、')}；实际：${receivedCriteria.join('、') || '无'}；缺少：${missing.join('、') || '无'}；重复：${duplicates.join('、') || '无'}；未知：${unexpected.join('、') || '无'}`);
    this.expectedCriteria = [...expectedCriteria];
    this.receivedCriteria = [...receivedCriteria];
    this.missingCriteria = missing;
    this.duplicateCriteria = duplicates;
    this.unexpectedCriteria = unexpected;
  }
}
export class DesignReviewResolutionEvidenceError extends DesignReviewError {
  readonly problems: string[];
  constructor(problems: string[]) { super(problems.join('\n')); this.problems = problems; }
}

export class DesignReviewAwaitingSourceError extends DesignReviewError {
  readonly invalidSourceId: string;
  readonly availableSourceIds: string[];
  constructor(invalidSourceId: string, availableSourceIds: string[]) {
    super(`等待补读来源不在完整目录中：${invalidSourceId}。必须从sourceLengths选择确实存在且未完整读取的原始来源；没有逐章细纲时核对已有分卷或里程碑，不得推造章节ID。没有可补读来源时保留普通材料不足。`);
    this.invalidSourceId = invalidSourceId;
    this.availableSourceIds = availableSourceIds;
  }
}

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
    // Version 17 grounds growth pacing in actual author preferences. Reviews
    // under the old implicit slow-burn wording remain historical evidence only.
    rubricVersion: 17, title: work.title, covenant: work.covenant,
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
    ? ['powerSystems', 'tierLadders', 'realms', 'techniques', 'artifacts', 'locations', 'factions', 'historicalEvents', 'resources', 'terminology'] as const
    : area === 'power'
      ? ['powerSystems', 'tierLadders', 'realms', 'techniques', 'artifacts', 'resources'] as const
      : area === 'characters' ? ['factions', 'realms'] as const : ['locations', 'realms', 'techniques', 'artifacts', 'resources'] as const;
  for (const key of groups) group(`world/${key}`, world[key]);
  add('story/overview', { coreConflict: bible.coreConflict, endingDirection: bible.endingDirection, unresolvedQuestions: bible.unresolvedQuestions });
  for (const key of ['characters', 'relationships', 'arcs', 'arcBeats', 'secrets', 'promises', 'openThreads', 'volumes'] as const) group(`story/${key}`, bible[key]);
  group('story/chapterPlans', bible.chapterPlans);
  const outlinedChapterNumbers = [...new Set(plan.plan.chapters.map(chapter => chapter.chapterNumber))].sort((a, b) => a - b);
  const outlined = new Set(outlinedChapterNumbers);
  let detailedThroughChapter = 0;
  while (outlined.has(detailedThroughChapter + 1)) detailedThroughChapter++;
  add('plan/overview', {
    targetChapterCount: plan.plan.targetChapterCount, volumeCount: plan.plan.volumeCount,
    detailedThroughChapter, outlinedChapterNumbers,
    mainConflict: plan.plan.mainConflict, theme: plan.plan.theme, protagonistArc: plan.plan.protagonistArc,
    endingDirection: plan.plan.endingDirection, keyTurns: plan.plan.keyTurns,
    openQuestions: plan.plan.openQuestions, dependencies: plan.plan.dependencies,
  });
  group('plan/volumes', plan.plan.volumes);
  group('plan/milestones', plan.plan.milestones);
  // All currently outlined chapters are reviewed. Never truncate a large design silently.
  for (const chapter of plan.plan.chapters) add(`plan/chapters/${chapter.chapterNumber}`, chapter);
  group('settings/characters', [...work.characters.values()]);
  group('settings/relationships', [...work.relationships.values()]);
  group('settings/worldRules', [...work.worldRules.values()]);
  group('settings/plotNodes', [...work.plotNodes.values()]);
  return { area, inputHash, scope: { worldPackRevision: world.revision, storyBibleRevision: bible.revision, planRevisionId: plan.id, planRevision: plan.revision }, sources, rubric: designReviewRubrics[area] };
}

export function designReviewEvidenceLimit(input: DesignReviewInput): number {
  // Historical staged requests retain their old bound and schedule.
  return input.stage ? input.stage.evidenceLimit ?? 64 : maxDesignReviewEvidence;
}

/** A model cannot invent citations or omit a difficult criterion to pass. */
export function validateDesignReview(input: DesignReviewInput, result: DesignReviewResult): void {
  const criteria = Object.keys(input.rubric);
  const citationProblems: DesignReviewCitationProblem[] = [];
  const resolutionProblems: string[] = [];
  if (!result.summary?.trim()) throw new DesignReviewError('内容评审必须提供结论摘要');
  const received = Array.isArray(result.checks) ? result.checks.map(check => check.criterion) : [];
  if (!Array.isArray(result.checks) || received.length !== criteria.length || new Set(received).size !== criteria.length || received.some(key => !criteria.includes(key))) throw new DesignReviewCriteriaError(criteria, received);
  validateDesignReviewInsufficiencyFields(result);
  for (const check of result.checks) {
    if (!criteria.includes(check.criterion) || !['pass', 'revise', 'insufficient'].includes(check.verdict) || !check.explanation?.trim() || !Array.isArray(check.evidence)) throw new DesignReviewError('内容评审结果不完整');
    if (check.evidence.length > designReviewEvidenceLimit(input)) throw new DesignReviewError(`本批每项证据不得超过${designReviewEvidenceLimit(input)}条，不能省略必引来源来凑数`);
    if (check.verdict !== 'insufficient' && check.evidence.length === 0) throw new DesignReviewError('通过或返修结论必须提供原文证据');
    if (check.verdict !== 'pass' && !check.revisionAdvice?.trim()) throw new DesignReviewError('未通过项目必须给出补充或返修要求');
    if (input.stage?.reconsiderationFor && check.verdict === 'pass' && !check.resolves?.includes(input.stage.reconsiderationFor)) throw new DesignReviewError('正式复核通过必须显式 resolves 原问题并提供全部必引证据');
    if (check.awaitingSources !== undefined) {
      if (input.stage?.reconsiderationFor) throw new DesignReviewError('正式复核不能递归请求补读；仍缺材料时保留普通不足和原返修');
      if (input.stage?.followupFor && !(Number.isSafeInteger(input.stage.followupBudget?.remainingRounds) && input.stage.followupBudget!.remainingRounds > 0)) throw new DesignReviewError('专门补读不得递归建立等待；仍缺必要材料时保留普通材料不足');
      const coverage = input.stage?.coverage;
      if (check.verdict !== 'insufficient' || input.stage?.kind === 'synthesis' || coverage?.mode !== 'local_sources' || !Array.isArray(check.awaitingSources) || !check.awaitingSources.length || check.awaitingSources.length > maxDesignReviewAwaitingSources || new Set(check.awaitingSources).size !== check.awaitingSources.length) throw new DesignReviewError(`等待补读只能用于局部材料不足，并指定1至${maxDesignReviewAwaitingSources}个不同的未读来源`);
      for (const sourceId of check.awaitingSources) {
        if (!Object.hasOwn(coverage.sourceLengths, sourceId)) throw new DesignReviewAwaitingSourceError(sourceId, Object.keys(coverage.sourceLengths));
        const ranges = input.stage!.sourceMap.filter(u => u.sourceId === sourceId);
        if (ranges.length && ranges.reduce((sum, u) => sum + u.end - u.start, 0) === coverage.sourceLengths[sourceId]) throw new DesignReviewError(`等待补读来源已完整提供：${sourceId}`);
      }
    }
    if (check.resolves !== undefined) {
      if (check.verdict !== 'pass' || input.stage?.kind === 'synthesis' || !Array.isArray(check.resolves) || !check.resolves.length || new Set(check.resolves).size !== check.resolves.length) throw new DesignReviewError('仅原文复核的通过结论可以明确解决等待补读项');
      for (const checkId of check.resolves) {
        const pending = input.stage?.coverage?.pendingChecks?.find(p => p.id === checkId && p.criterion === check.criterion);
        if (!pending) throw new DesignReviewError(`没有符合本批覆盖范围的待补读项：${checkId}`);
        const cited = new Set(check.evidence.map(e => e.sourceId));
        const missing = [
          ...(!cited.has(pending.questionSourceId) ? [`原问题 ${pending.questionSourceId}`] : []),
          ...(!pending.priorUnitIds.some(id => cited.has(id)) ? ['原批材料（至少一个实际支持判断的原批片段）'] : []),
          ...pending.requiredSourceIds.filter(id => !input.stage!.sourceMap.some(u => u.sourceId === id && cited.has(u.id))).map(id => `新增来源 ${id}`),
        ];
        if (missing.length) resolutionProblems.push(`解决待补读项必须引用原问题、原批材料及每个新增来源：${checkId}；缺少：${missing.join('、')}。按本次来源目录选择真实支持片段，不得自动补引文或只删除resolves来掩盖未核验问题。`);
        const missingPrior = pending.priorSourceIds?.filter(id => !input.stage!.sourceMap.some(u => u.sourceId === id && cited.has(u.id))) ?? [];
        if (missingPrior.length) resolutionProblems.push(`专门补读必须引用原问题所依据的每个原始来源：${checkId}；缺少来源：${missingPrior.join('、')}。请按sourceMap对应本次来源选择支持判断的片段，不需穷举其全部片段。`);
      }
    }
    for (const [evidenceIndex, evidence] of check.evidence.entries()) {
      const source = input.sources.find((item) => item.id === evidence.sourceId);
      if (!source || !evidence.quote?.trim() || evidence.quote.trim().length < 4 || !source.text.includes(evidence.quote)) citationProblems.push({
        criterion: check.criterion, evidenceIndex, sourceId: evidence.sourceId, rejectedQuote: evidence.quote, sourceText: source?.text,
        matchingSourceIds: evidence.quote?.trim().length >= 4 ? input.sources.filter((item) => item.text.includes(evidence.quote)).map((item) => item.id) : [],
      });
    }
  }
  if (resolutionProblems.length) throw new DesignReviewResolutionEvidenceError(resolutionProblems);
  if (citationProblems.length) throw new DesignReviewCitationError(citationProblems);
  if (input.stage?.kind === 'synthesis') {
    const rank = { pass: 0, insufficient: 1, revise: 2 };
    const weakened = (input.stage.coverage?.synthesis?.requiredFindings ?? []).filter(finding =>
      rank[result.checks.find(check => check.criterion === finding.criterion)!.verdict] < rank[finding.verdict]);
    if (weakened.length) throw new DesignReviewError(`综合结论不得弱化尚未解决的前置判断：${weakened.map(finding => `${finding.stageId}/${finding.criterion}=${finding.verdict}`).join('、')}。保留原问题及本次报告证据；可说明争议，但不能凭其他项通过将本项改判通过或把返修降为不足。`);
  }
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
    const run = [...work.designReviewRuns.values()].filter(run => run.input.area === area && run.input.inputHash === hash).at(-1);
    if (run && run.status !== 'completed') return { area, status: run.status === 'running' ? 'reviewing' as const : 'interrupted' as const, reportId: current?.id };
    return { area, status: current?.status ?? (latest ? 'outdated' as const : 'missing' as const), reportId: (current ?? latest)?.id };
  });
  return { ready: areas.every((area) => area.status === 'passed'), inputHash: hash, areas, reports, runs: [...work.designReviewRuns.values()].map(run => ({ id: run.id, restartedFromRunId: run.restartedFromRunId, canRestart: run.input.inputHash === hash && !run.leaseToken && ['ready', 'failed'].includes(run.status) && [...work.designReviewRuns.values()].findLast(item => item.input.area === run.input.area && item.input.inputHash === hash)?.id === run.id, area: run.input.area, inputHash: run.input.inputHash, scope: run.input.scope, status: run.input.inputHash === hash ? run.status : 'outdated' as const, createdAt: run.createdAt, updatedAt: run.updatedAt, reportId: run.reportId, leaseExpiresAt: run.leaseExpiresAt, totalSources: run.input.sources.length, totalCharacters: run.input.sources.reduce((n, s) => n + s.text.length, 0), stages: run.stages.map(({ id, kind, label, result, attempts, error }) => ({ id, kind, label, completed: Boolean(result), verdict: result ? result.checks.some(c => c.verdict === 'revise') ? 'needs_revision' as const : result.checks.some(c => c.verdict === 'insufficient') ? 'inconclusive' as const : 'passed' as const : undefined, ...(result ? { insufficientCriteria: result.checks.filter(c => c.verdict === 'insufficient').map(c => c.criterion) } : {}), attempts, error })) })) };
}

export function requiresDesignContentReview(work: Work): boolean {
  const plan = work.activePlanId ? work.plans.get(work.activePlanId) : undefined;
  return Math.max(work.covenant.targetChapterCount ?? 0, work.storyBible?.volumes.reduce((sum, volume) => sum + volume.plannedChapterCount, 0) ?? 0, plan?.plan.targetChapterCount ?? 0) >= 100;
}
