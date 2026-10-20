import { createHash, randomUUID } from 'node:crypto';
import { annotationRunSources } from './design-review-annotations.ts';
import { designReviewAnnotationSchema, type DesignReviewAnnotationDto } from 'novel-studio-contracts';
import { maxDesignReviewEvidence } from '../../packages/contracts/src/index.ts';
import { renderDesignReviewReport } from './design-review-report.ts';
import { validateDesignReviewAnnotationContext } from './design-review-annotation-context.ts';
import { designReviewChapterCast, designReviewChapterTimes, designReviewEntityMentions, designReviewPlanCharacters, designReviewPlanNeighbors, designReviewPlanRanges, designReviewSourceNames, designReviewReferencedRules, designReviewSourceRelationships, localDesignReviewRubric } from './design-review-scope.ts';
import { DesignReviewError, validateDesignReview, type DesignReviewInput, type DesignReviewResult, type DesignReviewSource } from './design-review.ts';

export const designReviewCapacity = 240_000;
const batchCapacity = 100_000;
const resultCapacity = 40_000;
// Measured as the exact serialized source envelope sent to synthesis. Two
// 90k reports plus at most 40k planning context stay below the 240k input cap.
const scopedResultSourceCapacity = 90_000;
const sharedContextCapacity = 40_000;
const worldPlanningContextCapacity = 80_000;
const annotationCharacters = (input: DesignReviewInput) => input.annotationContext ? JSON.stringify(input.annotationContext).length : 0;
const sourceCapacity = (input: DesignReviewInput) => designReviewCapacity - annotationCharacters(input);
const reportCapacity = (input: DesignReviewInput) => Math.min(scopedResultSourceCapacity, Math.floor((sourceCapacity(input) - sharedContextCapacity - 1000) / 2));

function worldMacroSources(input: DesignReviewInput): DesignReviewSource[] {
  if (input.purpose === 'chapter_review' || input.area !== 'world') return [];
  if (!input.sources.some(source => source.id === 'plan/overview') || !input.sources.some(source => source.id.startsWith('plan/milestones/'))) return [];
  return input.sources.filter(source => source.id === 'plan/overview' || source.id.startsWith('plan/volumes/') || source.id.startsWith('plan/milestones/'));
}
export interface DesignReviewUnit { id: string; sourceId: string; start: number; end: number }
export interface DesignReviewStage {
  id: string;
  kind: 'batch' | 'cross' | 'synthesis';
  label: string;
  unitIds: string[];
  children: string[];
  /** A bounded raw-source recheck of one unresolved unread-source question. */
  followupFor?: string;
  reconsiderationFor?: string;
  result?: DesignReviewResult;
  attempts: number;
  error?: string;
  modelResponses?: string[];
  rejectedResult?: DesignReviewResult;
  failures?: Array<{ at: string; error: string; modelResponses?: string[]; rejectedResult?: DesignReviewResult }>;
}
export interface DesignReviewReconsideration {
  /** v1 rechecks the complete original batch; v2 locates an unlocatable
   * insufficient question using its complete cited basis and new sources. */
  version: 1 | 2;
  annotation: DesignReviewAnnotationDto;
  additionalSourceIds: string[];
  afterStageId: string;
  createdAt: string;
}
export interface DesignReviewRun {
  id: string;
  /** A deliberate new assessment; the prior run and its findings stay intact. */
  restartedFromRunId?: string;
  /** Absent on persisted legacy schedules, which must resume without reshuffling. */
  scheduleVersion?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34;
  reconsiderations?: DesignReviewReconsideration[];
  input: DesignReviewInput;
  units: DesignReviewUnit[];
  stages: DesignReviewStage[];
  status: 'ready' | 'running' | 'failed' | 'completed' | 'outdated';
  createdAt: string;
  updatedAt: string;
  reportId?: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
}

/** All raw text is retained. Cross checks co-read every pair of partitions;
 * synthesis then combines every finding without allowing a blocker to disappear. */
