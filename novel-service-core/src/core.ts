import { createHash, randomUUID } from 'node:crypto';
import { chapterGenerationGate } from './world.ts';
import type { StoryBible, WorldPack } from './world.ts';
import { activePlan, effectiveBrief, planBlockers } from './planning.ts';
import type { ChapterBrief, PlanRevision } from './planning.ts';

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const now = () => new Date().toISOString();

export type CheckStatus = 'passed' | 'failed' | 'inconclusive' | 'unavailable';
export type CandidateStatus = 'candidate' | 'adopted' | 'rejected';
export type VersionStatus = 'adopted' | 'superseded';
export type RealizationStatus = 'unrealized' | 'partial' | 'realized' | 'diverged' | 'insufficient';
export type ManuscriptStatus = 'final' | 'superseded';

export class AdoptionBlocked extends Error {}
export class LockedConstraintError extends AdoptionBlocked {}
export class StaleCandidateError extends AdoptionBlocked {}
/** A demo/trial candidate can be read and checked but never enters the formal story. */
export class DemoCandidateError extends AdoptionBlocked {}
/** A required check is missing, or a check on the current candidate did not pass. */
export class QualityGateError extends AdoptionBlocked {}

export type ReadinessCode =
  | 'MODEL_NOT_CONFIGURED'
  | 'COVENANT_INCOMPLETE'
  | 'CANON_NOT_READY'
  | 'CHAPTER_PREREQUISITE_MISSING'
  | 'CONTEXT_INCOMPLETE'
  | 'PLAN_NOT_APPROVED'
  | 'PLAN_OUTDATED'
  | 'PLAN_OUTLINE_MISSING'
  | 'PLAN_PREREQUISITE_UNMET'
  | 'BRIEF_NEEDS_CONFIRMATION';

export interface ReadinessBlocker {
  code: ReadinessCode;
  message: string;
  nextAction: string;
}

/** The formal generation gate failed; `blockers` lists every unmet condition, not only the first. */
export class ReadinessError extends AdoptionBlocked {
  readonly blockers: ReadinessBlocker[];
  constructor(blockers: ReadinessBlocker[]) {
    super(blockers.map((blocker) => blocker.message).join('; '));
    this.blockers = blockers;
  }
  get code(): ReadinessCode { return this.blockers[0].code; }
}

export type CandidateOrigin = 'model' | 'demo';

