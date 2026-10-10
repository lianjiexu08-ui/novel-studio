import { createHash, randomUUID } from 'node:crypto';
import type { ReadinessBlocker, RealizationStatus, StoryEvent, Work } from './core.ts';

/**
 * Book plans are future intent, never story fact. A plan revision is immutable
 * once created; review appends a record, approval is a separate author action,
 * and only an approved revision drives chapter briefs and generation.
 */

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const now = () => new Date().toISOString();

export type PlanStatus = 'proposed' | 'reviewed' | 'approved' | 'superseded';
export type PlanSource = 'model' | 'author' | 'mixed';

export interface VolumePlan {
  id: string;
  order: number;
  title: string;
  startChapter: number;
  endChapter: number;
  goal: string;
  opposition: string;
  characterIds: string[];
  climax: string;
  endState: string;
  carryOver: string;
}

export interface ChapterOutline {
  id: string;
  chapterNumber: number;
  volumeId: string;
  title: string;
  summary: string;
  characterGoals: string;
  conflict: string;
  choice: string;
  cost: string;
  threads: string[];
  endState: string;
  characterIds: string[];
  location?: string;
  storyTime?: string;
  scenes: string[];
  source: 'model' | 'author';
}

export interface PlotMilestone {
  id: string;
  title: string;
  kind: 'climax' | 'turn' | 'payoff';
  startChapter: number;
  endChapter: number;
  setup: string[];
  cost: string;
  outcome: string;
}

/** Satisfied when an active adopted event before the chapter matches. */
export interface FactRequirement {
  eventType: string;
  subjectId: string;
  predicate?: string;
  equals?: unknown;
}

/** `targetId` needs either another plan node (`sourceId`) realized first, or a fact in the ledger. */
export interface PlanDependency {
  id: string;
  targetId: string;
  sourceId?: string;
  fact?: FactRequirement;
  requiredness: 'must' | 'optional';
  description: string;
}

export interface PlanQuestion {
  id: string;
  question: string;
  blocking: boolean;
  status: 'open' | 'resolved' | 'deferred';
}

export interface BookPlan {
  targetChapterCount: number;
  volumeCount: number;
  mainConflict: string;
  theme: string;
  protagonistArc: string;
  endingDirection: string;
  keyTurns: string[];
  volumes: VolumePlan[];
  chapters: ChapterOutline[];
  milestones: PlotMilestone[];
  dependencies: PlanDependency[];
  openQuestions: PlanQuestion[];
}

export type PlanIssueCode =
  | 'TARGET_INVALID' | 'VOLUME_COUNT_MISMATCH' | 'VOLUME_ORDER' | 'VOLUME_RANGE' | 'VOLUME_GAP' | 'VOLUME_OVERLAP' | 'VOLUME_TOTAL_MISMATCH'
  | 'OUTLINE_MISSING' | 'OUTLINE_INCOMPLETE' | 'OUTLINE_DUPLICATE' | 'OUTLINE_VOLUME_MISMATCH' | 'OUTLINE_OUT_OF_RANGE'
  | 'MILESTONE_RANGE' | 'DEPENDENCY_DANGLING' | 'DEPENDENCY_INVALID' | 'DEPENDENCY_CYCLE' | 'DEPENDENCY_ORDER'
  | 'REFERENCE_UNKNOWN' | 'BLOCKING_QUESTION' | 'DESIGN_OUTDATED' | 'DUPLICATE_ID' | 'COVENANT_MISMATCH'
  | 'VOLUME_WITHOUT_CLIMAX' | 'MILESTONE_WITHOUT_SETUP' | 'REPEATED_CONFLICT';

export interface PlanIssue {
  code: PlanIssueCode;
  severity: 'error' | 'warning';
  message: string;
  volumeId?: string;
  chapterNumber?: number;
  nodeId?: string;
}

export interface PlanReview {
  id: string;
  contentHash: string;
  worldPackRevision?: number;
  storyBibleRevision?: number;
  passed: boolean;
  issues: PlanIssue[];
  reviewedAt: string;
}

export interface PlanRevision {
  id: string;
  workId: string;
  revision: number;
  parentId?: string;
  status: PlanStatus;
  source: PlanSource;
  note: string;
  plan: BookPlan;
  contentHash: string;
  worldPackRevision?: number;
  storyBibleRevision?: number;
  reviews: PlanReview[];
  createdAt: string;
  approvedAt?: string;
}