export function createDesignReviewRun(input: DesignReviewInput, now = new Date().toISOString(), scheduleVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 = input.purpose === 'chapter_review' ? 31 : 34): DesignReviewRun {
  if (!Number.isInteger(scheduleVersion) || scheduleVersion < 1 || scheduleVersion > 34) throw new DesignReviewError('未知评审调度版本');
  if (new Set(input.sources.map(s => s.id)).size !== input.sources.length) throw new DesignReviewError('评审来源 ID 重复');
  validateDesignReviewAnnotationContext(input, true);
  const units: DesignReviewUnit[] = [];
  const stages: DesignReviewStage[] = [];
  const small = JSON.stringify(input.sources).length <= sourceCapacity(input);
  // Two v3 raw batches plus shared context use at most 220k characters,
  // leaving room for the exact questions a cross check must resolve.
  let ordinaryBatchCapacity = scheduleVersion >= 3 ? 90_000 : batchCapacity;
  for (const source of input.sources) {
    let start = 0;
    do {
      let end = small ? source.text.length : Math.min(start + 10_000, source.text.length);
      if (end < source.text.length && /[\uD800-\uDBFF]/.test(source.text[end - 1])) end--;
      units.push({ id: small ? source.id : `review-unit/${units.length + 1}`, sourceId: source.id, start, end });
      start = end;
    } while (start < source.text.length);
  }
  const unitSource = (u: DesignReviewUnit) => ({ id: u.id, text: input.sources.find(s => s.id === u.sourceId)!.text.slice(u.start, u.end) });
  // A late chapter-only batch still needs the actual rules it is judging. Repeat
  // bounded, complete sources; unselected sources remain in the ordinary batches.
  const shared: DesignReviewUnit[] = [];
  if (!small && scheduleVersion >= 2) {
    // A world overview names journeys whose actual payment, transport and
    // permits live in macro plans. Share that complete plan layer as one group;
    // never select just the early milestones or manufacture a shorter summary.
    // If it cannot fit, the original ordinary coverage/follow-ups remain.
    const macroIds = new Set(scheduleVersion >= 30 ? worldMacroSources(input).map(source => source.id) : []);
    const macroUnits = units.filter(unit => unit.sourceId === 'author' || macroIds.has(unit.sourceId));
    const shareMacro = macroIds.size > 0 && JSON.stringify(macroUnits.map(unitSource)).length <= worldPlanningContextCapacity;
    const sharedBudget = shareMacro ? worldPlanningContextCapacity : sharedContextCapacity;
    if (shareMacro) shared.push(...macroUnits);
    const priorities = input.purpose === 'chapter_review' ? ['draft', 'brief', 'covenant', 'proposed_events', 'observed_events'] : input.area === 'power'
      ? ['author', 'plan/overview', 'world/axioms/', 'world/powerSystems/', 'world/tierLadders/', 'world/realms/', 'world/techniques/', 'world/artifacts/', 'world/resources/']
      : input.area === 'characters'
        ? ['author', 'plan/overview', 'world/axioms/', 'story/characters/', 'world/realms/', 'story/overview', 'world/factions/']
        : ['author', 'plan/overview', 'world/axioms/', 'world/realms/', 'world/locations/', 'story/characters/', 'world/techniques/', 'world/artifacts/'];
    for (const prefix of priorities) for (const source of input.sources.filter(s => prefix.endsWith('/') ? s.id.startsWith(prefix) : s.id === prefix)) {
      if (shared.some(unit => unit.sourceId === source.id)) continue;
      const sourceUnits = units.filter(u => u.sourceId === source.id);
      if (JSON.stringify([...shared, ...sourceUnits].map(unitSource)).length <= sharedBudget) shared.push(...sourceUnits);
    }
    if (shareMacro) ordinaryBatchCapacity = Math.min(90_000, Math.floor((220_000 - JSON.stringify(shared.map(unitSource)).length) / 2));
  }
  if (input.annotationContext) ordinaryBatchCapacity = Math.min(ordinaryBatchCapacity,
    Math.floor((220_000 - annotationCharacters(input) - JSON.stringify(shared.map(unitSource)).length) / 2));
  const sharedIds = new Set(shared.map(u => u.id));
  let pending: DesignReviewUnit[] = [];
  const flush = () => { if (pending.length) stages.push({ id: `batch-${stages.length + 1}`, kind: 'batch', label: `原文批次 ${stages.length + 1}`, unitIds: [...shared, ...pending].map(u => u.id), children: [], attempts: 0 }); pending = []; };
  const ordinary = units.filter(u => !sharedIds.has(u.id));
  // A bible summary deliberately omits fields such as the detailed cost ledger.
  // Co-read both versions of a chapter so that omission is not mistaken for a
  // missing plan. Neither source wins: disagreements still need review.
  const groups = scheduleVersion >= 4 ? chapterUnitGroups(input.sources, ordinary) : ordinary.map(unit => [unit]);
  for (const group of groups) {
    if (!small && JSON.stringify(group.map(unitSource)).length > ordinaryBatchCapacity) {
      // Very large chapters still use the bounded slicing and cross checks.
      // Never truncate them or enlarge the request to keep a pair together.
      for (const unit of group) {
        if (JSON.stringify([...pending, unit].map(unitSource)).length > ordinaryBatchCapacity) flush();
        pending.push(unit);
      }
    } else {
      if (!small && JSON.stringify([...pending, ...group].map(unitSource)).length > ordinaryBatchCapacity) flush();
      pending.push(...group);
    }
  }
  flush();
  const batches = [...stages];
  if (batches.length > 64) throw new DesignReviewError('评审需要超过64个原文批次，请先拆分作品验收阶段；原文未截断，尚未调用模型');
  for (let a = 0; a < batches.length; a++) for (let b = a + 1; b < batches.length; b++) {
    stages.push({ id: `cross-${a + 1}-${b + 1}`, kind: 'cross', label: `跨批检查 ${a + 1} / ${b + 1}`, unitIds: [...new Set([...batches[a].unitIds, ...batches[b].unitIds])], children: [], attempts: 0 });
  }
  // Keep the real planning horizon visible during synthesis. A prior report
  // saying "all 100 chapters need detailed scenes" is not the source plan.
  const overviewUnits = scheduleVersion >= 3 ? units.filter(u => input.purpose === 'chapter_review'
    ? ['draft', 'brief', 'covenant'].includes(u.sourceId) : u.sourceId === 'plan/overview') : [];
  const synthesisContext = JSON.stringify(overviewUnits.map(unitSource)).length <= sharedContextCapacity ? overviewUnits : [];
  let level = stages.map(s => s.id);
  let sequence = 0;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) { next.push(level[i]); continue; }
      const id = `synthesis-${++sequence}`;
      stages.push({ id, kind: 'synthesis', label: `综合检查 ${sequence}`, unitIds: synthesisContext.map(u => u.id), children: level.slice(i, i + 2), attempts: 0 }); next.push(id);
    }
    level = next;
  }
  return { id: `design_run_${randomUUID()}`, ...(scheduleVersion >= 2 ? { scheduleVersion: scheduleVersion as 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 } : {}), input: structuredClone(input), units, stages, status: 'ready', createdAt: now, updatedAt: now };
}

/** Append a bounded formal recheck without changing any earlier request or result.
 * A note is a challenge to investigate, never evidence that a verdict is wrong. */
export function queueDesignReviewReconsideration(run: DesignReviewRun, annotation: DesignReviewAnnotationDto,
  additionalSourceIds: string[] = [], now = new Date().toISOString()): DesignReviewStage {
  designReviewAnnotationSchema.parse(annotation);
  annotationRunSources(run, annotation);
  if (JSON.stringify(annotation.scope) !== JSON.stringify(run.input.scope)) throw new DesignReviewError('复核记录范围不匹配');
  if (!Array.isArray(additionalSourceIds) || additionalSourceIds.some(id => typeof id !== 'string') || new Set(additionalSourceIds).size !== additionalSourceIds.length) throw new DesignReviewError('复核来源列表无效或重复');
  const prior = run.reconsiderations?.find(item => item.annotation.id === annotation.id);
  if (prior) {
    if (JSON.stringify(prior.annotation) !== JSON.stringify(annotation) || JSON.stringify(prior.additionalSourceIds) !== JSON.stringify(additionalSourceIds)) throw new DesignReviewError('复核请求已绑定其他内容');
    const stage = run.stages.find(stage => stage.id === `reconsider-${annotation.id}`);
    if (!stage) throw new DesignReviewError('复核步骤缺失');
    return stage;
  }
  if ((run.scheduleVersion ?? 1) < 34 || run.input.purpose === 'chapter_review') throw new DesignReviewError('当前任务版本不支持定向设计复核');
  if (run.leaseToken || !['ready', 'failed'].includes(run.status)) throw new DesignReviewError('请先停止评审并释放执行权，再提交正式复核');
  const target = run.stages.find(stage => stage.id === annotation.stageId)!;
  const check = target.result!.checks.find(check => check.criterion === annotation.criterion)!;
  const checkId = `${target.id}/${check.criterion}`;
  const version = check.verdict === 'insufficient' && check.insufficiencyReason === 'unlocatable_sources' && !check.awaitingSources?.length ? 2 : 1;
  if (target.kind === 'synthesis' || target.reconsiderationFor || version === 1 && check.verdict !== 'revise') throw new DesignReviewError('仅支持原文返修或无法定位来源的不足判定提交正式复核');
  if (run.reconsiderations?.some(item => `${item.annotation.stageId}/${item.annotation.criterion}` === checkId)) throw new DesignReviewError('该判定已有正式复核，请继续已有步骤');
  if (run.stages.some(stage => stage.reconsiderationFor && !stage.result)) throw new DesignReviewError('请先完成已加入的正式复核');
  const boundary = run.stages.findIndex(stage => !stage.result);
  if (boundary < 1 || run.stages.slice(boundary).some(stage => stage.result || stage.attempts || stage.failures?.length)
    || run.stages.some(stage => stage.kind === 'synthesis' && (stage.result || stage.attempts))) throw new DesignReviewError('只能在连续已完成原文批次之后、未尝试的后续步骤之前加入复核');
  // Complete every source touched by the original batch, not just quoted units.
  const basis = reconsiderationBasis(run, target, check, version);
  const required = new Set([...basis,
    ...annotation.evidence.map(item => item.sourceId), ...additionalSourceIds]);
  if (version === 2 && ![...required].some(id => !target.unitIds.some(unitId => run.units.find(unit => unit.id === unitId)!.sourceId === id))) throw new DesignReviewError('来源定位复核必须提供原批未读到的真实来源');
  for (const id of required) if (!run.input.sources.some(source => source.id === id)) throw new DesignReviewError(`复核来源不存在：${id}`);
  const binding: DesignReviewReconsideration = { version, annotation: structuredClone(annotation), additionalSourceIds: [...additionalSourceIds], afterStageId: run.stages[boundary - 1].id, createdAt: now };
  const stage: DesignReviewStage = { id: `reconsider-${annotation.id}`, kind: 'cross', label: `正式复核 ${checkId}`, unitIds: run.units.filter(unit => required.has(unit.sourceId)).map(unit => unit.id), children: [], reconsiderationFor: checkId, attempts: 0 };
  // Preflight on a detached copy: capacity/validation failures are atomic even
  // for callers without a database transaction.
  const proposed = structuredClone(run);
  (proposed.reconsiderations ??= []).push(binding);
  proposed.stages.splice(boundary, 0, stage);
  rebuildSynthesis(proposed);
  const input = designReviewStageInput(proposed, stage);
  const pending = input.stage!.coverage!.pendingChecks!.find(item => item.id === checkId)!;
  if (new Set([...pending.requiredSourceIds, ...(pending.priorSourceIds ?? [])]).size + 1 > maxDesignReviewEvidence) throw new DesignReviewError('正式复核必引依据超过引用容量，未截断来源');
  run.reconsiderations = proposed.reconsiderations;
  run.stages = proposed.stages;
  run.status = 'ready'; run.updatedAt = now;
  return run.stages.find(item => item.id === stage.id)!;
}