export function contentHashOf(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
/** An author edit to settings conflicts with existing settings (duplicate name, dangling reference). */
export class SettingConflictError extends Error {}

export interface EventDraft {
  eventType: string;
  subjectId: string;
  predicate: string;
  value: unknown;
  storyTime?: number;
  evidence?: string;
  plotNodeId?: string;
}

export interface GeneratedChapter {
  content: string;
  proposedEvents: EventDraft[];
  /** Independent extraction result. A mismatch blocks adoption. */
  observedEvents?: EventDraft[];
  usage?: RunUsage;
}

/** Model usage attributed to a candidate or run. `costKnown` is false when a provider reported tokens without a price. */
export interface RunUsage {
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costKnown: boolean;
}

export function emptyUsage(): RunUsage {
  return { calls: 0, failedCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costKnown: true };
}

export function addUsage(total: RunUsage | undefined, more: RunUsage | undefined): RunUsage {
  const base = total ?? emptyUsage();
  if (!more) return base;
  return {
    calls: base.calls + more.calls, failedCalls: base.failedCalls + more.failedCalls,
    inputTokens: base.inputTokens + more.inputTokens, outputTokens: base.outputTokens + more.outputTokens,
    costUsd: base.costUsd + more.costUsd, costKnown: base.costKnown && more.costKnown,
  };
}

/** Errors thrown by model providers may carry the usage spent before failing. */
export function usageOfError(error: unknown): RunUsage | undefined {
  const usage = (error as { usage?: RunUsage } | null)?.usage;
  return usage && typeof usage.calls === 'number' ? usage : undefined;
}

export interface ModelProvider {
  /** Placeholder writers declare themselves; their output is isolated from formal adoption. */
  demo?: boolean;
  generateChapter(input: { work: Work; chapterNumber: number; context: ContextManifest }): GeneratedChapter;
  /** Optional network-backed path. The synchronous path remains for local tests and fallback mode. */
  generateChapterAsync?(input: { work: Work; chapterNumber: number; context: ContextManifest }): Promise<GeneratedChapter>;
}

export interface CheckResult {
  checker: string;
  status: CheckStatus;
  message: string;
  candidateId: string;
  checkedAt: string;
  policyVersion?: string;
  /** Set when the run is recorded: identifies this execution and what it looked at. */
  id?: string;
  contentHash?: string;
  inputs?: CheckInputs;
}

export interface CheckInputs {
  stateRevision: number;
  constraintRevision: number;
  worldPackRevision?: number;
  storyBibleRevision?: number;
}

/**
 * An author's recorded judgement that one specific check execution was a false
 * positive. It never rewrites the check result; the gate reads both.
 */
export interface CheckRuling {
  id: string;
  candidateId: string;
  checkId: string;
  checker: string;
  decision: 'false_positive';
  reason: string;
  evidence: string;
  createdAt: string;
}

/** Server-owned list of checks that must all pass on the current candidate before adoption. */
export interface CheckPolicy {
  version: string;
  required: string[];
  /** Checks whose failed/inconclusive result an author may rule a false positive. Hard constraints stay out of this list. */
  overridable?: string[];
}

export class RulingNotAllowedError extends AdoptionBlocked {}

export interface CandidateChecker {
  name: string;
  check(input: { work: Work; candidate: ChapterCandidate }): CheckResult;
}

export interface ContextManifest {
  workId: string;
  chapterNumber: number;
  stateRevision: number;
  constraintRevision: number;
  worldPackRevision?: number;
  storyBibleRevision?: number;
  /** Approved plan revision and the chapter brief the writer received. */
  planRevisionId?: string;
  brief?: ChapterBrief;
  adoptedVersionIds: string[];
  includedEventIds: string[];
  requiredMaterialStatus: 'complete' | 'needs_split' | 'blocked';
  omittedOptionalMaterial: string[];
  estimatedTokens: number;
  contextBudget: number;
  canonHash: string;
  stateHash: string;
  createdAt: string;
}

export interface ContextPolicy {
  maxEvents?: number;
  maxVersions?: number;
  contextBudget?: number;
}

export interface StoryEvent {
  id: string;
  workId: string;
  chapterVersionId: string;
  chapterNumber: number;
  eventType: string;
  subjectId: string;
  predicate: string;
  value: unknown;
  storyTime?: number;
  evidence: string;
  active: boolean;
}

export interface CharacterState {
  characterId: string;
  field: string;
  value: unknown;
  sourceEventId: string;
  sourceChapterVersionId: string;
  storyTime?: number;
}

export interface CharacterKnowledge {
  characterId: string;
  subjectId: string;
  proposition: string;
  belief: unknown;
  sourceEventId: string;
  sourceChapterVersionId: string;
  storyTime?: number;
}

export interface StoryArcState {
  arcId: string;
  status: 'planned' | 'active' | 'resolved' | 'diverged';
  value: unknown;
  sourceEventId: string;
  sourceChapterVersionId: string;
  storyTime?: number;
}

export interface StorySecretState {
  secretId: string;
  revealed: boolean;
  value: unknown;
  sourceEventId: string;
  sourceChapterVersionId: string;
  storyTime?: number;
}

export interface StoryPromiseState {
  promiseId: string;
  status: 'open' | 'paid' | 'broken';
  value: unknown;
  sourceEventId: string;
  sourceChapterVersionId: string;
  storyTime?: number;
}

export interface StoryThreadState {
  threadId: string;
  status: 'open' | 'resolved' | 'deferred';
  value: unknown;
  sourceEventId: string;
  sourceChapterVersionId: string;
  storyTime?: number;
}

export interface StoryVolumeState {
  volumeId: string;
  status: 'planned' | 'active' | 'resolved' | 'diverged';
  value: unknown;
  sourceEventId: string;
  sourceChapterVersionId: string;
  storyTime?: number;
}

export interface StoryValueState {
  subjectId: string;
  field: string;
  value: unknown;
  sourceEventId: string;
  sourceChapterVersionId: string;
  storyTime?: number;
}

export interface ChapterCandidate {
  id: string;
  workId: string;
  chapterNumber: number;
  content: string;
  proposedEvents: EventDraft[];
  observedEvents?: EventDraft[];
  runId: string;
  generatedAgainstRevision: number;
  generatedAgainstConstraintRevision: number;
  generatedAgainstWorldPackRevision?: number;
  generatedAgainstStoryBibleRevision?: number;
  /** Plan revision active when this was generated; a different approved plan makes it stale. */
  planRevisionId?: string;
  /** Snapshot of the brief used for generation, kept for audit. */
  brief?: ChapterBrief;
  contentHash: string;
  origin: CandidateOrigin;
  status: CandidateStatus;
  /** Latest result per checker. */
  checks: CheckResult[];
  /** Append-only record of every check execution. */
  checkRuns: CheckResult[];
  /** Append-only author rulings on specific check executions. */
  rulings: CheckRuling[];
  usage?: RunUsage;
  adoptedVersionId?: string;
  createdAt: string;
}

export interface ChapterVersion {
  id: string;
  workId: string;
  chapterNumber: number;
  revision: number;
  content: string;
  status: VersionStatus;
  parentVersionId?: string;
  sourceCandidateId?: string;
  stale: boolean;
  createdAt: string;
}

export interface ManuscriptRevision {
  id: string;
  workId: string;
  revision: number;
  status: ManuscriptStatus;
  chapterVersionIds: string[];
  chapterCount: number;
  wordCount: number;
  targetWordCount: number;
  lengthCoverage: number;
  contentHash: string;
  stateRevision: number;
  constraintRevision: number;
  worldPackRevision: number;
  storyBibleRevision: number;
  createdAt: string;
}

export type RelationshipLayer = 'objective' | 'belief';

/**
 * document_revision_locked: part of an approved document revision, never rewritten in place.
 * baseline_locked: the author's initial definition cannot be edited, but story events may evolve it.
 * event_change_forbidden: no story event may change it (e.g. blood ties).
 * evolvable: freely editable and may change through events.
 */
export type LockPolicy = 'document_revision_locked' | 'baseline_locked' | 'event_change_forbidden' | 'evolvable';

export interface Relationship {
  id: string;
  fromCharacterId: string;
  toCharacterId: string;
  kind: string;
  value: string;
  /** Legacy flag kept in sync with `lockPolicy`: true for every policy except evolvable. */
  locked: boolean;
  lockPolicy?: LockPolicy;
  sourceEventId?: string;
  /** objective: true in the story world. belief: how `from` sees `to`, which may be mistaken. */
  layer?: RelationshipLayer;
  note?: string;
  sinceChapter?: number;
}

export type CharacterRole = 'protagonist' | 'major' | 'supporting' | 'minor';

export interface Character {
  id: string;
  name: string;
  aliases: string[];
  role: CharacterRole;
  identity: string;
  goal: string;
  principles: string;
  voice: string;
  notes: string;
  locked: boolean;
  /** Story Bible character this hand-written entry is the same person as. */
  canonicalId?: string;
  createdAt: string;
}

/** A legacy `locked=true` keeps its old meaning (no event may change it); it is never loosened automatically. */
export function lockPolicyOf(relationship: Pick<Relationship, 'locked' | 'lockPolicy'>): LockPolicy {
  return relationship.lockPolicy ?? (relationship.locked ? 'event_change_forbidden' : 'evolvable');
}

export function forbidsEventChange(policy: LockPolicy): boolean {
  return policy === 'event_change_forbidden' || policy === 'document_revision_locked';
}

export type WorldRuleCategory = 'power' | 'cost' | 'resource' | 'institution' | 'geography' | 'other';

export interface WorldRule {
  id: string;
  category: WorldRuleCategory;
  title: string;
  content: string;
  locked: boolean;
  createdAt: string;
}

export type PlotLevel = 'book' | 'volume' | 'chapter';

export interface PlotNode {
  id: string;
  title: string;
  expectedResult: string;
  prerequisites: string[];
  realization: PlanRealization;
  level?: PlotLevel;
  targetChapter?: number;
}

export interface PlanRealization {
  status: RealizationStatus;
  chapterVersionId?: string;
  evidence?: string;
  updatedAt: string;
}

export interface ImpactRecord {
  id: string;
  changedChapterNumber: number;
  affectedChapterNumbers: number[];
  reason: string;
  createdAt: string;
}

export interface ClosureCoverage {
  ready: boolean;
  errors: string[];
  resolved: { volumes: number; arcs: number; secrets: number; promises: number; threads: number };
  expected: { volumes: number; arcs: number; secrets: number; promises: number; threads: number };
}

export type DesignRevisionKind = 'world_pack' | 'story_bible';

/** Immutable author/model design snapshot used by manuscript and audit history. */
export interface DesignRevision {
  id: string;
  workId: string;
  kind: DesignRevisionKind;
  revision: number;
  status: string;
  contentHash: string;
  snapshot: WorldPack | StoryBible;
  createdAt: string;
}

/** Author promise and hard boundaries. This is not story fact and must not be adopted as events. */
export interface CreativeCovenant {
  entryMode: 'expand';
  genre: 'xuanhuan';
  substyle: string;
  audience: string;
  hook: string;
  mustKeep: string;
  lockedNotes: string;
  avoid: string;
  targetLength: string;
  chapterWords: number;
  updateCadence: string;
  protagonistGoal: string;
  obstacle: string;
  readingExperience: string;
  /** Planned book length; the book plan must match it when both are set. */
  targetChapterCount?: number;
  volumeCount?: number;
}

/**
 * One immutable covenant revision. `authorText` is the author's own words as
 * typed; `acceptedSuggestions` are the AI suggestions the author explicitly
 * accepted. Unaccepted suggestions never reach the covenant.
 */
export interface CovenantRevision {
  id: string;
  revision: number;
  covenant: CreativeCovenant;
  authorText: string;
  acceptedSuggestions: string[];
  createdAt: string;
}

export function defaultCovenant(): CreativeCovenant {
  return {
    entryMode: 'expand',
    genre: 'xuanhuan',
    substyle: '',
    audience: '',
    hook: '',
    mustKeep: '',
    lockedNotes: '',
    avoid: '',
    targetLength: '长篇，篇幅未定',
    chapterWords: 2200,
    updateCadence: '日更',
    protagonistGoal: '',
    obstacle: '',
    readingExperience: '',
  };
}

export function isCovenantReady(covenant: CreativeCovenant): boolean {
  return covenant.audience.trim().length > 0 && covenant.hook.trim().length > 0;
}

export function parseCovenant(input: unknown): CreativeCovenant {
  const base = defaultCovenant();
  if (typeof input !== 'object' || input === null) return base;
  const value = input as Partial<CreativeCovenant>;
  const chapterWords = Number(value.chapterWords);
  const text = (field: unknown, fallback = '') => (typeof field === 'string' ? field : fallback);
  return {
    entryMode: 'expand',
    genre: 'xuanhuan',
    substyle: text(value.substyle),
    audience: text(value.audience),
    hook: text(value.hook),
    mustKeep: text(value.mustKeep),
    lockedNotes: text(value.lockedNotes),
    avoid: text(value.avoid),
    targetLength: text(value.targetLength).trim() ? text(value.targetLength) : base.targetLength,
    chapterWords: Number.isInteger(chapterWords) && chapterWords >= 500 && chapterWords <= 20000 ? chapterWords : base.chapterWords,
    updateCadence: text(value.updateCadence).trim() ? text(value.updateCadence) : base.updateCadence,
    protagonistGoal: text(value.protagonistGoal),
    obstacle: text(value.obstacle),
    readingExperience: text(value.readingExperience),
    targetChapterCount: positiveInt(value.targetChapterCount, 2000),
    volumeCount: positiveInt(value.volumeCount, 50),
  };
}

function positiveInt(value: unknown, max: number): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= max ? number : undefined;
}

