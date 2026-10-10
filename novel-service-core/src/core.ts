import { createHash, randomUUID } from 'node:crypto';
import { chapterGenerationGate } from './world.ts';
import type { StoryBible, WorldPack } from './world.ts';

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
}

export interface ModelProvider {
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
}

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
  status: CandidateStatus;
  checks: CheckResult[];
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
  contentHash: string;
  stateRevision: number;
  constraintRevision: number;
  worldPackRevision: number;
  storyBibleRevision: number;
  createdAt: string;
}

export type RelationshipLayer = 'objective' | 'belief';

export interface Relationship {
  id: string;
  fromCharacterId: string;
  toCharacterId: string;
  kind: string;
  value: string;
  locked: boolean;
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
  createdAt: string;
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
  resolved: { arcs: number; secrets: number; promises: number; threads: number };
  expected: { arcs: number; secrets: number; promises: number; threads: number };
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
  };
}

export interface Checkpoint {
  runId: string;
  targetChapter: number;
  nextChapter: number;
  phase: 'idle' | 'generated' | 'checked' | 'adopted' | 'complete' | 'paused';
  candidateIds: Record<number, string>;
  error?: string;
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

  constructor(provider: ModelProvider) {
    this.provider = provider;
  }

  createWork(title: string, covenant?: CreativeCovenant): Work {
    const work = new Work(title);
    if (covenant) work.covenant = covenant;
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
    for (const manuscript of work.manuscripts.values()) manuscript.status = 'superseded';
    const contentHash = createHash('sha256').update(selected.map((version) => `${version.chapterNumber}\n${version.content}`).join('\n')).digest('hex');
    const manuscript: ManuscriptRevision = {
      id: id('manuscript'), workId, revision: Math.max(0, ...[...work.manuscripts.values()].map((item) => item.revision)) + 1,
      status: 'final', chapterVersionIds: selected.map((version) => version.id), chapterCount: selected.length,
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

  generateCandidate(workId: string, chapterNumber: number, runId = id('run')): ChapterCandidate {
    const work = this.getWork(workId);
    const existing = [...work.candidates.values()].find((candidate) => candidate.runId === runId && candidate.chapterNumber === chapterNumber);
    if (existing) return existing;
    const context = this.contextFor(work, chapterNumber);
    if (work.worldPack || work.storyBible) {
      if (!work.worldPack || !work.storyBible) throw new AdoptionBlocked('world pack and story bible must be configured together');
      const gate = chapterGenerationGate(work.worldPack, work.storyBible);
      if (!gate.ready) throw new AdoptionBlocked(`chapter generation gate blocked: ${gate.errors.join('; ')}`);
    }
    if (context.requiredMaterialStatus !== 'complete') throw new AdoptionBlocked('required context is incomplete');
    const generated = this.provider.generateChapter({ work, chapterNumber, context });
    const candidate: ChapterCandidate = {
      id: id('candidate'),
      workId,
      chapterNumber,
      content: generated.content,
      proposedEvents: generated.proposedEvents,
      observedEvents: generated.observedEvents,
      runId,
      generatedAgainstRevision: context.stateRevision,
      generatedAgainstConstraintRevision: context.constraintRevision,
      generatedAgainstWorldPackRevision: context.worldPackRevision,
      generatedAgainstStoryBibleRevision: context.storyBibleRevision,
      status: 'candidate',
      checks: [],
      createdAt: now(),
    };
    work.candidates.set(candidate.id, candidate);
    return candidate;
  }

  async generateCandidateAsync(workId: string, chapterNumber: number, runId = id('run')): Promise<ChapterCandidate> {
    const work = this.getWork(workId);
    const existing = [...work.candidates.values()].find((candidate) => candidate.runId === runId && candidate.chapterNumber === chapterNumber);
    if (existing) return existing;
    const context = this.contextFor(work, chapterNumber);
    if (work.worldPack || work.storyBible) {
      if (!work.worldPack || !work.storyBible) throw new AdoptionBlocked('world pack and story bible must be configured together');
      const gate = chapterGenerationGate(work.worldPack, work.storyBible);
      if (!gate.ready) throw new AdoptionBlocked(`chapter generation gate blocked: ${gate.errors.join('; ')}`);
    }
    if (context.requiredMaterialStatus !== 'complete') throw new AdoptionBlocked('required context is incomplete');
    const generated = this.provider.generateChapterAsync
      ? await this.provider.generateChapterAsync({ work, chapterNumber, context })
      : this.provider.generateChapter({ work, chapterNumber, context });
    const candidate: ChapterCandidate = {
      id: id('candidate'), workId, chapterNumber,
      content: generated.content, proposedEvents: generated.proposedEvents, observedEvents: generated.observedEvents,
      runId, generatedAgainstRevision: context.stateRevision, generatedAgainstConstraintRevision: context.constraintRevision,
      generatedAgainstWorldPackRevision: context.worldPackRevision, generatedAgainstStoryBibleRevision: context.storyBibleRevision,
      status: 'candidate', checks: [], createdAt: now(),
    };
    work.candidates.set(candidate.id, candidate);
    return candidate;
  }

  runChecks(workId: string, candidateId: string, checkers: CandidateChecker[]): CheckResult[] {
    const work = this.getWork(workId);
    const candidate = this.getCandidate(work, candidateId);
    const byName = new Map(candidate.checks.map((result) => [result.checker, result]));
    for (const checker of checkers) byName.set(checker.name, checker.check({ work, candidate }));
    candidate.checks = [...byName.values()];
    return candidate.checks;
  }

  adoptCandidate(workId: string, candidateId: string): ChapterVersion {
    const work = this.getWork(workId);
    const candidate = this.getCandidate(work, candidateId);
    if (candidate.status === 'adopted' && candidate.adoptedVersionId) return work.versions.get(candidate.adoptedVersionId)!;
    this.qualityGate(candidate);
    if (candidate.generatedAgainstRevision !== work.stateRevision || candidate.generatedAgainstConstraintRevision !== work.constraintRevision) throw new StaleCandidateError('candidate context is stale; regenerate or re-check');
    if (candidate.generatedAgainstWorldPackRevision !== work.worldPack?.revision || candidate.generatedAgainstStoryBibleRevision !== work.storyBible?.revision) throw new StaleCandidateError('candidate design inputs are stale; regenerate or re-check');
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
      status: 'candidate', checks: [], createdAt: now(),
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

  runUntil(workId: string, targetChapter: number, checkers: CandidateChecker[], runId = id('run')): Checkpoint {
    const work = this.getWork(workId);
    let checkpoint = work.checkpoints.get(runId);
    if (!checkpoint) {
      checkpoint = { runId, targetChapter, nextChapter: nextChapterAfterAdopted(work), phase: 'idle', candidateIds: {} };
      work.checkpoints.set(runId, checkpoint);
    } else checkpoint.targetChapter = Math.max(checkpoint.targetChapter, targetChapter);
    checkpoint.error = undefined;
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

  async runUntilAsync(workId: string, targetChapter: number, checkers: CandidateChecker[], runId = id('run')): Promise<Checkpoint> {
    const work = this.getWork(workId);
    let checkpoint = work.checkpoints.get(runId);
    if (!checkpoint) {
      checkpoint = { runId, targetChapter, nextChapter: nextChapterAfterAdopted(work), phase: 'idle', candidateIds: {} };
      work.checkpoints.set(runId, checkpoint);
    } else checkpoint.targetChapter = Math.max(checkpoint.targetChapter, targetChapter);
    checkpoint.error = undefined;
    while (checkpoint.nextChapter <= checkpoint.targetChapter) {
      const chapter = checkpoint.nextChapter;
      const candidate = checkpoint.candidateIds[chapter]
        ? this.getCandidate(work, checkpoint.candidateIds[chapter])
        : await this.generateCandidateAsync(workId, chapter, runId);
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
      const locked = [...work.relationships.values()].find((relationship) => relationship.id === event.subjectId && relationship.locked);
      if (locked) throw new LockedConstraintError(`relationship ${locked.id} is locked`);
    }
  }

  private qualityGate(candidate: ChapterCandidate): void {
    if (!candidate.checks.length) throw new AdoptionBlocked('no quality checks have completed');
    const blocked = candidate.checks.filter((result) => result.status !== 'passed');
    if (blocked.length) throw new AdoptionBlocked(`quality gate blocked: ${blocked.map((item) => `${item.checker}:${item.status}`).join(', ')}`);
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
  return { ready: errors.length === 0, errors, resolved: { arcs, secrets, promises, threads }, expected };
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
    const allowedEventTypes = new Set(['character_state', 'relationship_change', 'knowledge_belief', 'resource_change', 'artifact_change', 'plot_progress', 'arc_progress', 'secret_reveal', 'promise_payoff', 'thread_resolution']);
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
    const errors: string[] = [];
    for (const event of candidate.proposedEvents) {
      if (!allowedEventTypes.has(event.eventType)) errors.push(`unsupported event type ${event.eventType}`);
      if (['character_state', 'knowledge_belief'].includes(event.eventType) && characterIds.size && !characterIds.has(event.subjectId)) errors.push(`unknown character ${event.subjectId}`);
      if (event.eventType === 'relationship_change' && relationshipIds.size && !relationshipIds.has(event.subjectId)) errors.push(`unknown relationship ${event.subjectId}`);
      if (event.eventType === 'relationship_change' && (
        work.relationships.get(event.subjectId)?.locked
        || work.storyBible?.relationships.some((relationship) => relationship.id === event.subjectId && relationship.locked)
      )) errors.push(`locked relationship ${event.subjectId}`);
      if (event.eventType === 'resource_change' && resourceIds.size && !resourceIds.has(event.subjectId)) errors.push(`unknown resource ${event.subjectId}`);
      if (event.eventType === 'artifact_change' && artifactIds.size && !artifactIds.has(event.subjectId)) errors.push(`unknown artifact ${event.subjectId}`);
      if (event.eventType === 'plot_progress' && plotNodeIds.size && !plotNodeIds.has(event.subjectId) && !event.plotNodeId) errors.push(`unknown plot node ${event.subjectId}`);
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
    const minimum = Math.max(200, Math.floor(expected * 0.35));
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