function reconsiderationBasis(run: DesignReviewRun, stage: DesignReviewStage, check: DesignReviewResult['checks'][number], version: 1 | 2): string[] {
  if (version === 1) {
    if (check.verdict !== 'revise') throw new DesignReviewError('旧版正式复核只支持原返修');
    return [...new Set(stage.unitIds.map(id => run.units.find(unit => unit.id === id)!.sourceId))];
  }
  if (version !== 2 || check.verdict !== 'insufficient' || check.insufficiencyReason !== 'unlocatable_sources' || check.awaitingSources?.length) throw new DesignReviewError('来源定位复核只支持没有补读列表的无法定位判定');
  const ids = check.evidence.map(evidence => {
    const unit = run.units.find(unit => unit.id === evidence.sourceId && stage.unitIds.includes(unit.id));
    if (!unit) throw new DesignReviewError('来源定位复核必须保留原判定全部原文依据');
    return unit.sourceId;
  });
  if (!ids.length) throw new DesignReviewError('来源定位复核缺少原文依据');
  return [...new Set(ids)];
}

function rebuildSynthesis(run: DesignReviewRun): void {
  const context = run.stages.find(stage => stage.kind === 'synthesis')?.unitIds ?? [];
  const raw = run.stages.filter(stage => stage.kind !== 'synthesis');
  const stages = [...raw];
  let level = raw.map(stage => stage.id), sequence = 0;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) { next.push(level[i]); continue; }
      const id = `synthesis-${++sequence}`;
      stages.push({ id, kind: 'synthesis', label: `综合检查 ${sequence}`, unitIds: [...context], children: level.slice(i, i + 2), attempts: 0 }); next.push(id);
    }
    level = next;
  }
  run.stages = stages;
}

function chapterUnitGroups(sources: DesignReviewSource[], units: DesignReviewUnit[]): DesignReviewUnit[][] {
  const chapters = new Map<number, { kinds: Set<string>; sourceIds: string[] }>();
  for (const source of sources) {
    const kind = source.id.startsWith('story/chapterPlans/') ? 'bible' : source.id.startsWith('plan/chapters/') ? 'plan' : undefined;
    if (!kind) continue;
    let chapterNumber: unknown;
    try { chapterNumber = JSON.parse(source.text)?.chapterNumber; } catch { continue; }
    if (typeof chapterNumber !== 'number' || !Number.isSafeInteger(chapterNumber) || chapterNumber < 1) continue;
    const chapter = chapters.get(chapterNumber) ?? { kinds: new Set<string>(), sourceIds: [] };
    chapter.kinds.add(kind); chapter.sourceIds.push(source.id); chapters.set(chapterNumber, chapter);
  }
  const paired = new Map<string, number>();
  for (const [number, chapter] of chapters) if (chapter.kinds.size === 2) for (const id of chapter.sourceIds) paired.set(id, number);
  const grouped = new Map<number, DesignReviewUnit[]>();
  for (const unit of units) {
    const number = paired.get(unit.sourceId);
    if (number !== undefined) { const group = grouped.get(number) ?? []; group.push(unit); grouped.set(number, group); }
  }
  const emitted = new Set<number>();
  return units.flatMap(unit => {
    const number = paired.get(unit.sourceId);
    if (number === undefined) return [[unit]];
    if (emitted.has(number)) return [];
    emitted.add(number); return [grouped.get(number)!];
  });
}