export interface Checkpoint {
  runId: string;
  targetChapter: number;
  nextChapter: number;
  phase: 'idle' | 'generated' | 'checked' | 'adopted' | 'complete' | 'paused' | 'cancelled';
  candidateIds: Record<number, string>;
  error?: string;
  /** Fencing token of the process currently allowed to commit for this run. */
  leaseToken?: string;
  leaseExpiresAt?: string;
  /** Author request honoured at the next step boundary. */
  control?: 'pause' | 'cancel';
  /** Generation attempt per chapter; a failed attempt never re-serves its candidate. */
  attempts?: Record<number, number>;
  usage?: RunUsage;
}

export class Work {
  readonly id: string;
  title: string;
  covenant: CreativeCovenant = defaultCovenant();
  /** The locked design inputs used to plan future chapters. */
  worldPack?: WorldPack;
  storyBible?: StoryBible;
  readonly candidates = new Map<string, ChapterCandidate>();
  readonly versions = new Map<string, ChapterVersion>();
  readonly manuscripts = new Map<string, ManuscriptRevision>();
  readonly designHistory = new Map<string, DesignRevision>();
  readonly events = new Map<string, StoryEvent>();
  readonly states = new Map<string, CharacterState>();
  readonly relationships = new Map<string, Relationship>();
  readonly characters = new Map<string, Character>();
  readonly worldRules = new Map<string, WorldRule>();
  readonly plotNodes = new Map<string, PlotNode>();
  readonly checkpoints = new Map<string, Checkpoint>();
  readonly impacts: ImpactRecord[] = [];
  /** Immutable book plan revisions; only `activePlanId` drives generation. */
  readonly plans = new Map<string, PlanRevision>();
  activePlanId?: string;
  /** Author-confirmed chapter briefs. Derived briefs are recomputed, not stored. */
  readonly briefs = new Map<string, ChapterBrief>();
  /** Append-only covenant revisions with the author's original words. */
  readonly covenantHistory: CovenantRevision[] = [];
  stateRevision = 0;
  /** Advances when author-owned constraints change; story facts keep stateRevision. */
  constraintRevision = 0;

  constructor(title: string, workId = id('work')) {
    this.id = workId;
    this.title = title;
  }

  currentVersion(chapterNumber: number): ChapterVersion | undefined {
    return [...this.versions.values()]
      .filter((version) => version.chapterNumber === chapterNumber && version.status === 'adopted' && !version.stale)
      .sort((a, b) => b.revision - a.revision)[0];
  }

  adoptedVersions(): ChapterVersion[] {
    return [...this.versions.values()]
      .filter((version) => version.status === 'adopted' && !version.stale)
      .sort((a, b) => a.chapterNumber - b.chapterNumber || a.revision - b.revision);
  }

  recordCovenant(covenant: CreativeCovenant, authorText = '', acceptedSuggestions: string[] = []): CovenantRevision {
    const revision: CovenantRevision = {
      id: id('covenant'), revision: (this.covenantHistory.at(-1)?.revision ?? 0) + 1,
      covenant: JSON.parse(JSON.stringify(covenant)) as CreativeCovenant, authorText, acceptedSuggestions: [...acceptedSuggestions], createdAt: now(),
    };
    this.covenant = covenant;
    this.covenantHistory.push(revision);
    return revision;
  }

  recordDesignRevision(kind: DesignRevisionKind, snapshot: WorldPack | StoryBible): DesignRevision {
    const contentHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    const existing = [...this.designHistory.values()].find((item) => item.kind === kind && item.revision === snapshot.revision && item.contentHash === contentHash);
    if (existing) return existing;
    const revision: DesignRevision = {
      id: id(`design_${kind}`), workId: this.id, kind, revision: snapshot.revision,
      status: snapshot.status, contentHash, snapshot: JSON.parse(JSON.stringify(snapshot)) as WorldPack | StoryBible, createdAt: now(),
    };
    this.designHistory.set(revision.id, revision);
    return revision;
  }
}

export class NovelService {
  readonly works = new Map<string, Work>();
  private readonly provider: ModelProvider;
  readonly checkPolicy?: CheckPolicy;

  constructor(provider: ModelProvider, options: { checkPolicy?: CheckPolicy } = {}) {
    this.provider = provider;
    this.checkPolicy = options.checkPolicy;
  }

  createWork(title: string, covenant?: CreativeCovenant): Work {
    const work = new Work(title);
    if (covenant) work.recordCovenant(covenant);
    this.works.set(work.id, work);
    return work;
  }

  setWorldPack(workId: string, worldPack: WorldPack): Work {
    const work = this.getWork(workId);
    work.worldPack = worldPack;
    work.recordDesignRevision('world_pack', worldPack);
    work.constraintRevision += 1;
    return work;
  }

  setStoryBible(workId: string, storyBible: StoryBible): Work {
    const work = this.getWork(workId);
    work.storyBible = storyBible;
    work.recordDesignRevision('story_bible', storyBible);
    work.constraintRevision += 1;
    return work;
  }

  finalizeManuscript(workId: string): ManuscriptRevision {
    const work = this.getWork(workId);
    if (!work.worldPack || !work.storyBible) throw new AdoptionBlocked('world pack and story bible must be locked before finalizing');
    const gate = chapterGenerationGate(work.worldPack, work.storyBible);
    if (!gate.ready) throw new AdoptionBlocked(`manuscript gate blocked: ${gate.errors.join('; ')}`);
    const expectedChapterCount = work.storyBible.volumes.reduce((sum, volume) => sum + volume.plannedChapterCount, 0);
    const adopted = work.adoptedVersions();
    if (adopted.length < expectedChapterCount) throw new AdoptionBlocked(`manuscript requires ${expectedChapterCount} adopted chapters; found ${adopted.length}`);
    const missing = Array.from({ length: expectedChapterCount }, (_, index) => index + 1).filter((chapter) => !work.currentVersion(chapter));
    if (missing.length) throw new AdoptionBlocked(`manuscript has missing chapters: ${missing.join(', ')}`);
    const selected = adopted.filter((version) => version.chapterNumber <= expectedChapterCount);
    if (selected.length !== expectedChapterCount) throw new AdoptionBlocked('manuscript contains stale or duplicate chapter versions');
    const closure = closureCoverageFor(work, expectedChapterCount);
    if (!closure.ready) throw new AdoptionBlocked(`manuscript closure gate blocked: ${closure.errors.join('; ')}`);
    const wordCount = selected.reduce((sum, version) => sum + version.content.trim().length, 0);
    const targetWordCount = work.covenant.chapterWords * expectedChapterCount;
    for (const manuscript of work.manuscripts.values()) manuscript.status = 'superseded';
    const contentHash = createHash('sha256').update(selected.map((version) => `${version.chapterNumber}\n${version.content}`).join('\n')).digest('hex');
    const manuscript: ManuscriptRevision = {
      id: id('manuscript'), workId, revision: Math.max(0, ...[...work.manuscripts.values()].map((item) => item.revision)) + 1,
      status: 'final', chapterVersionIds: selected.map((version) => version.id), chapterCount: selected.length,
      wordCount, targetWordCount, lengthCoverage: targetWordCount > 0 ? wordCount / targetWordCount : 0,
      contentHash, stateRevision: work.stateRevision, constraintRevision: work.constraintRevision,
      worldPackRevision: work.worldPack.revision, storyBibleRevision: work.storyBible.revision, createdAt: now(),
    };
    work.manuscripts.set(manuscript.id, manuscript);
    return manuscript;
  }

  addRelationship(workId: string, input: Omit<Relationship, 'id'>): Relationship {
    const work = this.getWork(workId);
    const relationship: Relationship = { id: id('relationship'), ...input };
    work.relationships.set(relationship.id, relationship);
    return relationship;
  }

  lockRelationship(workId: string, relationshipId: string): void {
    const work = this.getWork(workId);
    const relationship = [...work.relationships.values()].find((item) => item.id === relationshipId);
    if (!relationship) throw new Error(`unknown relationship ${relationshipId}`);
    relationship.locked = true;
  }