/** A plan edit was based on a revision that is no longer the latest. */
export class PlanConflictError extends Error {}
/** Review or approval preconditions are not met. */
export class PlanGateError extends Error {}

export const OUTLINE_WINDOW = 50;

/** Formal writing needs outlines for the first `min(50, target)` chapters. */
export function outlineWindow(targetChapterCount: number): number {
  return Math.min(OUTLINE_WINDOW, Math.max(0, targetChapterCount));
}

export function normalizePlan(plan: BookPlan): BookPlan {
  return {
    ...plan,
    keyTurns: [...plan.keyTurns],
    volumes: [...plan.volumes].sort((a, b) => a.order - b.order),
    chapters: plan.chapters.map((outline) => ({ ...outline, id: `chapter-${outline.chapterNumber}` })).sort((a, b) => a.chapterNumber - b.chapterNumber),
    milestones: [...plan.milestones].sort((a, b) => a.startChapter - b.startChapter || a.id.localeCompare(b.id)),
    dependencies: [...plan.dependencies],
    openQuestions: [...plan.openQuestions],
  };
}

export function planContentHash(plan: BookPlan): string {
  return createHash('sha256').update(JSON.stringify(normalizePlan(plan))).digest('hex');
}

const OUTLINE_FIELDS: Array<[keyof ChapterOutline, string]> = [
  ['summary', '事件摘要'], ['characterGoals', '人物目标'], ['conflict', '主要冲突'], ['choice', '关键选择'], ['cost', '代价或后果'], ['endState', '结束状态'],
];

function compactRanges(numbers: number[]): string {
  const ranges: string[] = [];
  let start = numbers[0];
  for (let index = 1; index <= numbers.length; index += 1) {
    if (numbers[index] === numbers[index - 1] + 1) continue;
    const end = numbers[index - 1];
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    start = numbers[index];
  }
  return ranges.join('、');
}

/**
 * Structural plan review: ranges, totals, outline completeness, closed
 * references, acyclic must-dependencies and blocking questions are errors.
 * Semantic hints are warnings; passing never means the plan is good writing.
 */