export function designReviewUnitSources(run: DesignReviewRun): DesignReviewSource[] {
  return run.units.map(u => ({ id: u.id, text: run.input.sources.find(s => s.id === u.sourceId)!.text.slice(u.start, u.end) }));
}
// A cache belongs to one synchronous, read-only evaluation of one run. Never
// retain it on the mutable run or reuse it after accepting a stage.
interface ReviewReadCache {
  reports: Map<string, DesignReviewSource>;
  followupUnits: Map<string, string[] | undefined>;
  resolutionContexts: Map<string, DesignReviewSource>;
  entityMentions?: Record<string, string[]>;
}
const reviewReadCache = (): ReviewReadCache => ({ reports: new Map(), followupUnits: new Map(), resolutionContexts: new Map() });
function entityMentions(run: DesignReviewRun, cache: ReviewReadCache) {
  return cache.entityMentions ??= designReviewEntityMentions(run.input, (run.scheduleVersion ?? 1) >= 19);
}
function resultSource(run: DesignReviewRun, stage: DesignReviewStage, cache = reviewReadCache()): DesignReviewSource {
  const cached = cache.reports.get(stage.id);
  if (cached) return cached;
  const resolutions = Object.fromEntries(((run.scheduleVersion ?? 1) >= 12 ? resolvedDeferrals(run, run.stages.length, cache).filter(r => r.checkId.startsWith(`${stage.id}/`)) : []).map(r => {
    const resolver = run.stages.find(s => s.id === r.resolvedByStageId)!;
    // The note describes an already evidenced raw review, never a synthesis
    // vote or an unvalidated claim. Keep the original finding intact below it.
    validateDesignReview(readDesignReviewStageInput(run, resolver, cache), resolver.result!);
    const criterion = r.checkId.slice(stage.id.length + 1);
    const check = resolver.result!.checks.find(c => c.criterion === criterion)!;
    return [criterion, { ...r, explanation: check.explanation }];
  }));
  const text = (run.scheduleVersion ?? 1) < 6 ? JSON.stringify(stage.result, null, 2) : renderDesignReviewReport(stage.result!, id => {
    const unit = run.units.find(u => u.id === id);
    if (unit) return { sourceId: unit.sourceId, unitId: unit.id, start: unit.start, text: run.input.sources.find(s => s.id === unit.sourceId)!.text.slice(unit.start, unit.end) };
    // Reports may only refer to earlier stages. This also prevents a corrupt
    // stored citation from recursing back into its own report.
    const index = run.stages.findIndex(s => s.id === stage.id);
    const prior = run.stages.slice(0, index).find(s => `review-result/${s.id}` === id && s.result);
    if (prior) return { sourceId: id, text: resultSource(run, prior, cache).text };
    if ((run.scheduleVersion ?? 1) >= 29 && id.startsWith('review-resolutions/')) {
      const context = readResolutionContext(run, index, cache);
      if (context?.id === id) return { sourceId: id, text: context.text };
    }
    const question = deferrals(run, index).find(p => p.question.id === id)?.question;
    return question ? { sourceId: question.id, text: question.text } : undefined;
  }, resolutions);
  const source = { id: `review-result/${stage.id}`, text };
  cache.reports.set(stage.id, source);
  return source;
}
function deferrals(run: DesignReviewRun, before = run.stages.length) {
  const deferred = run.stages.slice(0, before).flatMap(stage => stage.kind === 'synthesis' || stage.followupFor && (run.scheduleVersion ?? 1) < 33 ? [] : (stage.result?.checks ?? []).filter(check => check.verdict === 'insufficient' && check.awaitingSources?.length).map(check => ({
    id: `${stage.id}/${check.criterion}`, stage, check, reconsideration: false,
    question: { id: `review-question/${stage.id}/${check.criterion}`, text: JSON.stringify({ criterion: check.criterion, explanation: check.explanation, revisionAdvice: check.revisionAdvice, awaitingSources: check.awaitingSources }, null, 2) },
  })));
  const challenged = (run.reconsiderations ?? []).flatMap(binding => {
    const stage = run.stages.slice(0, before).find(stage => stage.id === binding.annotation.stageId);
    const check = stage?.result?.checks.find(check => check.criterion === binding.annotation.criterion);
    if (!stage || !check) return [];
    reconsiderationBasis(run, stage, check, binding.version);
    return [{ id: `${stage.id}/${check.criterion}`, stage, check, reconsideration: true,
      question: { id: `review-question/${stage.id}/${check.criterion}`, text: JSON.stringify({ originalCheck: check,
        challenge: binding.annotation, notice: binding.version === 2 ? '核对说明只定位可能的未读来源，不是事实或通过依据；须复核原标准整项不足、完整原引用依据与补充原文，仍缺条件时继续保留不足，发现冲突须返修。' : '核对说明是待检验意见，不是故事事实或通过依据；请复核原标准整项返修，不能只核对所选句子。' }, null, 2) } }];
  });
  return [...deferred, ...challenged];
}
// Three dedicated reads per original question. Old schedules never use this
// chain; every original negative and every later navigation request is retained.
const maxFollowupRounds = 3;
function pendingChain(run: DesignReviewRun, pending: ReturnType<typeof deferrals>[number]) {
  const all = deferrals(run), chain = [pending], seen = new Set([pending.id]);
  let parentId = pending.stage.followupFor;
  while (parentId) {
    const parent = all.find(item => item.id === parentId);
    if (!parent || seen.has(parent.id)) throw new DesignReviewError('补读来源链缺失或循环');
    chain.push(parent); seen.add(parent.id); parentId = parent.stage.followupFor;
  }
  return chain;
}
function citedSourceIds(run: DesignReviewRun, pending: ReturnType<typeof deferrals>[number]): string[] {
  return [...new Set(pending.check.evidence.flatMap(e => {
    const unit = run.units.find(u => u.id === e.sourceId && pending.stage.unitIds.includes(u.id));
    return unit ? [unit.sourceId] : [];
  }))];
}
function coversDeferral(run: DesignReviewRun, stage: DesignReviewStage, pending: ReturnType<typeof deferrals>[number], cache = reviewReadCache()) {
  if (stage.reconsiderationFor || pending.reconsideration) {
    if (stage.reconsiderationFor !== pending.id) return false;
    const binding = run.reconsiderations?.find(item => `reconsider-${item.annotation.id}` === stage.id);
    if (!binding) return false;
    const required = new Set([...reconsiderationBasis(run, pending.stage, pending.check, binding.version), ...binding.annotation.evidence.map(item => item.sourceId), ...binding.additionalSourceIds]);
    return run.units.filter(unit => required.has(unit.sourceId)).every(unit => stage.unitIds.includes(unit.id));
  }

  if (stage.followupFor && (run.scheduleVersion ?? 1) >= 33) {
    const direct = deferrals(run).find(item => item.id === stage.followupFor);
    if (!direct || !pendingChain(run, direct).some(item => item.id === pending.id)) return false;
    const required = new Set([...citedSourceIds(run, pending), ...pending.check.awaitingSources!]);
    return run.units.filter(u => required.has(u.sourceId)).every(u => stage.unitIds.includes(u.id));
  }
  if (stage.followupFor) return (run.scheduleVersion ?? 1) >= 5 && stage.followupFor === pending.id
    && followupUnits(run, pending, cache)?.every(id => stage.unitIds.includes(id)) === true;
  if (stage.kind !== 'synthesis' && (run.scheduleVersion ?? 1) >= 34) {
    // An ordinary later raw check can read the full cited basis and requested
    // sources without also repeating unrelated material from the old partition.
    // Expose the question; resolution still requires an explicit pass and all
    // basis citations. With no original raw evidence, keep the full-batch rule.
    const cited = citedSourceIds(run, pending);
    if (cited.length) {
      const required = new Set([...cited, ...pending.check.awaitingSources!]);
      return run.units.filter(u => required.has(u.sourceId)).every(u => stage.unitIds.includes(u.id));
    }
  }
  return stage.kind !== 'synthesis' && [...pending.stage.unitIds, ...run.units.filter(u => pending.check.awaitingSources!.includes(u.sourceId)).map(u => u.id)].every(id => stage.unitIds.includes(id));
}

/** Prefer the entire original batch. When it cannot fit, re-read complete
 * sources for its cited evidence plus every requested source and shared rules.
 * Never turn a partial quotation or an inventory entry into source coverage. */