  addPlotNode(workId: string, input: Omit<PlotNode, 'id' | 'realization'>): PlotNode {
    const work = this.getWork(workId);
    const node: PlotNode = { id: id('plot'), ...input, realization: { status: 'unrealized', updatedAt: now() } };
    work.plotNodes.set(node.id, node);
    return node;
  }

  contextFor(work: Work, chapterNumber: number, policy: ContextPolicy = {}): ContextManifest {
    return contextManifestFor(work, chapterNumber, policy);
  }

  findRunCandidate(workId: string, chapterNumber: number, runId: string): ChapterCandidate | undefined {
    const work = this.getWork(workId);
    return [...work.candidates.values()].find((candidate) => candidate.runId === runId && candidate.chapterNumber === chapterNumber);
  }

  /** Validates the design/context gate and returns the snapshot a model call should use. */
  prepareGeneration(workId: string, chapterNumber: number): ContextManifest {
    const work = this.getWork(workId);
    const context = this.contextFor(work, chapterNumber);
    if (work.worldPack || work.storyBible) {
      if (!work.worldPack || !work.storyBible) throw new ReadinessError([{ code: 'CANON_NOT_READY', message: 'world pack and story bible must be configured together', nextAction: '补齐并锁定世界包与故事圣经' }]);
      const gate = chapterGenerationGate(work.worldPack, work.storyBible);
      if (!gate.ready) throw new ReadinessError([{ code: 'CANON_NOT_READY', message: `chapter generation gate blocked: ${gate.errors.join('; ')}`, nextAction: '处理设计门禁问题后重新锁定' }]);
    }
    if (context.requiredMaterialStatus !== 'complete') throw new ReadinessError([{ code: 'CONTEXT_INCOMPLETE', message: 'required context is incomplete', nextAction: '补齐必需上下文后重试' }]);
    return context;
  }

  /**
   * Records model output generated against `context`. The candidate keeps the
   * snapshot revisions, so if the work moved on while the model was running the
   * result is kept for reading but adoption rejects it as stale.
   */
  recordCandidate(workId: string, chapterNumber: number, runId: string, context: ContextManifest, generated: GeneratedChapter, origin: CandidateOrigin): ChapterCandidate {
    const work = this.getWork(workId);
    const existing = this.findRunCandidate(workId, chapterNumber, runId);
    if (existing) return existing;
    const candidate: ChapterCandidate = {
      id: id('candidate'), workId, chapterNumber,
      content: generated.content, proposedEvents: generated.proposedEvents, observedEvents: generated.observedEvents,
      runId, generatedAgainstRevision: context.stateRevision, generatedAgainstConstraintRevision: context.constraintRevision,
      generatedAgainstWorldPackRevision: context.worldPackRevision, generatedAgainstStoryBibleRevision: context.storyBibleRevision,
      planRevisionId: context.planRevisionId, brief: context.brief,
      contentHash: contentHashOf(generated.content), origin, usage: generated.usage,
      status: 'candidate', checks: [], checkRuns: [], rulings: [], createdAt: now(),
    };
    work.candidates.set(candidate.id, candidate);
    return candidate;
  }

  generateCandidate(workId: string, chapterNumber: number, runId = id('run')): ChapterCandidate {
    const work = this.getWork(workId);
    const existing = this.findRunCandidate(workId, chapterNumber, runId);
    if (existing) return existing;
    const context = this.prepareGeneration(workId, chapterNumber);
    const generated = this.provider.generateChapter({ work, chapterNumber, context });
    return this.recordCandidate(workId, chapterNumber, runId, context, generated, this.provider.demo ? 'demo' : 'model');
  }

  async generateCandidateAsync(workId: string, chapterNumber: number, runId = id('run')): Promise<ChapterCandidate> {
    const work = this.getWork(workId);
    const existing = this.findRunCandidate(workId, chapterNumber, runId);
    if (existing) return existing;
    const context = this.prepareGeneration(workId, chapterNumber);
    const generated = this.provider.generateChapterAsync
      ? await this.provider.generateChapterAsync({ work, chapterNumber, context })
      : this.provider.generateChapter({ work, chapterNumber, context });
    return this.recordCandidate(workId, chapterNumber, runId, context, generated, this.provider.demo ? 'demo' : 'model');
  }

  runChecks(workId: string, candidateId: string, checkers: CandidateChecker[]): CheckResult[] {
    const work = this.getWork(workId);
    const candidate = this.getCandidate(work, candidateId);
    const byName = new Map(candidate.checks.map((result) => [result.checker, result]));
    const inputs: CheckInputs = {
      stateRevision: work.stateRevision, constraintRevision: work.constraintRevision,
      worldPackRevision: work.worldPack?.revision, storyBibleRevision: work.storyBible?.revision,
    };
    for (const checker of checkers) {
      const result: CheckResult = {
        ...checker.check({ work, candidate }),
        id: id('check'), contentHash: candidate.contentHash, inputs, policyVersion: this.checkPolicy?.version,
      };
      byName.set(checker.name, result);
      candidate.checkRuns.push(result);
    }
    candidate.checks = [...byName.values()];
    return candidate.checks;
  }

  /**
   * Records an author's false-positive ruling on the current result of one
   * check. Only policy-listed checks with a failed/inconclusive result qualify;
   * an unavailable check (for example a missing extraction) cannot be ruled away.
   */
  recordRuling(workId: string, candidateId: string, input: { checkId: string; reason: string; evidence: string }): CheckRuling {
    const work = this.getWork(workId);
    const candidate = this.getCandidate(work, candidateId);
    if (candidate.status !== 'candidate') throw new RulingNotAllowedError('only an open candidate can receive rulings');
    const check = candidate.checks.find((result) => result.id === input.checkId);
    if (!check) throw new RulingNotAllowedError('ruling must reference the current result of a check on this candidate');
    if (!(this.checkPolicy?.overridable ?? []).includes(check.checker)) throw new RulingNotAllowedError(`${check.checker} is a hard constraint and cannot be ruled a false positive`);
    if (check.status !== 'failed' && check.status !== 'inconclusive') throw new RulingNotAllowedError(`a ${check.status} check cannot be ruled a false positive`);
    if (!input.reason.trim() || !input.evidence.trim()) throw new RulingNotAllowedError('a ruling needs both a reason and evidence');
    const ruling: CheckRuling = {
      id: id('ruling'), candidateId, checkId: check.id!, checker: check.checker, decision: 'false_positive',
      reason: input.reason.trim(), evidence: input.evidence.trim(), createdAt: now(),
    };
    candidate.rulings.push(ruling);
    return ruling;
  }

  adoptCandidate(workId: string, candidateId: string): ChapterVersion {
    const work = this.getWork(workId);
    const candidate = this.getCandidate(work, candidateId);
    if (candidate.status === 'adopted' && candidate.adoptedVersionId) return work.versions.get(candidate.adoptedVersionId)!;
    if (candidate.origin === 'demo') throw new DemoCandidateError('demo candidates cannot be adopted into the formal story');
    if (candidate.contentHash !== contentHashOf(candidate.content)) throw new AdoptionBlocked('candidate content does not match its recorded hash');
    this.qualityGate(candidate);
    if (candidate.generatedAgainstRevision !== work.stateRevision || candidate.generatedAgainstConstraintRevision !== work.constraintRevision) throw new StaleCandidateError('candidate context is stale; regenerate or re-check');
    if (candidate.generatedAgainstWorldPackRevision !== work.worldPack?.revision || candidate.generatedAgainstStoryBibleRevision !== work.storyBible?.revision) throw new StaleCandidateError('candidate design inputs are stale; regenerate or re-check');
    if (work.activePlanId && candidate.planRevisionId !== work.activePlanId) throw new StaleCandidateError('candidate was written against a different book plan; regenerate under the approved plan');
    this.verifyChanges(candidate);
    this.verifyLockedRelationships(work, candidate);

    const previous = work.currentVersion(candidate.chapterNumber);
    if (previous) {
      previous.status = 'superseded';
      for (const event of work.events.values()) if (event.chapterVersionId === previous.id) event.active = false;
    }
    const sameChapter = [...work.versions.values()].filter((version) => version.chapterNumber === candidate.chapterNumber);
    const version: ChapterVersion = {
      id: id('version'), workId, chapterNumber: candidate.chapterNumber,
      revision: Math.max(0, ...sameChapter.map((item) => item.revision)) + 1,
      content: candidate.content, status: 'adopted', parentVersionId: previous?.id,
      sourceCandidateId: candidate.id, stale: false, createdAt: now(),
    };
    work.versions.set(version.id, version);
    for (const draft of candidate.proposedEvents) this.appendEvent(work, version, draft);
    candidate.status = 'adopted';
    candidate.adoptedVersionId = version.id;
    work.stateRevision += 1;
    return version;
  }