export function reviewBookPlan(plan: BookPlan, refs: { characterIds: Set<string> } = { characterIds: new Set() }): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const error = (issue: Omit<PlanIssue, 'severity'>) => issues.push({ ...issue, severity: 'error' });
  const warn = (issue: Omit<PlanIssue, 'severity'>) => issues.push({ ...issue, severity: 'warning' });
  const target = plan.targetChapterCount;
  if (!Number.isInteger(target) || target < 1) error({ code: 'TARGET_INVALID', message: `全书目标章数无效：${target}` });

  const seenIds = new Set<string>();
  for (const item of [...plan.volumes, ...plan.chapters, ...plan.milestones, ...plan.dependencies]) {
    if (seenIds.has(item.id)) error({ code: 'DUPLICATE_ID', message: `计划里有重复的 ID ${item.id}`, nodeId: item.id });
    seenIds.add(item.id);
  }

  const volumes = [...plan.volumes].sort((a, b) => a.order - b.order);
  if (volumes.length !== plan.volumeCount) error({ code: 'VOLUME_COUNT_MISMATCH', message: `计划写明 ${plan.volumeCount} 卷，实际安排了 ${volumes.length} 卷` });
  volumes.forEach((volume, index) => {
    if (volume.order !== index + 1) error({ code: 'VOLUME_ORDER', message: `卷序必须从 1 连续编号；「${volume.title}」的卷序是 ${volume.order}`, volumeId: volume.id });
    if (volume.endChapter < volume.startChapter) error({ code: 'VOLUME_RANGE', message: `「${volume.title}」的结束章 ${volume.endChapter} 早于起始章 ${volume.startChapter}`, volumeId: volume.id });
    const expectedStart = index === 0 ? 1 : volumes[index - 1].endChapter + 1;
    if (volume.startChapter > expectedStart) error({ code: 'VOLUME_GAP', message: `第 ${expectedStart}-${volume.startChapter - 1} 章不属于任何一卷（「${volume.title}」之前）`, volumeId: volume.id });
    if (volume.startChapter < expectedStart) error({ code: 'VOLUME_OVERLAP', message: `「${volume.title}」从第 ${volume.startChapter} 章开始，与上一卷重叠`, volumeId: volume.id });
    for (const characterId of volume.characterIds) if (!refs.characterIds.has(characterId)) error({ code: 'REFERENCE_UNKNOWN', message: `「${volume.title}」引用了不存在的人物 ${characterId}`, volumeId: volume.id });
  });
  const total = volumes.reduce((sum, volume) => sum + Math.max(0, volume.endChapter - volume.startChapter + 1), 0);
  if (volumes.length && total !== target) error({ code: 'VOLUME_TOTAL_MISMATCH', message: `分卷合计 ${total} 章，全书目标 ${target} 章`, volumeId: volumes.at(-1)!.id });
  if (volumes.length && volumes.at(-1)!.endChapter !== target && total === target) error({ code: 'VOLUME_RANGE', message: `最后一卷应在第 ${target} 章结束`, volumeId: volumes.at(-1)!.id });

  const volumeById = new Map(volumes.map((volume) => [volume.id, volume]));
  const byNumber = new Map<number, ChapterOutline>();
  for (const outline of plan.chapters) {
    if (byNumber.has(outline.chapterNumber)) error({ code: 'OUTLINE_DUPLICATE', message: `第 ${outline.chapterNumber} 章有多条章纲`, chapterNumber: outline.chapterNumber });
    byNumber.set(outline.chapterNumber, outline);
    if (outline.chapterNumber < 1 || outline.chapterNumber > target) error({ code: 'OUTLINE_OUT_OF_RANGE', message: `第 ${outline.chapterNumber} 章超出全书目标 ${target} 章`, chapterNumber: outline.chapterNumber });
    const volume = volumeById.get(outline.volumeId);
    if (!volume) error({ code: 'OUTLINE_VOLUME_MISMATCH', message: `第 ${outline.chapterNumber} 章引用了不存在的卷 ${outline.volumeId}`, chapterNumber: outline.chapterNumber });
    else if (outline.chapterNumber < volume.startChapter || outline.chapterNumber > volume.endChapter) error({ code: 'OUTLINE_VOLUME_MISMATCH', message: `第 ${outline.chapterNumber} 章不在「${volume.title}」的范围 ${volume.startChapter}-${volume.endChapter} 内`, chapterNumber: outline.chapterNumber, volumeId: volume.id });
    const missing = OUTLINE_FIELDS.filter(([field]) => !String(outline[field] ?? '').trim()).map(([, label]) => label);
    if (missing.length) error({ code: 'OUTLINE_INCOMPLETE', message: `第 ${outline.chapterNumber} 章章纲缺少：${missing.join('、')}`, chapterNumber: outline.chapterNumber });
    for (const characterId of outline.characterIds) if (!refs.characterIds.has(characterId)) error({ code: 'REFERENCE_UNKNOWN', message: `第 ${outline.chapterNumber} 章引用了不存在的人物 ${characterId}`, chapterNumber: outline.chapterNumber });
  }
  const window = outlineWindow(target);
  const missingOutlines = Array.from({ length: window }, (_, index) => index + 1).filter((chapter) => !byNumber.has(chapter));
  if (missingOutlines.length) error({ code: 'OUTLINE_MISSING', message: `正式写作前需要前 ${window} 章章纲；缺少第 ${compactRanges(missingOutlines)} 章`, chapterNumber: missingOutlines[0] });

  const milestoneIds = new Set(plan.milestones.map((milestone) => milestone.id));
  for (const milestone of plan.milestones) {
    if (milestone.startChapter < 1 || milestone.endChapter > target || milestone.endChapter < milestone.startChapter) {
      error({ code: 'MILESTONE_RANGE', message: `高潮/节点「${milestone.title}」的章节范围 ${milestone.startChapter}-${milestone.endChapter} 无效`, nodeId: milestone.id });
    }
    if (!milestone.setup.some((item) => item.trim())) warn({ code: 'MILESTONE_WITHOUT_SETUP', message: `「${milestone.title}」没有列出铺垫准备`, nodeId: milestone.id });
  }
  for (const volume of volumes) {
    if (!plan.milestones.some((milestone) => milestone.kind === 'climax' && milestone.startChapter <= volume.endChapter && milestone.endChapter >= volume.startChapter)) {
      warn({ code: 'VOLUME_WITHOUT_CLIMAX', message: `「${volume.title}」还没有安排高潮范围`, volumeId: volume.id });
    }
  }

  const outlineIds = new Map(plan.chapters.map((outline) => [outline.id, outline]));
  const nodeExists = (nodeId: string) => outlineIds.has(nodeId) || milestoneIds.has(nodeId);
  const startOf = (nodeId: string) => outlineIds.get(nodeId)?.chapterNumber ?? plan.milestones.find((milestone) => milestone.id === nodeId)?.startChapter;
  const endOf = (nodeId: string) => outlineIds.get(nodeId)?.chapterNumber ?? plan.milestones.find((milestone) => milestone.id === nodeId)?.endChapter;
  for (const dependency of plan.dependencies) {
    if (!nodeExists(dependency.targetId)) error({ code: 'DEPENDENCY_DANGLING', message: `依赖「${dependency.description}」指向不存在的节点 ${dependency.targetId}`, nodeId: dependency.id });
    if (dependency.sourceId && !nodeExists(dependency.sourceId)) error({ code: 'DEPENDENCY_DANGLING', message: `依赖「${dependency.description}」的前置节点 ${dependency.sourceId} 不存在`, nodeId: dependency.id });
    if (!dependency.sourceId && !dependency.fact) error({ code: 'DEPENDENCY_INVALID', message: `依赖「${dependency.description}」既没有前置节点也没有前置事实`, nodeId: dependency.id });
    if (dependency.fact && (!dependency.fact.eventType.trim() || !dependency.fact.subjectId.trim())) error({ code: 'DEPENDENCY_INVALID', message: `依赖「${dependency.description}」的前置事实缺少事件类型或对象`, nodeId: dependency.id });
    if (dependency.requiredness === 'must' && dependency.sourceId && nodeExists(dependency.sourceId) && nodeExists(dependency.targetId)) {
      const sourceEnd = endOf(dependency.sourceId)!;
      const targetStart = startOf(dependency.targetId)!;
      if (sourceEnd >= targetStart) error({ code: 'DEPENDENCY_ORDER', message: `「${dependency.description}」要求的前置安排在第 ${sourceEnd} 章，不早于目标的第 ${targetStart} 章`, nodeId: dependency.id });
    }
  }
  const cycle = findMustCycle(plan.dependencies);
  if (cycle) error({ code: 'DEPENDENCY_CYCLE', message: `关键依赖成环：${cycle.join(' → ')}`, nodeId: cycle[0] });

  for (const question of plan.openQuestions) {
    if (question.blocking && question.status === 'open') error({ code: 'BLOCKING_QUESTION', message: `未决问题会阻断开篇：${question.question}`, nodeId: question.id });
  }
  const sorted = [...plan.chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (current.chapterNumber === previous.chapterNumber + 1 && current.conflict.trim() && current.conflict.trim() === previous.conflict.trim()) {
      warn({ code: 'REPEATED_CONFLICT', message: `第 ${previous.chapterNumber}、${current.chapterNumber} 章的冲突完全相同，注意不要原地踏步`, chapterNumber: current.chapterNumber });
    }
  }
  return issues;
}