function followupUnits(run: DesignReviewRun, pending: ReturnType<typeof deferrals>[number], cache = reviewReadCache()): string[] | undefined {
  if (!cache.followupUnits.has(pending.id)) cache.followupUnits.set(pending.id, computeFollowupUnits(run, pending, cache));
  return cache.followupUnits.get(pending.id);
}
function computeFollowupUnits(run: DesignReviewRun, pending: ReturnType<typeof deferrals>[number], cache: ReviewReadCache): string[] | undefined {
  const sources = designReviewUnitSources(run);
  const chain = (run.scheduleVersion ?? 1) >= 33 ? pendingChain(run, pending) : [pending];
  const requested = [...new Set(chain.flatMap(item => item.check.awaitingSources!))];
  const required = run.units.filter(u => requested.includes(u.sourceId)).map(u => u.id);
  const cited = new Set(chain.flatMap(item => citedSourceIds(run, item)));
  // One citation per original/requested source and one for the question must
  // be expressible without violating the result contract.
  const citationLimit = (run.scheduleVersion ?? 1) >= 16 ? maxDesignReviewEvidence : 64;
  if (new Set([...cited, ...requested]).size + chain.length > citationLimit) return undefined;
  const fits = (ids: string[]) => JSON.stringify([...sources.filter(s => ids.includes(s.id)), ...chain.map(item => item.question)]).length <= sourceCapacity(run.input);
  const citedUnits = run.units.filter(u => cited.has(u.sourceId)).map(u => u.id);
  const full = [...new Set([...pending.stage.unitIds, ...citedUnits, ...required])];
  const batches = run.stages.filter(s => s.kind === 'batch');
  const common = run.units.filter(u => batches.every(b => b.unitIds.includes(u.id))).map(u => u.sourceId);
  const sourceIds = new Set([...cited, ...common, 'plan/overview', ...requested]);
  const focused = run.units.filter(u => sourceIds.has(u.sourceId)).map(u => u.id);
  if ((run.scheduleVersion ?? 1) >= 14) {
    // A reviewer can ask only for a technique's rule while also questioning
    // its acquisition/training. Supply complete candidate plans/profiles too;
    // mentioning it is not proof of mastery and does not resolve the question.
    const related = relatedFollowupSources(run, pending, cache);
    const relatedUnits = run.units.filter(u => related.includes(u.sourceId)).map(u => u.id);
    if (relatedUnits.length) {
      const supplemented = [...new Set([...full, ...relatedUnits])];
      if (fits(supplemented)) return supplemented;
      const focusedSupplemented = [...new Set([...focused, ...relatedUnits])];
      if (cited.size && fits(focusedSupplemented)) return focusedSupplemented;
    }
  }
  // Optional context never evicts mandatory sources or truncates a source.
  // If the entire related set cannot fit, retain the original bounded check.
  if (fits(full)) return full;
  return cited.size && fits(focused) ? focused : undefined;
}

function relatedFollowupSources(run: DesignReviewRun, pending: ReturnType<typeof deferrals>[number], cache: ReviewReadCache): string[] {
  const mentions = entityMentions(run, cache);
  const requested = pending.check.awaitingSources!;
  // v21 adds only direct dependencies of explicitly requested planning nodes.
  // These optional complete sources use the same capacity/omission rules as
  // skill context; existing schedules and mandatory evidence stay unchanged.
  const planNeighbors = (run.scheduleVersion ?? 1) >= 21 ? designReviewPlanNeighbors(run.input, requested) : [];
  // v22 carries the explicitly requested/cited chapters' cast profiles too.
  // This closes a rule-only navigation gap for basic operations defined in
  // axioms, while preserving complete-source capacity and omission handling.
  const cited = pending.check.evidence.flatMap(e => {
    const unit = run.units.find(u => u.id === e.sourceId && pending.stage.unitIds.includes(u.id));
    return unit ? [unit.sourceId] : [];
  });
  const characters = (run.scheduleVersion ?? 1) >= 22
    ? designReviewPlanCharacters(run.input, [...requested, ...cited]) : [];
  // v28 follows only direct rule references in requested/cited sources and
  // original shared context. Optional neighbors do not seed another expansion.
  const batches = run.stages.filter(stage => stage.kind === 'batch');
  const shared = run.units.filter(unit => pending.stage.unitIds.includes(unit.id)
    && batches.every(batch => batch.unitIds.includes(unit.id))).map(unit => unit.sourceId);
  const rules = (run.scheduleVersion ?? 1) >= 28
    ? designReviewReferencedRules(run.input, [...requested, ...cited, ...shared]) : [];
  return [...new Set([...requested.flatMap(id => mentions[id] ?? []), ...planNeighbors, ...characters, ...rules])];
}

/** Freeze additional checks after all original raw checks finish, before any
 * synthesis. Their content is derived from immutable questions and citations;
 * questions too large to co-read remain unresolved, never truncated. */
function scheduleFollowups(run: DesignReviewRun): void {
  if ((run.scheduleVersion ?? 1) < 5) return;
  const raw = run.stages.filter(s => s.kind !== 'synthesis' && !s.followupFor);
  const chained = (run.scheduleVersion ?? 1) >= 33;
  const retained = chained ? run.stages.filter(s => s.kind !== 'synthesis') : raw;
  if (retained.some(s => !s.result) || run.stages.some(s => (!chained && s.followupFor) || s.kind === 'synthesis' && s.result)) return;
  const cache = reviewReadCache();
  const resolved = new Set(resolvedDeferrals(run, run.stages.length, cache).map(r => r.checkId));
  const followups: DesignReviewStage[] = [];
  for (const pending of deferrals(run)) {
    if (pending.reconsideration || resolved.has(pending.id)) continue;
    if (chained && (run.stages.some(s => s.followupFor === pending.id) || pendingChain(run, pending).length > maxFollowupRounds)) continue;
    const unitIds = followupUnits(run, pending, cache);
    if (unitIds) followups.push({ id: `followup-${pending.id}`, kind: 'cross', label: `原文补读 ${pending.id}`, unitIds, children: [], followupFor: pending.id, attempts: 0 });
  }
  if (!followups.length) return;
  const context = run.stages.find(s => s.kind === 'synthesis')?.unitIds ?? [];
  let level = [...retained, ...followups].map(s => s.id);
  const synthesis: DesignReviewStage[] = [];
  let sequence = 0;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) { next.push(level[i]); continue; }
      const id = `synthesis-${++sequence}`;
      synthesis.push({ id, kind: 'synthesis', label: `综合检查 ${sequence}`, unitIds: [...context], children: level.slice(i, i + 2), attempts: 0 });
      next.push(id);
    }
    level = next;
  }
  run.stages.splice(retained.length, run.stages.length - retained.length, ...followups, ...synthesis);
}
function resolvedDeferrals(run: DesignReviewRun, before = run.stages.length, cache = reviewReadCache()) {
  return deferrals(run, before).flatMap(pending => {
    const resolver = run.stages.slice(run.stages.indexOf(pending.stage) + 1, before).find(stage => coversDeferral(run, stage, pending, cache) && stage.result?.checks.some(check => check.criterion === pending.check.criterion && check.verdict === 'pass' && check.resolves?.includes(pending.id)));
    return resolver ? [{ checkId: pending.id, resolvedByStageId: resolver.id, ...(pending.reconsideration ? { kind: 'reconsideration' as const } : {}) }] : [];
  });
}

/** Quotable review history, not additional story facts or an approval override.
 * The same validated records are available even when the resolver is on a
 * different synthesis branch from a quoted historical insufficient judgment. */