  editAdoptedChapter(workId: string, chapterNumber: number, content: string, checkers: CandidateChecker[], reason = 'early chapter edited'): ChapterVersion {
    const work = this.getWork(workId);
    const previous = work.currentVersion(chapterNumber);
    if (!previous) throw new Error(`chapter ${chapterNumber} is not adopted`);
    // A content-only edit must preserve the old fact ledger until a dedicated
    // extractor supplies a replacement. Otherwise the edit silently erases
    // power, relationship, item and plot changes from the story state.
    const inheritedEvents: EventDraft[] = [...work.events.values()]
      .filter((event) => event.active && event.chapterVersionId === previous.id)
      .map((event) => ({
        eventType: event.eventType, subjectId: event.subjectId, predicate: event.predicate,
        value: event.value, storyTime: event.storyTime, evidence: event.evidence,
      }));
    const candidate: ChapterCandidate = {
      id: id('candidate'), workId, chapterNumber, content, proposedEvents: inheritedEvents, runId: id('edit'),
      generatedAgainstRevision: work.stateRevision, generatedAgainstConstraintRevision: work.constraintRevision,
      generatedAgainstWorldPackRevision: work.worldPack?.revision, generatedAgainstStoryBibleRevision: work.storyBible?.revision,
      planRevisionId: work.activePlanId,
      contentHash: contentHashOf(content), origin: 'model',
      status: 'candidate', checks: [], checkRuns: [], rulings: [], createdAt: now(),
    };
    work.candidates.set(candidate.id, candidate);
    this.runChecks(workId, candidate.id, checkers);
    const version = this.adoptCandidate(workId, candidate.id);
    const affected = [...work.versions.values()].filter((item) => item.chapterNumber > chapterNumber && !item.stale);
    for (const item of affected) {
      item.stale = true;
      for (const event of work.events.values()) if (event.chapterVersionId === item.id) event.active = false;
    }
    work.impacts.push({ id: id('impact'), changedChapterNumber: chapterNumber, affectedChapterNumbers: [...new Set(affected.map((item) => item.chapterNumber))].sort((a, b) => a - b), reason, createdAt: now() });
    this.rebuildStates(work);
    return version;
  }

  /** Resuming an existing run keeps its original target; a run never widens itself. */
  openCheckpoint(workId: string, targetChapter: number, runId: string): Checkpoint {
    const work = this.getWork(workId);
    let checkpoint = work.checkpoints.get(runId);
    if (!checkpoint) {
      checkpoint = { runId, targetChapter, nextChapter: nextChapterAfterAdopted(work), phase: 'idle', candidateIds: {} };
      work.checkpoints.set(runId, checkpoint);
    }
    checkpoint.error = undefined;
    return checkpoint;
  }

  runUntil(workId: string, targetChapter: number, checkers: CandidateChecker[], runId = id('run')): Checkpoint {
    const work = this.getWork(workId);
    const checkpoint = this.openCheckpoint(workId, targetChapter, runId);
    while (checkpoint.nextChapter <= checkpoint.targetChapter) {
      const chapter = checkpoint.nextChapter;
      const candidate = checkpoint.candidateIds[chapter]
        ? this.getCandidate(work, checkpoint.candidateIds[chapter])
        : this.generateCandidate(workId, chapter, runId);
      checkpoint.candidateIds[chapter] = candidate.id;
      checkpoint.phase = 'generated';
      this.runChecks(workId, candidate.id, checkers);
      checkpoint.phase = 'checked';
      this.adoptCandidate(workId, candidate.id);
      checkpoint.nextChapter = chapter + 1;
      checkpoint.phase = 'adopted';
    }
    checkpoint.phase = 'complete';
    return checkpoint;
  }

  private appendEvent(work: Work, version: ChapterVersion, draft: EventDraft): StoryEvent {
    const event: StoryEvent = {
      id: id('event'), workId: work.id, chapterVersionId: version.id, chapterNumber: version.chapterNumber,
      eventType: draft.eventType, subjectId: draft.subjectId, predicate: draft.predicate, value: draft.value,
      storyTime: draft.storyTime, evidence: draft.evidence ?? '', active: true,
    };
    work.events.set(event.id, event);
    if (draft.eventType === 'character_state') {
      work.states.set(`${draft.subjectId}|${draft.predicate}`, {
        characterId: draft.subjectId, field: draft.predicate, value: draft.value,
        sourceEventId: event.id, sourceChapterVersionId: version.id, storyTime: draft.storyTime,
      });
    }
    if (draft.plotNodeId) {
      const node = work.plotNodes.get(draft.plotNodeId);
      if (node) node.realization = { status: 'realized', chapterVersionId: version.id, evidence: draft.evidence, updatedAt: now() };
    }
    return event;
  }

  private rebuildStates(work: Work): void {
    rebuildCharacterStates(work);
  }

  private verifyChanges(candidate: ChapterCandidate): void {
    if (!candidate.observedEvents) return;
    const proposed = new Set(candidate.proposedEvents.map(eventKey));
    const observed = new Set(candidate.observedEvents.map(eventKey));
    if (proposed.size !== observed.size || [...proposed].some((item) => !observed.has(item))) throw new AdoptionBlocked('declared and observed changes do not match');
  }

  private verifyLockedRelationships(work: Work, candidate: ChapterCandidate): void {
    for (const event of candidate.proposedEvents.filter((item) => item.eventType === 'relationship_change')) {
      const setting = work.relationships.get(event.subjectId);
      const seed = work.storyBible?.relationships.find((relationship) => relationship.id === event.subjectId);
      const policy = setting ? lockPolicyOf(setting) : seed ? lockPolicyOf(seed) : 'evolvable';
      if (forbidsEventChange(policy)) throw new LockedConstraintError(`relationship ${event.subjectId} may not be changed by story events (${policy})`);
    }
  }

  private qualityGate(candidate: ChapterCandidate): void {
    if (!candidate.checks.length) throw new QualityGateError('no quality checks have completed');
    const current = candidate.checks.filter((result) => !result.contentHash || result.contentHash === candidate.contentHash);
    const missing = (this.checkPolicy?.required ?? []).filter((name) => !current.some((result) => result.checker === name));
    if (missing.length) throw new QualityGateError(`quality gate blocked: required checks missing: ${missing.join(', ')}`);
    const overridable = new Set(this.checkPolicy?.overridable ?? []);
    const ruledAway = (result: CheckResult) => overridable.has(result.checker)
      && (result.status === 'failed' || result.status === 'inconclusive')
      && candidate.rulings.some((ruling) => ruling.checkId === result.id);
    const blocked = current.filter((result) => result.status !== 'passed' && !ruledAway(result));
    if (blocked.length) throw new QualityGateError(`quality gate blocked: ${blocked.map((item) => `${item.checker}:${item.status}`).join(', ')}`);
  }

  private getWork(workId: string): Work {
    const work = this.works.get(workId);
    if (!work) throw new Error(`unknown work ${workId}`);
    return work;
  }

  private getCandidate(work: Work, candidateId: string): ChapterCandidate {
    const candidate = work.candidates.get(candidateId);
    if (!candidate) throw new Error(`unknown candidate ${candidateId}`);
    return candidate;
  }
}