function findMustCycle(dependencies: PlanDependency[]): string[] | undefined {
  const edges = new Map<string, string[]>();
  for (const dependency of dependencies) {
    if (dependency.requiredness !== 'must' || !dependency.sourceId) continue;
    edges.set(dependency.sourceId, [...(edges.get(dependency.sourceId) ?? []), dependency.targetId]);
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const path: string[] = [];
  const visit = (node: string): string[] | undefined => {
    if (state.get(node) === 'visiting') return [...path.slice(path.indexOf(node)), node];
    if (state.get(node) === 'done') return undefined;
    state.set(node, 'visiting');
    path.push(node);
    for (const next of edges.get(node) ?? []) {
      const found = visit(next);
      if (found) return found;
    }
    path.pop();
    state.set(node, 'done');
    return undefined;
  };
  for (const node of edges.keys()) {
    const found = visit(node);
    if (found) return found;
  }
  return undefined;
}

export function knownCharacterIds(work: Work): Set<string> {
  return new Set([...(work.storyBible?.characters ?? []).map((character) => character.id), ...work.characters.keys()]);
}

export function latestPlan(work: Work): PlanRevision | undefined {
  return [...work.plans.values()].sort((a, b) => b.revision - a.revision)[0];
}

export function activePlan(work: Work): PlanRevision | undefined {
  return work.activePlanId ? work.plans.get(work.activePlanId) : undefined;
}

/**
 * Stores a new immutable plan revision. `baseRevisionId` must be the latest
 * revision so two editors cannot silently overwrite each other.
 */
export function createPlanRevision(work: Work, plan: BookPlan, input: { source: PlanSource; note?: string; baseRevisionId?: string }): PlanRevision {
  const latest = latestPlan(work);
  if (latest && input.baseRevisionId !== latest.id) throw new PlanConflictError(`plan revision ${input.baseRevisionId ?? '(none)'} is not the latest (${latest.id}); reload before saving`);
  if (!latest && input.baseRevisionId) throw new PlanConflictError(`unknown base plan ${input.baseRevisionId}`);
  const normalized = normalizePlan(plan);
  const revision: PlanRevision = {
    id: id('plan'), workId: work.id, revision: (latest?.revision ?? 0) + 1, parentId: latest?.id,
    status: 'proposed', source: input.source, note: input.note?.trim() ?? '', plan: normalized,
    contentHash: planContentHash(normalized), worldPackRevision: work.worldPack?.revision, storyBibleRevision: work.storyBible?.revision,
    reviews: [], createdAt: now(),
  };
  work.plans.set(revision.id, revision);
  return revision;
}

function mustGetPlan(work: Work, planId: string): PlanRevision {
  const plan = work.plans.get(planId);
  if (!plan) throw new Error(`unknown plan ${planId}`);
  return plan;
}

function designOutdated(work: Work, plan: PlanRevision): boolean {
  return plan.worldPackRevision !== work.worldPack?.revision || plan.storyBibleRevision !== work.storyBible?.revision;
}

/** Runs the structural review on one immutable revision and appends the record. */
export function reviewPlanRevision(work: Work, planId: string): PlanReview {
  const plan = mustGetPlan(work, planId);
  if (plan.contentHash !== planContentHash(plan.plan)) throw new PlanGateError('plan content does not match its recorded hash');
  const issues = reviewBookPlan(plan.plan, { characterIds: knownCharacterIds(work) });
  if (designOutdated(work, plan)) issues.unshift({ code: 'DESIGN_OUTDATED', severity: 'error', message: '世界包或 Story Bible 在起草这版计划后已改变；请基于当前设计另存一版' });
  const { targetChapterCount, volumeCount } = work.covenant;
  if (targetChapterCount && targetChapterCount !== plan.plan.targetChapterCount) issues.push({ code: 'COVENANT_MISMATCH', severity: 'warning', message: `立项卡写的是 ${targetChapterCount} 章，计划是 ${plan.plan.targetChapterCount} 章` });
  if (volumeCount && volumeCount !== plan.plan.volumeCount) issues.push({ code: 'COVENANT_MISMATCH', severity: 'warning', message: `立项卡写的是 ${volumeCount} 卷，计划是 ${plan.plan.volumeCount} 卷` });
  const review: PlanReview = {
    id: id('plan_review'), contentHash: plan.contentHash, worldPackRevision: work.worldPack?.revision, storyBibleRevision: work.storyBible?.revision,
    passed: !issues.some((issue) => issue.severity === 'error'), issues, reviewedAt: now(),
  };
  plan.reviews.push(review);
  if (review.passed && plan.status === 'proposed') plan.status = 'reviewed';
  return review;
}

/**
 * Author approval. Requires a passing review of exactly this content against
 * the current design; the previous approved plan is kept as superseded history.
 */
export function approvePlanRevision(work: Work, planId: string): PlanRevision {
  const plan = mustGetPlan(work, planId);
  if (plan.status === 'approved') return plan;
  if (plan.status === 'superseded') throw new PlanGateError('a superseded plan cannot be approved; save it as a new revision');
  const review = plan.reviews.at(-1);
  if (!review || review.contentHash !== plan.contentHash) throw new PlanGateError('run the plan review before approving');
  if (!review.passed) throw new PlanGateError(`plan review failed: ${review.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message).join('; ')}`);
  if (designOutdated(work, plan) || review.storyBibleRevision !== work.storyBible?.revision || review.worldPackRevision !== work.worldPack?.revision) {
    throw new PlanGateError('world pack or story bible changed since the review; save a new revision against the current design');
  }
  const previous = activePlan(work);
  if (previous) previous.status = 'superseded';
  plan.status = 'approved';
  plan.approvedAt = now();
  work.activePlanId = plan.id;
  return plan;
}

export interface BriefDependency {
  dependencyId: string;
  description: string;
  requiredness: 'must' | 'optional';
  satisfied: boolean;
  evidence?: string;
}

export interface ChapterBrief {
  id: string;
  workId: string;
  chapterNumber: number;
  planRevisionId: string;
  outlineId: string;
  status: 'derived' | 'author_confirmed';
  pov: string;
  characters: string[];
  location: string;
  storyTime: string;
  scenes: string[];
  mustDo: string[];
  mustNotHappen: string[];
  endState: string;
  dependsOn: BriefDependency[];
  preserve: string[];
  /** Hash of the plan, outline, prerequisite state and story revision this brief was built from. */
  basisFingerprint: string;
  createdAt: string;
}

export type BriefEdits = Partial<Pick<ChapterBrief, 'pov' | 'characters' | 'location' | 'storyTime' | 'scenes' | 'mustDo' | 'mustNotHappen' | 'endState' | 'preserve'>>;

export interface EffectiveBrief {
  brief: ChapterBrief;
  /** The author edited an earlier brief and the basis has changed since; confirm again before writing. */
  needsConfirmation: boolean;
  derived: ChapterBrief;
}

function matchesFact(event: StoryEvent, fact: FactRequirement): boolean {
  if (event.eventType !== fact.eventType || event.subjectId !== fact.subjectId) return false;
  if (fact.predicate && event.predicate !== fact.predicate) return false;
  if (fact.equals !== undefined && JSON.stringify(event.value) !== JSON.stringify(fact.equals)) return false;
  return true;
}

function dependenciesFor(plan: BookPlan, chapterNumber: number): PlanDependency[] {
  const outline = plan.chapters.find((item) => item.chapterNumber === chapterNumber);
  const milestones = new Set(plan.milestones.filter((milestone) => milestone.startChapter <= chapterNumber && milestone.endChapter >= chapterNumber).map((milestone) => milestone.id));
  return plan.dependencies.filter((dependency) => dependency.targetId === outline?.id || milestones.has(dependency.targetId));
}

function evaluateDependency(work: Work, plan: BookPlan, dependency: PlanDependency, chapterNumber: number): BriefDependency {
  const result: BriefDependency = { dependencyId: dependency.id, description: dependency.description, requiredness: dependency.requiredness, satisfied: false };
  if (dependency.fact) {
    const match = [...work.events.values()]
      .filter((event) => event.active && event.chapterNumber < chapterNumber && matchesFact(event, dependency.fact!))
      .sort((a, b) => a.chapterNumber - b.chapterNumber).at(-1);
    if (!match) return result;
    return { ...result, satisfied: true, evidence: `第 ${match.chapterNumber} 章：${match.evidence || JSON.stringify(match.value)}` };
  }
  const realization = nodeRealization(work, plan, dependency.sourceId!);
  const sourceStart = plan.chapters.find((item) => item.id === dependency.sourceId)?.chapterNumber
    ?? plan.milestones.find((item) => item.id === dependency.sourceId)?.endChapter ?? Number.POSITIVE_INFINITY;
  if (realization?.status !== 'realized' || sourceStart >= chapterNumber) return result;
  return { ...result, satisfied: true, evidence: realization.evidence[0]?.text };
}

/** Prerequisites of a milestone, evaluated at its first chapter. */
export function milestonePrerequisites(work: Work, revision: PlanRevision, milestoneId: string): BriefDependency[] {
  const milestone = revision.plan.milestones.find((item) => item.id === milestoneId);
  if (!milestone) return [];
  return revision.plan.dependencies.filter((dependency) => dependency.targetId === milestoneId)
    .map((dependency) => evaluateDependency(work, revision.plan, dependency, milestone.startChapter));
}

function protagonistName(work: Work): string {
  const manual = [...work.characters.values()].find((character) => character.role === 'protagonist');
  return manual?.name ?? work.storyBible?.characters.find((character) => character.role === 'protagonist')?.name ?? '';
}

function characterName(work: Work, characterId: string): string {
  return work.characters.get(characterId)?.name ?? work.storyBible?.characters.find((character) => character.id === characterId)?.name ?? characterId;
}

/** Builds the chapter brief from the approved outline and the facts adopted before this chapter. */
export function deriveBrief(work: Work, revision: PlanRevision, chapterNumber: number): ChapterBrief | undefined {
  const plan = revision.plan;
  const outline = plan.chapters.find((item) => item.chapterNumber === chapterNumber);
  if (!outline) return undefined;
  const dependsOn = dependenciesFor(plan, chapterNumber).map((dependency) => evaluateDependency(work, plan, dependency, chapterNumber));
  const later = plan.chapters.filter((item) => item.chapterNumber > chapterNumber && item.chapterNumber <= chapterNumber + 3);
  const upcomingMilestones = plan.milestones.filter((milestone) => milestone.startChapter > chapterNumber);
  const preserve = [
    ...(work.covenant.mustKeep.trim() ? [`约定必须保留：${work.covenant.mustKeep.trim()}`] : []),
    ...[...work.relationships.values()].filter((relationship) => relationship.locked)
      .map((relationship) => `锁定关系：${characterName(work, relationship.fromCharacterId)} → ${characterName(work, relationship.toCharacterId)}（${relationship.kind}：${relationship.value}）`),
  ];
  const basisFingerprint = createHash('sha256').update(JSON.stringify({
    planRevisionId: revision.id, contentHash: revision.contentHash, outline, stateRevision: work.stateRevision,
    dependsOn: dependsOn.map((item) => [item.dependencyId, item.satisfied]),
  })).digest('hex');
  return {
    id: `brief_derived_${basisFingerprint.slice(0, 16)}`, workId: work.id, chapterNumber, planRevisionId: revision.id, outlineId: outline.id,
    status: 'derived', pov: protagonistName(work), characters: outline.characterIds.map((characterId) => characterName(work, characterId)),
    location: outline.location ?? '', storyTime: outline.storyTime ?? '', scenes: [...outline.scenes],
    mustDo: [outline.summary, `人物目标：${outline.characterGoals}`, `冲突：${outline.conflict}`, `关键选择：${outline.choice}`, `代价：${outline.cost}`].filter((item) => item.trim()),
    mustNotHappen: [
      ...later.map((item) => `第 ${item.chapterNumber} 章才发生：${item.title || item.summary}`),
      ...upcomingMilestones.slice(0, 3).map((milestone) => `第 ${milestone.startChapter} 章起的${milestone.kind === 'climax' ? '高潮' : '节点'}「${milestone.title}」不得提前`),
    ],
    endState: outline.endState, dependsOn, preserve, basisFingerprint, createdAt: now(),
  };
}

/** The brief a formal generation of this chapter uses, if the work has an approved plan. */
export function effectiveBrief(work: Work, chapterNumber: number): EffectiveBrief | undefined {
  const revision = activePlan(work);
  if (!revision) return undefined;
  const derived = deriveBrief(work, revision, chapterNumber);
  if (!derived) return undefined;
  const confirmed = [...work.briefs.values()]
    .filter((brief) => brief.chapterNumber === chapterNumber && brief.planRevisionId === revision.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  if (!confirmed) return { brief: derived, needsConfirmation: false, derived };
  return { brief: { ...confirmed, dependsOn: derived.dependsOn }, needsConfirmation: confirmed.basisFingerprint !== derived.basisFingerprint, derived };
}

/** Author confirms (and optionally edits) the brief; prerequisite status always comes from the ledger. */
export function confirmBrief(work: Work, chapterNumber: number, edits: BriefEdits = {}): ChapterBrief {
  const revision = activePlan(work);
  if (!revision) throw new PlanGateError('approve a plan before confirming chapter briefs');
  const derived = deriveBrief(work, revision, chapterNumber);
  if (!derived) throw new PlanGateError(`chapter ${chapterNumber} has no outline in the approved plan`);
  const defined = Object.fromEntries(Object.entries(edits).filter(([, value]) => value !== undefined)) as BriefEdits;
  const brief: ChapterBrief = { ...derived, ...defined, id: id('brief'), status: 'author_confirmed', dependsOn: derived.dependsOn, createdAt: now() };
  work.briefs.set(brief.id, brief);
  return brief;
}

export interface RealizationEvidence {
  chapterNumber: number;
  versionId: string;
  eventId: string;
  text: string;
}

export interface NodeRealization {
  nodeId: string;
  kind: 'chapter' | 'milestone';
  title: string;
  startChapter: number;
  endChapter: number;
  status: RealizationStatus;
  /** The planned range has been reached by adopted chapters. */
  due: boolean;
  /** Fully past its range without realizing evidence; not-yet-due nodes are never overdue. */
  overdue: boolean;
  evidence: RealizationEvidence[];
}

const REALIZATION_VALUES = new Set<RealizationStatus>(['partial', 'realized', 'diverged']);

function lastContiguousAdopted(work: Work): number {
  let chapter = 0;
  while (work.currentVersion(chapter + 1)) chapter += 1;
  return chapter;
}

function progressEvidence(work: Work, nodeId: string): { status?: RealizationStatus; evidence: RealizationEvidence[] } {
  const events = [...work.events.values()]
    .filter((event) => event.active && event.eventType === 'plot_progress' && event.subjectId === nodeId)
    .sort((a, b) => a.chapterNumber - b.chapterNumber || a.id.localeCompare(b.id));
  if (!events.length) return { evidence: [] };
  const latest = events.at(-1)!;
  const raw = latest.value && typeof latest.value === 'object' ? (latest.value as { status?: unknown }).status : undefined;
  const status = typeof raw === 'string' && REALIZATION_VALUES.has(raw as RealizationStatus) ? raw as RealizationStatus : 'realized';
  return { status, evidence: events.map((event) => ({ chapterNumber: event.chapterNumber, versionId: event.chapterVersionId, eventId: event.id, text: event.evidence })) };
}

function nodeRealization(work: Work, plan: BookPlan, nodeId: string): NodeRealization | undefined {
  const reached = lastContiguousAdopted(work);
  const outline = plan.chapters.find((item) => item.id === nodeId);
  if (outline) {
    const adopted = Boolean(work.currentVersion(outline.chapterNumber));
    const { status, evidence } = progressEvidence(work, outline.id);
    return {
      nodeId, kind: 'chapter', title: outline.title || outline.summary, startChapter: outline.chapterNumber, endChapter: outline.chapterNumber,
      status: !adopted ? 'unrealized' : status ?? 'insufficient', due: outline.chapterNumber <= reached,
      overdue: false, evidence,
    };
  }
  const milestone = plan.milestones.find((item) => item.id === nodeId);
  if (!milestone) return undefined;
  const { status, evidence } = progressEvidence(work, milestone.id);
  const due = milestone.startChapter <= reached;
  const finalStatus: RealizationStatus = status ?? 'unrealized';
  return {
    nodeId, kind: 'milestone', title: milestone.title, startChapter: milestone.startChapter, endChapter: milestone.endChapter,
    status: finalStatus, due, overdue: milestone.endChapter <= reached && finalStatus !== 'realized', evidence,
  };
}

/** Planned vs. adopted: every outline and milestone with its evidence from current adopted chapters. */
export function planRealization(work: Work, revision: PlanRevision): { reachedChapter: number; nodes: NodeRealization[] } {
  const plan = revision.plan;
  const nodes = [...plan.chapters.map((item) => item.id), ...plan.milestones.map((item) => item.id)]
    .map((nodeId) => nodeRealization(work, plan, nodeId)!)
    .filter(Boolean);
  return { reachedChapter: lastContiguousAdopted(work), nodes };
}

/** Plan-side readiness for formal generation of one chapter. */
export function planBlockers(work: Work, chapterNumber: number): ReadinessBlocker[] {
  const revision = activePlan(work);
  if (!revision) return [{ code: 'PLAN_NOT_APPROVED', message: 'no approved book plan', nextAction: '生成或编写全书计划，审核后批准' }];
  if (designOutdated(work, revision)) return [{ code: 'PLAN_OUTDATED', message: 'the approved plan was drafted against an older world pack or story bible', nextAction: '基于当前设计另存计划，审核后重新批准' }];
  if (chapterNumber > revision.plan.targetChapterCount) return [{ code: 'PLAN_OUTLINE_MISSING', message: `chapter ${chapterNumber} is beyond the planned ${revision.plan.targetChapterCount} chapters`, nextAction: '先修改全书目标章数或追加卷' }];
  const current = effectiveBrief(work, chapterNumber);
  if (!current) return [{ code: 'PLAN_OUTLINE_MISSING', message: `chapter ${chapterNumber} has no outline in the approved plan`, nextAction: `扩展计划，补出第 ${chapterNumber} 章章纲后重新批准` }];
  const blockers: ReadinessBlocker[] = [];
  const unmet = current.brief.dependsOn.filter((dependency) => dependency.requiredness === 'must' && !dependency.satisfied);
  if (unmet.length) blockers.push({ code: 'PLAN_PREREQUISITE_UNMET', message: `prerequisites not met: ${unmet.map((item) => item.description).join('; ')}`, nextAction: '先在前面章节写出这些前置，或修改计划' });
  if (current.needsConfirmation) blockers.push({ code: 'BRIEF_NEEDS_CONFIRMATION', message: 'the chapter brief you edited no longer matches the current plan or story state', nextAction: '查看任务卡变化后重新确认' });
  return blockers;
}