export function designReviewResolutionContext(run: DesignReviewRun, before = run.stages.length): DesignReviewSource | undefined {
  if (!Number.isSafeInteger(before) || before < 0 || before > run.stages.length) throw new DesignReviewError('补读处理记录范围无效');
  return readResolutionContext(run, before, reviewReadCache());
}
function readResolutionContext(run: DesignReviewRun, before: number, cache: ReviewReadCache): DesignReviewSource | undefined {
  const resolutions = resolvedDeferrals(run, before, cache);
  if (!resolutions.length) return undefined;
  const key = JSON.stringify(resolutions);
  const cached = cache.resolutionContexts.get(key);
  if (cached) return cached;
  const pending = deferrals(run, before);
  const records = resolutions.map(resolution => {
    const original = pending.find(item => item.id === resolution.checkId)!;
    const resolver = run.stages.find(stage => stage.id === resolution.resolvedByStageId)!;
    // Never turn an unvalidated resolves claim into authoritative context.
    validateDesignReview(readDesignReviewStageInput(run, original.stage, cache), original.stage.result!);
    validateDesignReview(readDesignReviewStageInput(run, resolver, cache), resolver.result!);
    const check = resolver.result!.checks.find(check => check.criterion === original.check.criterion)!;
    return {
      ...resolution, criterion: original.check.criterion, disposition: 'resolved_by_raw_review',
      originalQuestion: original.check.explanation, requestedSources: original.check.awaitingSources,
      resolutionExplanation: check.explanation,
      resolutionEvidenceCount: check.evidence.length,
      resolutionEvidenceSha256: createHash('sha256').update(JSON.stringify(check.evidence)).digest('hex'),
    };
  });
  const reconsidered = resolutions.some(item => item.kind === 'reconsideration');
  const navigation = resolutions.some(item => item.kind === 'reconsideration' && pending.find(p => p.id === item.checkId)?.check.verdict === 'insufficient');
  const text = (navigation ? '含来源定位正式复核：原unlocatable_sources不足经原问题、全部原引用来源及补充原文重读和必引证据验证后已解决；原判定仍保留，其他问题不受影响。\n' : reconsidered ? '含正式复核处理记录：kind=reconsideration 表示原revise经完整原文重读和必引证据验证后已解决；原判定仍保留为历史，其他问题不受影响。\n' : '') + '已校验的补读处理记录。每项均由覆盖原问题及必要原文的后续评审明确解决，并已通过引用验证。报告中仍保留的对应旧insufficient及原问题引文是历史，不因复核位于另一综合分支就重新变成未解决。\n'
    + '本记录只证明所列等待有有效处理；不证明全文设计通过，不取消其他返修、普通不足或新发现的冲突，也不代表正文事件已发生。新冲突仍须依据实际交付的原文或报告说明，不得凭此记录自动通过。\n'
    + JSON.stringify({ inputHash: run.input.inputHash, resolvedDeferrals: records }, null, 2);
  const source = { id: `review-resolutions/${createHash('sha256').update(text).digest('hex')}`, text };
  cache.resolutionContexts.set(key, source);
  return source;
}
function synthesisCoverage(run: DesignReviewRun, stage: DesignReviewStage) {
  const indexed = new Map(run.stages.map((item, index) => [item.id, { item, index }]));
  const covered = new Set<string>();
  const visited = new Set<string>();
  function visit(current: DesignReviewStage): void {
    if (visited.has(current.id)) return;
    visited.add(current.id);
    if (current.kind !== 'synthesis') { covered.add(current.id); return; }
    for (const id of current.children) {
      const child = indexed.get(id);
      if (!child || child.index >= indexed.get(current.id)!.index) throw new DesignReviewError('综合报告依赖必须指向此前步骤');
      visit(child.item);
    }
  }
  visit(stage);
  const raw = run.stages.filter(item => item.kind !== 'synthesis');
  const coveredStageIds = raw.filter(item => covered.has(item.id)).map(item => item.id);
  return { scope: coveredStageIds.length === raw.length ? 'complete_reports' as const : 'partial_reports' as const, coveredStageIds, totalStages: raw.length };
}