/** Requires every seeded arc/secret/promise/thread to leave a final adopted event. */
export function closureCoverageFor(work: Work, chapterNumber: number): ClosureCoverage {
  const bible = work.storyBible;
  const expected = {
    volumes: bible?.volumes.length ?? 0,
    arcs: bible?.arcs.length ?? 0,
    secrets: bible?.secrets?.length ?? 0,
    promises: bible?.promises?.length ?? 0,
    threads: bible?.openThreads?.length ?? 0,
  };
  const errors: string[] = [];
  const active = [...work.events.values()].filter((event) => event.active && event.chapterNumber <= chapterNumber);
  const finalValue = (eventType: string, subjectId: string) => active
    .filter((event) => event.eventType === eventType && event.subjectId === subjectId)
    .sort((a, b) => a.chapterNumber - b.chapterNumber || a.id.localeCompare(b.id))
    .at(-1)?.value;
  const statusOf = (value: unknown) => value && typeof value === 'object' && 'status' in value ? String((value as { status?: unknown }).status) : '';
  let volumes = 0;
  for (const volume of bible?.volumes ?? []) {
    const status = statusOf(finalValue('volume_progress', volume.id));
    if (status === 'resolved' || status === 'diverged') volumes += 1;
    else errors.push(`volume ${volume.id} has no resolved or diverged evidence`);
  }
  let arcs = 0;
  for (const arc of bible?.arcs ?? []) {
    const status = statusOf(finalValue('arc_progress', arc.id));
    if (status === 'resolved' || status === 'diverged') arcs += 1;
    else errors.push(`arc ${arc.id} has no resolved or diverged evidence`);
  }
  let secrets = 0;
  for (const secret of bible?.secrets ?? []) {
    if (active.some((event) => event.eventType === 'secret_reveal' && event.subjectId === secret.id)) secrets += 1;
    else errors.push(`secret ${secret.id} has no reveal evidence`);
  }
  let promises = 0;
  for (const promise of bible?.promises ?? []) {
    const status = statusOf(finalValue('promise_payoff', promise.id));
    if (status === 'paid' || status === 'broken') promises += 1;
    else errors.push(`promise ${promise.id} remains open`);
  }
  let threads = 0;
  for (const thread of bible?.openThreads ?? []) {
    if (statusOf(finalValue('thread_resolution', thread.id)) === 'resolved') threads += 1;
    else errors.push(`thread ${thread.id} has no resolved evidence`);
  }
  return { ready: errors.length === 0, errors, resolved: { volumes, arcs, secrets, promises, threads }, expected };
}

/** Builds the exact context manifest used for a chapter. This is exported so
 * the quality API can show the same selection that the writer received. */
export function contextManifestFor(work: Work, chapterNumber: number, policy: ContextPolicy = {}): ContextManifest {
  const maxEvents = policy.maxEvents ?? 240;
  const maxVersions = policy.maxVersions ?? 40;
  const contextBudget = policy.contextBudget ?? 120_000;
  const allVersions = work.adoptedVersions().filter((version) => version.chapterNumber < chapterNumber);
  const versions = allVersions.slice(-maxVersions);
  const allEvents = [...work.events.values()].filter((event) => event.active && event.chapterNumber < chapterNumber);
  const latestByState = new Map<string, StoryEvent>();
  for (const event of allEvents) {
    if (event.eventType !== 'character_state' && event.eventType !== 'knowledge_belief') continue;
    latestByState.set(`${event.eventType}|${event.subjectId}|${event.predicate}`, event);
  }
  const selected = new Map<string, StoryEvent>();
  for (const event of [...latestByState.values()].sort((a, b) => a.chapterNumber - b.chapterNumber)) selected.set(event.id, event);
  for (const event of allEvents.slice().sort((a, b) => b.chapterNumber - a.chapterNumber || b.id.localeCompare(a.id))) {
    if (selected.size >= maxEvents) break;
    selected.set(event.id, event);
  }
  const events = [...selected.values()].sort((a, b) => a.chapterNumber - b.chapterNumber || a.id.localeCompare(b.id));
  const omittedOptionalMaterial: string[] = [];
  if (allVersions.length > versions.length) omittedOptionalMaterial.push(`older chapter versions omitted: ${allVersions.length - versions.length}`);
  if (allEvents.length > events.length) omittedOptionalMaterial.push(`older events omitted: ${allEvents.length - events.length}`);
  const estimatedTokens = Math.ceil((versions.reduce((sum, version) => sum + version.content.length, 0) + events.reduce((sum, event) => sum + JSON.stringify(event).length, 0)) / 4);
  const canonHash = createHash('sha256').update(JSON.stringify({ worldPack: work.worldPack, storyBible: work.storyBible, covenant: work.covenant })).digest('hex');
  const stateHash = createHash('sha256').update(JSON.stringify(events.map((event) => [event.id, event.value]))).digest('hex');
  return {
    workId: work.id,
    chapterNumber,
    stateRevision: work.stateRevision,
    constraintRevision: work.constraintRevision,
    worldPackRevision: work.worldPack?.revision,
    storyBibleRevision: work.storyBible?.revision,
    planRevisionId: activePlan(work)?.id,
    brief: effectiveBrief(work, chapterNumber)?.brief,
    adoptedVersionIds: versions.map((version) => version.id),
    includedEventIds: events.map((event) => event.id),
    requiredMaterialStatus: estimatedTokens > contextBudget ? 'needs_split' : 'complete',
    omittedOptionalMaterial,
    estimatedTokens,
    contextBudget,
    canonHash,
    stateHash,
    createdAt: now(),
  };
}

/** Rebuilds the character-state projection from active events. Used by repositories after loading a work aggregate. */
export function rebuildCharacterStates(work: Work): void {
  work.states.clear();
  for (const event of [...work.events.values()].filter((item) => item.active).sort((a, b) => a.chapterNumber - b.chapterNumber)) {
    if (event.eventType === 'character_state') work.states.set(`${event.subjectId}|${event.predicate}`, {
      characterId: event.subjectId, field: event.predicate, value: event.value,
      sourceEventId: event.id, sourceChapterVersionId: event.chapterVersionId, storyTime: event.storyTime,
    });
  }
}

/** Returns the latest active character fact visible at the requested story chapter. */
export function characterStateAt(work: Work, characterId: string, field: string, chapterNumber: number): CharacterState | undefined {
  const event = [...work.events.values()]
    .filter((item) => item.active && item.eventType === 'character_state' && item.subjectId === characterId && item.predicate === field && item.chapterNumber <= chapterNumber)
    .sort((a, b) => a.chapterNumber - b.chapterNumber || a.id.localeCompare(b.id))
    .at(-1);
  if (!event) return undefined;
  return {
    characterId, field, value: event.value, sourceEventId: event.id,
    sourceChapterVersionId: event.chapterVersionId, storyTime: event.storyTime,
  };
}

/** Returns what a character believed about a proposition at a story chapter. */
export function knowledgeAt(work: Work, characterId: string, proposition: string, chapterNumber: number): CharacterKnowledge | undefined {
  const event = [...work.events.values()]
    .filter((item) => item.active && item.eventType === 'knowledge_belief' && item.subjectId === characterId && item.predicate === proposition && item.chapterNumber <= chapterNumber)
    .sort((a, b) => a.chapterNumber - b.chapterNumber || a.id.localeCompare(b.id))
    .at(-1);
  if (!event) return undefined;
  const raw = event.value && typeof event.value === 'object' ? event.value as Record<string, unknown> : {};
  return {
    characterId, subjectId: typeof raw.subjectId === 'string' ? raw.subjectId : '', proposition,
    belief: 'belief' in raw ? raw.belief : event.value, sourceEventId: event.id,
    sourceChapterVersionId: event.chapterVersionId, storyTime: event.storyTime,
  };
}

/** Reconstructs a planned character arc from adopted arc_progress events. */
export function storyArcAt(work: Work, arcId: string, chapterNumber: number): StoryArcState | undefined {
  const event = [...work.events.values()]
    .filter((item) => item.active && item.eventType === 'arc_progress' && item.subjectId === arcId && item.chapterNumber <= chapterNumber)
    .sort((a, b) => a.chapterNumber - b.chapterNumber || a.id.localeCompare(b.id))
    .at(-1);
  if (!event) return undefined;
  const value = event.value && typeof event.value === 'object' ? event.value as Record<string, unknown> : {};
  const rawStatus = value.status;
  const status: StoryArcState['status'] = rawStatus === 'active' || rawStatus === 'resolved' || rawStatus === 'diverged' ? rawStatus : 'planned';
  return { arcId, status, value: event.value, sourceEventId: event.id, sourceChapterVersionId: event.chapterVersionId, storyTime: event.storyTime };
}