export function designReviewStageInput(run: DesignReviewRun, stage: DesignReviewStage): DesignReviewInput {
  validateDesignReviewAnnotationContext(run.input, true);
  return readDesignReviewStageInput(run, stage, reviewReadCache());
}
function readDesignReviewStageInput(run: DesignReviewRun, stage: DesignReviewStage, cache: ReviewReadCache): DesignReviewInput {
  const stageIndex = run.stages.findIndex(s => s.id === stage.id);
  if (stageIndex < 0) throw new DesignReviewError('评审步骤不属于本任务');
  if (stage.reconsiderationFor) {
    const binding = run.reconsiderations?.find(item => `reconsider-${item.annotation.id}` === stage.id);
    if (!binding || ![1, 2].includes(binding.version)) throw new DesignReviewError('正式复核绑定缺失或版本无效');
    annotationRunSources(run, binding.annotation);
    if (binding.additionalSourceIds.some(id => !run.input.sources.some(source => source.id === id))) throw new DesignReviewError('正式复核新增来源不存在');
  }
  const reconsideration = stage.reconsiderationFor ? deferrals(run, stageIndex).find(item => item.id === stage.reconsiderationFor) : undefined;
  if (stage.reconsiderationFor && (!reconsideration || !coversDeferral(run, stage, reconsideration, cache))) throw new DesignReviewError('正式复核缺少完整原文或绑定的返修判定');
  const followup = stage.followupFor ? deferrals(run, stageIndex).find(p => p.id === stage.followupFor) : undefined;
  if (stage.followupFor && ((run.scheduleVersion ?? 1) < 5 || !followup)) throw new DesignReviewError('补读步骤没有原始等待问题');
  const rawSources = designReviewUnitSources(run).filter(s => stage.unitIds.includes(s.id));
  const sources = stage.kind === 'synthesis' ? [...stage.children.map(id => {
    const child = run.stages.find(s => s.id === id);
    if (!child?.result) throw new DesignReviewError('前置批次尚未完成');
    return resultSource(run, child, cache);
  }), ...rawSources] : rawSources;
  if ((run.scheduleVersion ?? 1) >= 29 && stage.kind === 'synthesis') {
    const context = readResolutionContext(run, stageIndex, cache);
    if (context) sources.push(context);
  }
  if (JSON.stringify(sources).length > sourceCapacity(run.input)) throw new DesignReviewError('本批材料与核对说明超出单次评审容量；未截断原文');
  const coverage: NonNullable<DesignReviewInput['stage']>['coverage'] = (run.scheduleVersion ?? 1) >= 3 ? {
    mode: stage.kind === 'synthesis' ? 'reports_with_context' : run.units.every(u => stage.unitIds.includes(u.id)) ? 'whole_input' : 'local_sources',
    sourceLengths: Object.fromEntries(run.input.sources.map(s => [s.id, s.text.length])),
    ...((run.scheduleVersion ?? 1) >= 10 ? { sourceNames: designReviewSourceNames(run.input) } : {}),
    ...((run.scheduleVersion ?? 1) >= 26 ? { sourceRelationships: designReviewSourceRelationships(run.input) } : {}),
    ...((run.scheduleVersion ?? 1) >= 9 ? { planRanges: designReviewPlanRanges(run.input) } : {}),
  } : undefined;
  if (coverage && stage.kind !== 'synthesis') {
    if ((run.scheduleVersion ?? 1) >= 30) {
      const macroSources = worldMacroSources(run.input);
      if (macroSources.length) {
        const includedSourceIds = macroSources.filter(source => run.units.filter(unit => unit.sourceId === source.id).every(unit => stage.unitIds.includes(unit.id))).map(source => source.id);
        coverage.macroPlanContext = { includedSourceIds, incompleteSourceIds: macroSources.filter(source => !includedSourceIds.includes(source.id)).map(source => source.id) };
      }
    }
    const pendingChecks: NonNullable<typeof coverage.pendingChecks> = [];
    for (const pending of deferrals(run, stageIndex)) {
      if (!coversDeferral(run, stage, pending, cache)) continue;
      // Do not remove raw material to squeeze in a question. If it cannot fit,
      // this stage cannot authorize a resolution; the unresolved item blocks.
      if (JSON.stringify([...sources, pending.question]).length > sourceCapacity(run.input)) {
        if (stage.reconsiderationFor) throw new DesignReviewError('正式复核原文与问题超过容量，未截断来源');
        continue;
      }
      sources.push(pending.question);
      const cited = citedSourceIds(run, pending);
      const priorSourceIds = reconsideration || followup || (run.scheduleVersion ?? 1) >= 34 && cited.length ? cited : undefined;
      pendingChecks.push({ id: pending.id, criterion: pending.check.criterion, questionSourceId: pending.question.id, requiredSourceIds: pending.reconsideration ? [...new Set(run.reconsiderations!.filter(item => `reconsider-${item.annotation.id}` === stage.id).flatMap(item => [...item.annotation.evidence.map(e => e.sourceId), ...item.additionalSourceIds]))] : pending.check.awaitingSources!, priorUnitIds: pending.stage.unitIds.filter(id => stage.unitIds.includes(id)), ...(priorSourceIds ? { priorSourceIds } : {}) });
    }
    if (pendingChecks.length) coverage.pendingChecks = pendingChecks;
  }
  if (coverage && stage.kind === 'synthesis') {
    coverage.resolvedDeferrals = resolvedDeferrals(run, stageIndex, cache);
    if (coverage.resolvedDeferrals.some(item => item.kind === 'reconsideration' && run.reconsiderations?.some(binding => binding.version === 2 && `${binding.annotation.stageId}/${binding.annotation.criterion}` === item.checkId))) coverage.sourceNavigationReconsidered = true;
    if ((run.scheduleVersion ?? 1) >= 11) coverage.synthesis = synthesisCoverage(run, stage);
    if ((run.scheduleVersion ?? 1) >= 27 && coverage.synthesis) {
      const resolved = new Set(coverage.resolvedDeferrals.map(item => item.checkId));
      coverage.synthesis.requiredFindings = stage.children.flatMap(id =>
        run.stages.find(child => child.id === id)!.result!.checks.flatMap(check => {
          if (check.verdict === 'pass' || resolved.has(`${id}/${check.criterion}`)) return [];
          return [{ stageId: id, criterion: check.criterion, verdict: check.verdict }];
        }));
    }
  }
  if (coverage && followup && (run.scheduleVersion ?? 1) >= 14) {
    const related = relatedFollowupSources(run, followup, cache);
    if (related.length) {
      const includedSourceIds = related.filter(id => run.units.filter(u => u.sourceId === id).every(u => stage.unitIds.includes(u.id)));
      const context = { includedSourceIds, omittedSourceIds: related.filter(id => !includedSourceIds.includes(id)) };
      if (JSON.stringify({ ...coverage, relatedSourceContext: context }).length <= sharedContextCapacity) coverage.relatedSourceContext = context;
    }
  }
  if (coverage && (run.scheduleVersion ?? 1) >= 31 && run.input.purpose !== 'chapter_review' && ['characters', 'story'].includes(run.input.area)) {
    const chapterCast = designReviewChapterCast(run.input);
    if (chapterCast.chapters.length) {
      if (JSON.stringify({ ...coverage, chapterCast }).length <= sharedContextCapacity) coverage.chapterCast = chapterCast;
      else if (JSON.stringify({ ...coverage, chapterCastOmitted: 'capacity' }).length <= sharedContextCapacity) coverage.chapterCastOmitted = 'capacity';
    }
  }
  if (coverage && (run.scheduleVersion ?? 1) >= 32 && run.input.purpose !== 'chapter_review') {
    const chapterTimes = designReviewChapterTimes(run.input);
    if (chapterTimes.length) {
      if (JSON.stringify({ ...coverage, chapterTimes }).length <= sharedContextCapacity) coverage.chapterTimes = chapterTimes;
      else if (JSON.stringify({ ...coverage, chapterTimesOmitted: 'capacity' }).length <= sharedContextCapacity) coverage.chapterTimesOmitted = 'capacity';
    }
  }
  if (coverage && (run.scheduleVersion ?? 1) >= 13) {
    const mentions = entityMentions(run, cache);
    if (Object.keys(mentions).length) {
      if (JSON.stringify({ ...coverage, entityMentions: mentions }).length <= sharedContextCapacity) coverage.entityMentions = mentions;
      else if (JSON.stringify({ ...coverage, entityMentionsOmitted: 'capacity' }).length <= sharedContextCapacity) coverage.entityMentionsOmitted = 'capacity';
    }
  }
  if (coverage && JSON.stringify(coverage).length > sharedContextCapacity) throw new DesignReviewError('评审范围目录与补读元数据超过容量，请拆分作品验收阶段；目录未截断');
  // Two single-criterion follow-ups cannot assess unrelated criteria merely
  // because they share a synthesis node. The root still receives all criteria
  // through the original raw checks; no existing finding is discarded.
  const synthesisCriteria = stage.kind === 'synthesis' && (run.scheduleVersion ?? 1) >= 15
    ? new Set(stage.children.flatMap(id => run.stages.find(child => child.id === id)!.result!.checks.map(check => check.criterion))) : undefined;
  const focused = reconsideration ?? followup;
  const rubric = focused ? { [focused.check.criterion]: run.input.rubric[focused.check.criterion] }
    : synthesisCriteria ? Object.fromEntries(Object.entries(run.input.rubric).filter(([criterion]) => synthesisCriteria.has(criterion)))
    : (run.scheduleVersion ?? 1) >= 7 && coverage?.mode === 'local_sources' ? localDesignReviewRubric(run.input, run.scheduleVersion) : structuredClone(run.input.rubric);
  if (synthesisCriteria && !Object.keys(rubric).length) throw new DesignReviewError('综合前置报告没有可核验的评审标准');
  return { ...structuredClone(run.input), rubric, sources, stage: {
    kind: stage.kind, label: stage.label, totalBatches: run.stages.filter(s => s.kind === 'batch').length,
    ...(reconsideration ? { reconsiderationFor: reconsideration.id } : {}),
    ...(reconsideration && run.reconsiderations?.some(binding => binding.version === 2 && `reconsider-${binding.annotation.id}` === stage.id) ? { reconsiderationKind: 'source_navigation' as const } : {}),
    ...(followup ? { followupFor: followup.id } : {}),
    ...(followup && (run.scheduleVersion ?? 1) >= 33 ? { followupBudget: { remainingRounds: Math.max(0, maxFollowupRounds - pendingChain(run, followup).length) } } : {}),
    ...((run.scheduleVersion ?? 1) >= 16 ? { evidenceLimit: 96 as const } : {}),
    ...((run.scheduleVersion ?? 1) >= 17 ? { reportBudget: { sourceId: `review-result/${stage.id}`, maxCharacters: reportCapacity(run.input) } } : {}),
    ...((run.scheduleVersion ?? 1) >= 18 && coverage?.mode === 'local_sources' && !followup && !reconsideration ? { requireInsufficiencyReason: true as const } : {}),
    sourceMap: run.units.filter(u => stage.unitIds.includes(u.id)),
    ...(coverage ? { coverage } : {}),
  } };
}