/** Reconstructs whether a secret was revealed by the requested chapter. */
export function storySecretAt(work: Work, secretId: string, chapterNumber: number): StorySecretState | undefined {
  const event = [...work.events.values()]
    .filter((item) => item.active && item.eventType === 'secret_reveal' && item.subjectId === secretId && item.chapterNumber <= chapterNumber)
    .sort((a, b) => a.chapterNumber - b.chapterNumber || a.id.localeCompare(b.id))
    .at(-1);
  if (!event) return undefined;
  return { secretId, revealed: true, value: event.value, sourceEventId: event.id, sourceChapterVersionId: event.chapterVersionId, storyTime: event.storyTime };
}

export function storyPromiseAt(work: Work, promiseId: string, chapterNumber: number): StoryPromiseState | undefined {
  const event = [...work.events.values()]
    .filter((item) => item.active && item.eventType === 'promise_payoff' && item.subjectId === promiseId && item.chapterNumber <= chapterNumber)
    .sort((a, b) => a.chapterNumber - b.chapterNumber || a.id.localeCompare(b.id)).at(-1);
  if (!event) return undefined;
  const raw = event.value && typeof event.value === 'object' ? event.value as Record<string, unknown> : {};
  const status: StoryPromiseState['status'] = raw.status === 'broken' ? 'broken' : raw.status === 'open' ? 'open' : 'paid';
  return { promiseId, status, value: event.value, sourceEventId: event.id, sourceChapterVersionId: event.chapterVersionId, storyTime: event.storyTime };
}

export function storyThreadAt(work: Work, threadId: string, chapterNumber: number): StoryThreadState | undefined {
  const event = [...work.events.values()]
    .filter((item) => item.active && item.eventType === 'thread_resolution' && item.subjectId === threadId && item.chapterNumber <= chapterNumber)
    .sort((a, b) => a.chapterNumber - b.chapterNumber || a.id.localeCompare(b.id)).at(-1);
  if (!event) return undefined;
  const raw = event.value && typeof event.value === 'object' ? event.value as Record<string, unknown> : {};
  const status: StoryThreadState['status'] = raw.status === 'deferred' ? 'deferred' : raw.status === 'open' ? 'open' : 'resolved';
  return { threadId, status, value: event.value, sourceEventId: event.id, sourceChapterVersionId: event.chapterVersionId, storyTime: event.storyTime };
}

/** Reconstructs whether a volume's planned end state has been evidenced. */
export function storyVolumeAt(work: Work, volumeId: string, chapterNumber: number): StoryVolumeState | undefined {
  const event = [...work.events.values()]
    .filter((item) => item.active && item.eventType === 'volume_progress' && item.subjectId === volumeId && item.chapterNumber <= chapterNumber)
    .sort((a, b) => a.chapterNumber - b.chapterNumber || a.id.localeCompare(b.id)).at(-1);
  if (!event) return undefined;
  const raw = event.value && typeof event.value === 'object' ? event.value as Record<string, unknown> : {};
  const rawStatus = raw.status;
  const status: StoryVolumeState['status'] = rawStatus === 'active' || rawStatus === 'resolved' || rawStatus === 'diverged' ? rawStatus : 'planned';
  return { volumeId, status, value: event.value, sourceEventId: event.id, sourceChapterVersionId: event.chapterVersionId, storyTime: event.storyTime };
}

function valueStateAt(work: Work, eventType: string, subjectId: string, field: string, chapterNumber: number): StoryValueState | undefined {
  const event = [...work.events.values()]
    .filter((item) => item.active && item.eventType === eventType && item.subjectId === subjectId && item.predicate === field && item.chapterNumber <= chapterNumber)
    .sort((a, b) => a.chapterNumber - b.chapterNumber || a.id.localeCompare(b.id)).at(-1);
  if (!event) return undefined;
  return { subjectId, field, value: event.value, sourceEventId: event.id, sourceChapterVersionId: event.chapterVersionId, storyTime: event.storyTime };
}

/** Reconstructs resource and artifact changes without mutating world canon. */
export function resourceStateAt(work: Work, resourceId: string, field: string, chapterNumber: number): StoryValueState | undefined {
  return valueStateAt(work, 'resource_change', resourceId, field, chapterNumber);
}

export function artifactStateAt(work: Work, artifactId: string, field: string, chapterNumber: number): StoryValueState | undefined {
  return valueStateAt(work, 'artifact_change', artifactId, field, chapterNumber);
}

/** Reconstructs a relationship value at a chapter without mutating the author seed. */
export function relationshipAt(work: Work, relationshipId: string, chapterNumber: number): Relationship | undefined {
  const setting = work.relationships.get(relationshipId);
  const seed = work.storyBible?.relationships.find((relationship) => relationship.id === relationshipId);
  const base: Relationship | undefined = setting ?? (seed ? {
    id: seed.id, fromCharacterId: seed.fromCharacterId, toCharacterId: seed.toCharacterId,
    kind: seed.kind, value: seed.value, locked: seed.locked,
    layer: seed.kind === 'belief' ? 'belief' : 'objective', sinceChapter: seed.sinceChapter,
  } : undefined);
  if (!base) return undefined;
  const change = [...work.events.values()]
    .filter((item) => item.active && item.eventType === 'relationship_change' && item.subjectId === relationshipId && item.chapterNumber <= chapterNumber)
    .sort((a, b) => a.chapterNumber - b.chapterNumber || a.id.localeCompare(b.id))
    .at(-1);
  if (!change) return { ...base };
  return { ...base, value: typeof change.value === 'string' ? change.value : JSON.stringify(change.value), sourceEventId: change.id, sinceChapter: base.sinceChapter ?? change.chapterNumber };
}

/**
 * Formal-generation readiness for one chapter. Returns every blocker so the
 * author sees the full list; an empty array means the chapter may be generated.
 */
export function generationReadiness(work: Work, chapterNumber: number, options: { modelConfigured: boolean }): ReadinessBlocker[] {
  const blockers: ReadinessBlocker[] = [];
  if (!options.modelConfigured) blockers.push({ code: 'MODEL_NOT_CONFIGURED', message: 'no production writing model is configured', nextAction: '在系统设置里配置写作模型' });
  if (!isCovenantReady(work.covenant)) blockers.push({ code: 'COVENANT_INCOMPLETE', message: 'creative covenant is incomplete', nextAction: '补全创作约定' });
  if (!work.worldPack || !work.storyBible) {
    blockers.push({ code: 'CANON_NOT_READY', message: 'world pack and story bible must both be locked', nextAction: '完成并锁定世界包与故事圣经' });
  } else {
    const gate = chapterGenerationGate(work.worldPack, work.storyBible);
    if (!gate.ready) blockers.push({ code: 'CANON_NOT_READY', message: `chapter generation gate blocked: ${gate.errors.join('; ')}`, nextAction: '处理设计门禁问题后重新锁定' });
  }
  blockers.push(...planBlockers(work, chapterNumber));
  const missing = Array.from({ length: chapterNumber - 1 }, (_, index) => index + 1).filter((chapter) => !work.currentVersion(chapter));
  if (missing.length) blockers.push({ code: 'CHAPTER_PREREQUISITE_MISSING', message: `previous chapters are not adopted: ${missing.join(', ')}`, nextAction: `先采用第 ${missing[0]} 章` });
  else if (contextManifestFor(work, chapterNumber).requiredMaterialStatus !== 'complete') blockers.push({ code: 'CONTEXT_INCOMPLETE', message: 'required context is incomplete', nextAction: '补齐必需上下文后重试' });
  return blockers;
}

function nextChapterAfterAdopted(work: Work): number {
  let next = 1;
  while (work.currentVersion(next)) next += 1;
  return next;
}

function eventKey(event: EventDraft): string {
  return JSON.stringify([event.eventType, event.subjectId, event.predicate, event.value]);
}