export function acceptDesignReviewStage(run: DesignReviewRun, stage: DesignReviewStage, result: DesignReviewResult): void {
  const input = designReviewStageInput(run, stage);
  validateDesignReview(input, result);
  const tooLarge = (run.scheduleVersion ?? 1) >= 3
    ? JSON.stringify([resultSource(run, { ...stage, result })]).length > reportCapacity(run.input)
    : JSON.stringify(result).length > resultCapacity;
  if (tooLarge) throw new DesignReviewError('本批评审结论过长，请重新评审并精炼解释；原文与失败记录保留');
  stage.result = structuredClone(result); stage.error = undefined;
  scheduleFollowups(run);
}

/** Rebuild the schedule and every byte-range. Preserve all adverse judgments;
 * only explicitly deferred unread-source questions can be settled by a raw
 * stage covering both the original material and every requested source. */
export function completeDesignReviewRun(run: DesignReviewRun): { input: DesignReviewInput; result: DesignReviewResult } {
  if (run.scheduleVersion !== undefined && ![2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34].includes(run.scheduleVersion)) throw new DesignReviewError('未知评审调度版本');
  const expected = createDesignReviewRun(run.input, run.createdAt, run.scheduleVersion ?? 1);
  expected.id = run.id;
  let bindingIndex = 0;
  const insertReconsiderations = (afterStageId: string) => {
    const binding = run.reconsiderations?.[bindingIndex];
    if (!binding || binding.afterStageId !== afterStageId) return;
    if (![1, 2].includes(binding.version)) throw new DesignReviewError('未知正式复核版本');
    queueDesignReviewReconsideration(expected, binding.annotation, binding.additionalSourceIds, binding.createdAt);
    if (expected.reconsiderations!.at(-1)!.version !== binding.version) throw new DesignReviewError('正式复核版本与原判定不匹配');
    bindingIndex++;
  };
  if ((run.scheduleVersion ?? 1) >= 33) {
    // Each completed round can reveal another bounded source request. Rebuild
    // those rounds from their actual responses before accepting the schedule.
    let next = expected.stages.find(s => s.kind !== 'synthesis' && !s.result);
    while (next) {
      const result = run.stages.find(s => s.id === next!.id)?.result;
      if (!result) throw new DesignReviewError('原文覆盖或跨批检查未完成，不得形成整体结论');
      acceptDesignReviewStage(expected, next, result);
      insertReconsiderations(next.id);
      next = expected.stages.find(s => s.kind !== 'synthesis' && !s.result);
    }
  } else if ((run.scheduleVersion ?? 1) >= 5) {
    // Validate the original raw results against canonical coverage before using
    // their citations to derive the only allowed follow-up schedule.
    for (const stage of expected.stages.filter(s => s.kind !== 'synthesis')) {
      const result = run.stages.find(s => s.id === stage.id)?.result;
      if (!result) throw new DesignReviewError('原文覆盖或跨批检查未完成，不得形成整体结论');
      acceptDesignReviewStage(expected, stage, result);
    }
  }
  if (bindingIndex !== (run.reconsiderations?.length ?? 0)) throw new DesignReviewError('正式复核插入边界不匹配');
  const plan = (r: DesignReviewRun) => r.stages.map(({ id, kind, unitIds, children, followupFor, reconsiderationFor }) => ({ id, kind, unitIds, children, ...(followupFor ? { followupFor } : {}), ...(reconsiderationFor ? { reconsiderationFor } : {}) }));
  if (JSON.stringify(run.units) !== JSON.stringify(expected.units) || JSON.stringify(plan(run)) !== JSON.stringify(plan(expected)) || !run.stages.length || run.stages.some(s => !s.result)) throw new DesignReviewError('原文覆盖或跨批检查未完成，不得形成整体结论');
  const cache = reviewReadCache();
  for (const stage of run.stages) validateDesignReview(readDesignReviewStageInput(run, stage, cache), stage.result!);
  const rank = { pass: 0, insufficient: 1, revise: 2 };
  const resolutions = (run.scheduleVersion ?? 1) >= 3 ? resolvedDeferrals(run, run.stages.length, cache) : [];
  const resolved = new Set(resolutions.map(r => r.checkId));
  const root = run.stages.at(-1)!.result!;
  const checks = Object.keys(run.input.rubric).map(criterion => {
    let selected = root.checks.find(c => c.criterion === criterion)!;
    for (const stage of run.stages) {
      const check = stage.result!.checks.find(c => c.criterion === criterion);
      if (!check) continue; // Dedicated follow-ups evaluate only their original criterion.
      if (resolved.has(`${stage.id}/${criterion}`)) continue;
      if (rank[check.verdict] > rank[selected.verdict]) selected = check;
    }
    // Scoped dispositions stay in the immutable stages and resolution ledger;
    // final checks are again judgments about the complete input.
    const { awaitingSources, resolves, ...finalCheck } = structuredClone(selected);
    return finalCheck;
  });
  const resolutionSources = (run.scheduleVersion ?? 1) >= 29 ? [...new Map(run.stages
    .filter(stage => stage.kind === 'synthesis')
    .flatMap(stage => {
      const source = readResolutionContext(run, run.stages.indexOf(stage), cache);
      return source ? [[source.id, source] as const] : [];
    })).values()] : [];
  const input = { ...run.input, sources: [...resolutionSources, ...designReviewUnitSources(run), ...run.stages.filter(s => s.result).map(s => resultSource(run, s, cache)), ...((run.scheduleVersion ?? 1) >= 3 ? deferrals(run).map(p => p.question) : [])] };
  const blocked = checks.some(c => c.verdict !== 'pass');
  const result = { summary: blocked ? '全部批次已完成，但仍有返修或材料不足项；详见逐项结论。' : root.summary, checks, ...(resolutions.some(item => !item.kind) ? { resolvedDeferrals: resolutions.filter(item => !item.kind) } : {}), ...(resolutions.some(item => item.kind) ? { resolvedReconsiderations: resolutions.filter(item => item.kind).map(item => ({ ...item, kind: 'reconsideration' as const })) } : {}) };
  validateDesignReview(input, result);
  return { input, result };
}