export const passChecker: CandidateChecker = {
  name: 'deterministic_rules',
  check: ({ candidate }) => ({ checker: 'deterministic_rules', status: candidate.content.trim() ? 'passed' : 'failed', message: candidate.content.trim() ? 'ok' : 'empty chapter', candidateId: candidate.id, checkedAt: now() }),
};

/** Requires the writer's independent observed-event extraction to agree with
 * the declared changes before the candidate can be adopted. */
export const observedEventsChecker: CandidateChecker = {
  name: 'observed_events',
  check: ({ candidate }) => {
    if (!candidate.observedEvents) return { checker: 'observed_events', status: 'unavailable', message: 'observed event extraction was not returned', candidateId: candidate.id, checkedAt: now() };
    const proposed = new Set(candidate.proposedEvents.map(eventKey));
    const observed = new Set(candidate.observedEvents.map(eventKey));
    const passed = proposed.size === observed.size && [...proposed].every((item) => observed.has(item));
    return { checker: 'observed_events', status: passed ? 'passed' : 'failed', message: passed ? 'declared and observed changes match' : 'declared and observed changes differ', candidateId: candidate.id, checkedAt: now() };
  },
};

/** Checks model-declared facts against the locked design before adoption. */
export const canonConsistencyChecker: CandidateChecker = {
  name: 'canon_consistency',
  check: ({ work, candidate }) => {
    const allowedEventTypes = new Set(['character_state', 'relationship_change', 'knowledge_belief', 'resource_change', 'artifact_change', 'plot_progress', 'volume_progress', 'arc_progress', 'secret_reveal', 'promise_payoff', 'thread_resolution']);
    const characterIds = new Set([
      ...(work.storyBible?.characters.map((character) => character.id) ?? []),
      ...work.characters.keys(),
    ]);
    const relationshipIds = new Set([
      ...(work.storyBible?.relationships.map((relationship) => relationship.id) ?? []),
      ...work.relationships.keys(),
    ]);
    const resourceIds = new Set(work.worldPack?.resources.map((resource) => resource.id) ?? []);
    const artifactIds = new Set(work.worldPack?.artifacts.map((artifact) => artifact.id) ?? []);
    const locationIds = new Set(work.worldPack?.locations.map((location) => location.id) ?? []);
    const realmIds = new Set(work.worldPack?.realms.map((realm) => realm.id) ?? []);
    const plotNodeIds = new Set(work.plotNodes.keys());
    const plan = activePlan(work)?.plan;
    const planNodeIds = new Set([...(plan?.chapters.map((item) => item.id) ?? []), ...(plan?.milestones.map((item) => item.id) ?? [])]);
    const seedOf = (relationshipId: string) => work.storyBible?.relationships.find((relationship) => relationship.id === relationshipId);
    const errors: string[] = [];
    for (const event of candidate.proposedEvents) {
      if (!allowedEventTypes.has(event.eventType)) errors.push(`unsupported event type ${event.eventType}`);
      if (['character_state', 'knowledge_belief'].includes(event.eventType) && characterIds.size && !characterIds.has(event.subjectId)) errors.push(`unknown character ${event.subjectId}`);
      if (event.eventType === 'relationship_change' && relationshipIds.size && !relationshipIds.has(event.subjectId)) errors.push(`unknown relationship ${event.subjectId}`);
      if (event.eventType === 'relationship_change') {
        const setting = work.relationships.get(event.subjectId);
        const seed = seedOf(event.subjectId);
        const owner = setting ?? seed;
        if (owner && forbidsEventChange(lockPolicyOf(owner))) errors.push(`locked relationship ${event.subjectId}`);
      }
      if (event.eventType === 'resource_change' && resourceIds.size && !resourceIds.has(event.subjectId)) errors.push(`unknown resource ${event.subjectId}`);
      if (event.eventType === 'artifact_change' && artifactIds.size && !artifactIds.has(event.subjectId)) errors.push(`unknown artifact ${event.subjectId}`);
      if (event.eventType === 'plot_progress' && (plotNodeIds.size || planNodeIds.size) && !plotNodeIds.has(event.subjectId) && !planNodeIds.has(event.subjectId) && !event.plotNodeId) errors.push(`unknown plot node ${event.subjectId}`);
      if (event.eventType === 'volume_progress' && work.storyBible && !work.storyBible.volumes.some((volume) => volume.id === event.subjectId)) errors.push(`unknown story volume ${event.subjectId}`);
      if (event.eventType === 'arc_progress' && work.storyBible && !work.storyBible.arcs.some((arc) => arc.id === event.subjectId)) errors.push(`unknown story arc ${event.subjectId}`);
      if (event.eventType === 'secret_reveal' && work.storyBible && !(work.storyBible.secrets ?? []).some((secret) => secret.id === event.subjectId)) errors.push(`unknown story secret ${event.subjectId}`);
      if (event.eventType === 'promise_payoff' && work.storyBible && !(work.storyBible.promises ?? []).some((promise) => promise.id === event.subjectId)) errors.push(`unknown story promise ${event.subjectId}`);
      if (event.eventType === 'thread_resolution' && work.storyBible && !(work.storyBible.openThreads ?? []).some((thread) => thread.id === event.subjectId)) errors.push(`unknown story thread ${event.subjectId}`);
      const value = event.value && typeof event.value === 'object' ? event.value as Record<string, unknown> : undefined;
      const referencedValueId = typeof event.value === 'string'
        ? event.value
        : value && typeof value.id === 'string'
          ? value.id
          : value && typeof value.locationId === 'string'
            ? value.locationId
            : value && typeof value.realmId === 'string'
              ? value.realmId
              : undefined;
      if (event.eventType === 'character_state' && ['location', 'locationId'].includes(event.predicate) && locationIds.size && referencedValueId && !locationIds.has(referencedValueId)) errors.push(`unknown location ${referencedValueId}`);
      if (event.eventType === 'character_state' && ['realm', 'realmId', 'powerRealm'].includes(event.predicate) && realmIds.size && referencedValueId && !realmIds.has(referencedValueId)) errors.push(`unknown realm ${referencedValueId}`);
      if (event.eventType === 'arc_progress' && value && !['active', 'resolved', 'diverged'].includes(String(value.status))) errors.push(`invalid arc status for ${event.subjectId}`);
      if (event.eventType === 'volume_progress' && value && !['active', 'resolved', 'diverged'].includes(String(value.status))) errors.push(`invalid volume status for ${event.subjectId}`);
      if (event.eventType === 'promise_payoff' && value && !['paid', 'broken', 'open'].includes(String(value.status))) errors.push(`invalid promise status for ${event.subjectId}`);
      if (event.eventType === 'thread_resolution' && value && !['resolved', 'deferred', 'open'].includes(String(value.status))) errors.push(`invalid thread status for ${event.subjectId}`);
      if (event.storyTime !== undefined && (!Number.isInteger(event.storyTime) || event.storyTime < 0)) errors.push(`invalid story time in ${event.subjectId}`);
    }
    return {
      checker: 'canon_consistency', status: errors.length ? 'failed' : 'passed',
      message: errors.length ? errors.join('; ') : 'all declared facts reference known canon',
      candidateId: candidate.id, checkedAt: now(),
    };
  },
};

export const chapterLengthChecker: CandidateChecker = {
  name: 'chapter_length',
  check: ({ work, candidate }) => {
    const expected = work.covenant.chapterWords;
    // A long-form manuscript cannot reach its promised scale if chapters are
    // routinely emitted as short summaries. Keep a 25% tolerance for model
    // variance while requiring at least three quarters of the covenant target.
    const minimum = Math.max(200, Math.floor(expected * 0.75));
    const passed = candidate.content.trim().length >= minimum;
    return {
      checker: 'chapter_length', status: passed ? 'passed' : 'failed',
      message: passed ? `length ${candidate.content.trim().length}/${expected}` : `chapter is too short (${candidate.content.trim().length}; minimum ${minimum})`,
      candidateId: candidate.id, checkedAt: now(),
    };
  },
};

export const unavailableChecker: CandidateChecker = {
  name: 'semantic_checker',
  check: ({ candidate }) => ({ checker: 'semantic_checker', status: 'unavailable', message: 'checker unavailable', candidateId: candidate.id, checkedAt: now() }),
};
