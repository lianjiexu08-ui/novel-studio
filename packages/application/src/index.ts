import { randomUUID } from 'node:crypto';
import { addUsage, AdoptionBlocked, generationReadiness, NovelService, ReadinessError, StaleCandidateError, usageOfError, Work } from '../../../novel-service-core/src/core.ts';
import type {
  CandidateChecker, ChapterCandidate, ChapterVersion, CheckPolicy, CheckRuling, Checkpoint, ContextManifest, CreativeCovenant, GeneratedChapter, ManuscriptRevision, ModelProvider, ReadinessBlocker,
} from '../../../novel-service-core/src/core.ts';
import { lockStoryBible, lockWorldPack, reviewStoryBible, reviewWorldPack } from '../../../novel-service-core/src/world.ts';
import type { StoryBible, WorldPack } from '../../../novel-service-core/src/world.ts';
import {
  activePlan, approvePlanRevision, confirmBrief, createPlanRevision, effectiveBrief, latestPlan, milestonePrerequisites, outlineWindow, PlanGateError, planRealization, reviewPlanRevision,
} from '../../../novel-service-core/src/planning.ts';
import type {
  BookPlan, BriefEdits, ChapterBrief, ChapterOutline, EffectiveBrief, NodeRealization, PlanReview, PlanRevision, PlotMilestone, VolumePlan,
} from '../../../novel-service-core/src/planning.ts';

export interface DesignProvider {
  generateWorldPack(input: { title: string; covenant: CreativeCovenant }): Promise<WorldPack>;
  generateStoryBible(input: { title: string; covenant: CreativeCovenant; worldPack: WorldPack; chapterTarget?: number; previousStoryBible?: StoryBible }): Promise<StoryBible>;
}

/** What has actually been written, so plan expansion builds on adopted text instead of the old blueprint alone. */
export interface AdoptedFacts {
  reachedChapter: number;
  recentChapters: Array<{ chapterNumber: number; excerpt: string }>;
  events: Array<{ chapterNumber: number; eventType: string; subjectId: string; predicate: string; value: unknown; evidence: string }>;
  realization: NodeRealization[];
}

export type PlanSkeleton = Omit<BookPlan, 'chapters'>;

export interface PlanningInput {
  title: string;
  covenant: CreativeCovenant;
  worldPack?: WorldPack;
  storyBible?: StoryBible;
  adoptedFacts: AdoptedFacts;
  authorRequest?: string;
}

/** Model-backed planner. Its output only ever becomes a proposed plan revision. */
export interface PlanProvider {
  generatePlanSkeleton(input: PlanningInput & { targetChapterCount: number; volumeCount: number; previousPlan?: BookPlan }): Promise<PlanSkeleton>;
  generateChapterOutlines(input: PlanningInput & { skeleton: PlanSkeleton; from: number; to: number; before: ChapterOutline[]; after: ChapterOutline[] }): Promise<ChapterOutline[]>;
}

export class PlanProviderMissingError extends Error {}

export interface CovenantImpact {
  covenantChanged: boolean;
  /** Open candidates written under the old covenant; they can no longer be adopted. */
  staleCandidateIds: string[];
  /** The approved plan the author should re-check against the new covenant. */
  planToRecheck?: string;
}

export interface NextChapterPreparation {
  chapterNumber: number;
  blockers: ReadinessBlocker[];
  brief?: EffectiveBrief;
  volume?: VolumePlan;
  /** The next climax and which of its must-prerequisites are still missing. */
  nextClimax?: { milestone: PlotMilestone; missing: string[] };
  planRevisionId?: string;
}

export type OutboxKind = 'projection' | 'search_index' | 'export' | 'publication_check';

export interface OutboxEvent {
  id: string;
  dedupeKey: string;
  workId: string;
  kind: OutboxKind;
  aggregateId: string;
  payload: Record<string, unknown>;
  publishedAt?: string;
  attempts: number;
  createdAt: string;
}

export interface WorkTransaction {
  work: Work;
  enqueue(event: Omit<OutboxEvent, 'id' | 'createdAt' | 'attempts'>): OutboxEvent;
}

export interface WorkSummary {
  id: string;
  title: string;
  stateRevision: number;
  constraintRevision: number;
  covenant: CreativeCovenant;
}

export interface WorkRepository {
  get(workId: string): Promise<Work | undefined>;
  list(): Promise<WorkSummary[]>;
  save(work: Work): Promise<void> | void;
  transaction<T>(workId: string, callback: (transaction: WorkTransaction) => Promise<T> | T): Promise<T>;
  outbox(): Promise<OutboxEvent[]>;
}

/**
 * Local adapter used by tests and desktop mode. The database adapter should
 * implement the same transaction contract with a real DB transaction.
 */
export class InMemoryWorkRepository implements WorkRepository {
  private readonly works = new Map<string, Work>();
  private readonly events = new Map<string, OutboxEvent>();
  private readonly locks = new Map<string, Promise<void>>();

  async get(workId: string): Promise<Work | undefined> { return this.works.get(workId); }
  async list(): Promise<WorkSummary[]> {
    return [...this.works.values()].map((work) => ({ id: work.id, title: work.title, stateRevision: work.stateRevision, constraintRevision: work.constraintRevision, covenant: work.covenant }));
  }
  save(work: Work): void { this.works.set(work.id, work); }
  async outbox(): Promise<OutboxEvent[]> { return [...this.events.values()].map((event) => ({ ...event, payload: { ...event.payload } })); }

  async transaction<T>(workId: string, callback: (transaction: WorkTransaction) => Promise<T> | T): Promise<T> {
    const previous = this.locks.get(workId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.locks.set(workId, queued);
    await previous;
    try {
      const work = this.works.get(workId);
      if (!work) throw new Error(`unknown work ${workId}`);
      const pending: OutboxEvent[] = [];
      const transaction: WorkTransaction = {
        work,
        enqueue: (input) => {
          const existing = [...this.events.values(), ...pending].find((event) => event.dedupeKey === input.dedupeKey);
          if (existing) return existing;
          const event: OutboxEvent = { ...input, id: `outbox_${randomUUID().replaceAll('-', '')}`, createdAt: new Date().toISOString(), attempts: 0 };
          pending.push(event);
          return event;
        },
      };
      const result = await callback(transaction);
      this.save(work);
      for (const event of pending) this.events.set(event.id, event);
      return result;
    } finally {
      release();
      if (this.locks.get(workId) === queued) this.locks.delete(workId);
    }
  }
}

export interface AdoptionResult {
  version: ChapterVersion;
  outbox: OutboxEvent[];
}

export type GenerationMode = 'formal' | 'demo';

export interface WorkflowOptions {
  checkPolicy?: CheckPolicy;
  planProvider?: PlanProvider;
  /** Outline batch size for plan generation (PRD: 5-10 chapters per group). */
  outlineBatchSize?: number;
  /** How long a run may go without committing before another process can take it over. */
  leaseMs?: number;
  now?: () => number;
}

/** Another run (or this run in another process) currently holds the work's lease. */
export class RunInProgressError extends Error {}
/** This process lost its lease; nothing from the current step was committed. */
export class LeaseLostError extends Error {}
export class RunCancelledError extends Error {}
/** The same idempotency key was reused for a different request. */
export class IdempotencyConflictError extends Error {}

function runCandidateKey(runId: string, chapterNumber: number, attempt: number): string {
  return `${runId}#${chapterNumber}.${attempt}`;
}

export class ChapterWorkflow {
  private readonly service: NovelService;
  private readonly repository: WorkRepository;
  private provider: ModelProvider;
  private designProvider?: DesignProvider;
  private readonly leaseMs: number;
  private readonly now: () => number;
  private planProvider?: PlanProvider;
  private readonly outlineBatchSize: number;

  constructor(repository: WorkRepository, provider: ModelProvider, designProvider?: DesignProvider, options: WorkflowOptions = {}) {
    this.repository = repository;
    this.provider = provider;
    this.service = new NovelService(provider, { checkPolicy: options.checkPolicy });
    this.designProvider = designProvider;
    this.leaseMs = options.leaseMs ?? 5 * 60_000;
    this.now = options.now ?? (() => Date.now());
    this.planProvider = options.planProvider;
    this.outlineBatchSize = Math.min(10, Math.max(5, options.outlineBatchSize ?? 10));
  }

  get planningConfigured(): boolean { return Boolean(this.planProvider); }

  /** Swaps the live model connections. The next chapter, plan or design call uses them. */
  applyModelProviders(provider: ModelProvider, designProvider?: DesignProvider, planProvider?: PlanProvider): void {
    this.provider = provider;
    this.designProvider = designProvider;
    this.planProvider = planProvider;
  }

  private async snapshot(workId: string): Promise<Work> {
    const work = await this.repository.get(workId);
    if (!work) throw new Error(`unknown work ${workId}`);
    return work;
  }

  private adoptedFacts(work: Work): AdoptedFacts {
    const revision = activePlan(work);
    const reached = revision ? planRealization(work, revision).reachedChapter : work.adoptedVersions().length;
    return {
      reachedChapter: reached,
      recentChapters: work.adoptedVersions().slice(-10).map((version) => ({ chapterNumber: version.chapterNumber, excerpt: version.content.slice(0, 400) })),
      events: [...work.events.values()].filter((event) => event.active).sort((a, b) => a.chapterNumber - b.chapterNumber).slice(-200)
        .map((event) => ({ chapterNumber: event.chapterNumber, eventType: event.eventType, subjectId: event.subjectId, predicate: event.predicate, value: event.value, evidence: event.evidence })),
      realization: revision ? planRealization(work, revision).nodes.filter((node) => node.due || node.evidence.length) : [],
    };
  }

  private planningInput(work: Work, authorRequest?: string): PlanningInput {
    return { title: work.title, covenant: work.covenant, worldPack: work.worldPack, storyBible: work.storyBible, adoptedFacts: this.adoptedFacts(work), authorRequest };
  }

  /** Outlines for [from, to] in groups; each group sees the outlines written before it. */
  private async outlineBatches(input: PlanningInput, skeleton: PlanSkeleton, from: number, to: number, existing: ChapterOutline[]): Promise<ChapterOutline[]> {
    const written: ChapterOutline[] = [];
    for (let start = from; start <= to; start += this.outlineBatchSize) {
      const end = Math.min(to, start + this.outlineBatchSize - 1);
      const before = [...existing.filter((item) => item.chapterNumber < from), ...written].sort((a, b) => a.chapterNumber - b.chapterNumber).slice(-10);
      const after = existing.filter((item) => item.chapterNumber > to).sort((a, b) => a.chapterNumber - b.chapterNumber).slice(0, 5);
      const batch = await this.planProvider!.generateChapterOutlines({ ...input, skeleton, from: start, to: end, before, after });
      written.push(...normalizeOutlineBatch(batch, skeleton, start, end));
    }
    return written;
  }

  /**
   * Generates a whole plan: skeleton, then outlines for the first
   * `min(50, target)` chapters in 5-10 chapter groups. The groups are combined
   * into one proposed revision; nothing is approved here. Outlines of chapters
   * already adopted are carried over from the active plan.
   */
  async generatePlan(workId: string, input: { targetChapterCount: number; volumeCount: number; authorRequest?: string }): Promise<PlanRevision> {
    if (!this.planProvider) throw new PlanProviderMissingError('no planning model is configured');
    const snapshot = await this.snapshot(workId);
    const base = latestPlan(snapshot);
    const previous = activePlan(snapshot);
    const planning = this.planningInput(snapshot, input.authorRequest);
    const skeleton = await this.planProvider.generatePlanSkeleton({ ...planning, targetChapterCount: input.targetChapterCount, volumeCount: input.volumeCount, previousPlan: previous?.plan });
    const kept = (previous?.plan.chapters ?? []).filter((outline) => outline.chapterNumber <= planning.adoptedFacts.reachedChapter && outline.chapterNumber <= skeleton.targetChapterCount);
    const from = kept.length ? Math.max(...kept.map((item) => item.chapterNumber)) + 1 : 1;
    const to = Math.min(skeleton.targetChapterCount, Math.max(outlineWindow(skeleton.targetChapterCount), planning.adoptedFacts.reachedChapter + 10));
    const outlines = from <= to ? await this.outlineBatches(planning, skeleton, from, to, kept) : [];
    return this.repository.transaction(workId, ({ work }) => createPlanRevision(work, { ...skeleton, chapters: [...kept, ...outlines] }, {
      source: 'model', baseRevisionId: base?.id,
      note: input.authorRequest?.trim() ? `模型生成：${input.authorRequest.trim()}` : `模型生成全书计划与第 ${from}-${to} 章章纲`,
    }));
  }

  /**
   * Regenerates (or extends) outlines for one chapter range on top of a base
   * revision. Outlines outside the range are carried over unchanged.
   */
  async generateOutlines(workId: string, input: { baseRevisionId: string; from: number; to: number; authorRequest?: string }): Promise<PlanRevision> {
    if (!this.planProvider) throw new PlanProviderMissingError('no planning model is configured');
    const snapshot = await this.snapshot(workId);
    const base = snapshot.plans.get(input.baseRevisionId);
    if (!base) throw new Error(`unknown plan ${input.baseRevisionId}`);
    const { chapters, ...skeleton } = base.plan;
    if (input.from < 1 || input.to < input.from || input.to > skeleton.targetChapterCount) throw new PlanGateError(`chapter range ${input.from}-${input.to} is outside the planned ${skeleton.targetChapterCount} chapters`);
    if (input.to - input.from + 1 > 20) throw new PlanGateError('regenerate at most 20 chapters at a time');
    const outside = chapters.filter((outline) => outline.chapterNumber < input.from || outline.chapterNumber > input.to);
    const outlines = await this.outlineBatches(this.planningInput(snapshot, input.authorRequest), skeleton, input.from, input.to, outside);
    return this.repository.transaction(workId, ({ work }) => createPlanRevision(work, { ...skeleton, chapters: [...outside, ...outlines] }, {
      source: 'mixed', baseRevisionId: input.baseRevisionId,
      note: `重生成第 ${input.from}-${input.to} 章章纲${input.authorRequest?.trim() ? `：${input.authorRequest.trim()}` : ''}`,
    }));
  }

  /** Author edits: target length, volumes, outlines, milestones. Always a new proposed revision. */
  async savePlan(workId: string, input: { baseRevisionId?: string; plan: BookPlan; note?: string }): Promise<PlanRevision> {
    return this.repository.transaction(workId, ({ work }) => createPlanRevision(work, input.plan, { source: 'author', baseRevisionId: input.baseRevisionId, note: input.note }));
  }

  async reviewPlan(workId: string, planId: string): Promise<PlanReview> {
    return this.repository.transaction(workId, ({ work }) => reviewPlanRevision(work, planId));
  }

  /** Author approval only; no model or run path calls this. Open candidates become stale. */
  async approvePlan(workId: string, planId: string): Promise<PlanRevision> {
    return this.repository.transaction(workId, ({ work }) => approvePlanRevision(work, planId));
  }

  async confirmBrief(workId: string, chapterNumber: number, edits: BriefEdits = {}): Promise<ChapterBrief> {
    return this.repository.transaction(workId, ({ work }) => confirmBrief(work, chapterNumber, edits));
  }

  /** "准备下一章": the next chapter to write, its brief, blockers and what the next climax still lacks. */
  async prepareNextChapter(workId: string): Promise<NextChapterPreparation> {
    const work = await this.snapshot(workId);
    let chapterNumber = 1;
    while (work.currentVersion(chapterNumber)) chapterNumber += 1;
    const revision = activePlan(work);
    const preparation: NextChapterPreparation = {
      chapterNumber,
      blockers: generationReadiness(work, chapterNumber, { modelConfigured: this.modelConfigured }),
      brief: effectiveBrief(work, chapterNumber),
      planRevisionId: revision?.id,
    };
    if (!revision) return preparation;
    preparation.volume = revision.plan.volumes.find((volume) => volume.startChapter <= chapterNumber && volume.endChapter >= chapterNumber);
    const climax = revision.plan.milestones.filter((milestone) => milestone.kind === 'climax' && milestone.endChapter >= chapterNumber).sort((a, b) => a.startChapter - b.startChapter)[0];
    if (climax) {
      const missing = milestonePrerequisites(work, revision, climax.id).filter((dependency) => dependency.requiredness === 'must' && !dependency.satisfied).map((dependency) => dependency.description);
      preparation.nextClimax = { milestone: climax, missing };
    }
    return preparation;
  }

  async planOverview(workId: string): Promise<{ active?: PlanRevision; latest?: PlanRevision; realization?: ReturnType<typeof planRealization> }> {
    const work = await this.snapshot(workId);
    const active = activePlan(work);
    return { active, latest: latestPlan(work), realization: active ? planRealization(work, active) : undefined };
  }

  private liveLeaseHolder(work: Work, except?: { runId: string; token: string }): Checkpoint | undefined {
    const now = this.now();
    return [...work.checkpoints.values()].find((checkpoint) => checkpoint.leaseToken
      && checkpoint.leaseExpiresAt && Date.parse(checkpoint.leaseExpiresAt) > now
      && !(except && checkpoint.runId === except.runId && checkpoint.leaseToken === except.token));
  }

  /** Fencing check run inside every commit of a run step; also extends the lease. */
  private holdLease(work: Work, runId: string, token: string): Checkpoint {
    const checkpoint = work.checkpoints.get(runId);
    if (!checkpoint || checkpoint.leaseToken !== token) throw new LeaseLostError(`run ${runId} no longer holds the work lease`);
    checkpoint.leaseExpiresAt = new Date(this.now() + this.leaseMs).toISOString();
    return checkpoint;
  }

  private releaseLease(checkpoint: Checkpoint): void {
    checkpoint.leaseToken = undefined;
    checkpoint.leaseExpiresAt = undefined;
  }

  get modelConfigured(): boolean { return !this.provider.demo; }

  get checkPolicy(): CheckPolicy | undefined { return this.service.checkPolicy; }

  async readiness(workId: string, chapterNumber: number): Promise<ReadinessBlocker[]> {
    const work = await this.repository.get(workId);
    if (!work) throw new Error(`unknown work ${workId}`);
    return generationReadiness(work, chapterNumber, { modelConfigured: this.modelConfigured });
  }

  private async callModel(work: Work, chapterNumber: number, context: ContextManifest): Promise<GeneratedChapter> {
    return this.provider.generateChapterAsync
      ? this.provider.generateChapterAsync({ work, chapterNumber, context })
      : this.provider.generateChapter({ work, chapterNumber, context });
  }

  /** Design results that arrive after the inputs changed are kept in history only and reported as stale. */
  private async commitDesign<T extends WorldPack | StoryBible>(workId: string, kind: 'world_pack' | 'story_bible', constraintRevision: number, document: T, apply: (work: Work, document: T) => T): Promise<T> {
    const outcome = await this.repository.transaction(workId, ({ work }) => {
      if (work.constraintRevision !== constraintRevision) {
        work.recordDesignRevision(kind, { ...document, status: 'proposed', lockedAt: undefined });
        return { stale: true as const };
      }
      const applied = apply(work, document);
      work.recordDesignRevision(kind, applied);
      work.constraintRevision += 1;
      return { stale: false as const, applied };
    });
    if (outcome.stale) throw new StaleCandidateError(`${kind} inputs changed while generating; the result was kept in design history only`);
    return outcome.applied;
  }

  async createWork(title: string, covenant?: CreativeCovenant): Promise<Work> {
    const work = this.service.createWork(title, covenant);
    await this.repository.save(work);
    return work;
  }

  /** Author edits to settings. They invalidate planned candidates without changing story facts. */
  async editSettings<T>(workId: string, edit: (work: Work) => T): Promise<T> {
    return this.repository.transaction(workId, ({ work }) => {
      const result = edit(work);
      work.constraintRevision += 1;
      return result;
    });
  }

  /**
   * Covenant edits create a new revision with the author's own words. Open
   * candidates become stale (conservatively all of them); adopted chapters are
   * never rewritten.
   */
  async updateWork(workId: string, input: { title: string; covenant: CreativeCovenant; authorText?: string; acceptedSuggestions?: string[] }): Promise<Work> {
    return (await this.updateWorkWithImpact(workId, input)).work;
  }

  async updateWorkWithImpact(workId: string, input: { title: string; covenant: CreativeCovenant; authorText?: string; acceptedSuggestions?: string[] }): Promise<{ work: Work; impact: CovenantImpact }> {
    return this.repository.transaction(workId, ({ work }) => {
      const covenantChanged = JSON.stringify(work.covenant) !== JSON.stringify(input.covenant);
      const staleCandidates = [...work.candidates.values()].filter((candidate) => candidate.status === 'candidate').map((candidate) => candidate.id);
      work.title = input.title;
      if (covenantChanged || input.authorText?.trim()) work.recordCovenant(input.covenant, input.authorText?.trim() ?? '', input.acceptedSuggestions ?? []);
      work.constraintRevision += 1;
      return { work, impact: { covenantChanged, staleCandidateIds: staleCandidates, planToRecheck: covenantChanged ? work.activePlanId : undefined } };
    });
  }

  async saveWorldPack(workId: string, worldPack: WorldPack): Promise<WorldPack> {
    return this.repository.transaction(workId, ({ work }) => {
      // A submitted JSON document never carries review authority. Even if a
      // caller sends reviewed/locked, it must pass the server review endpoint.
      work.worldPack = withServerRevision(work, 'world_pack', { ...worldPack, status: worldPack.status === 'draft' ? 'draft' : 'proposed', lockedAt: undefined });
      work.recordDesignRevision('world_pack', work.worldPack);
      work.constraintRevision += 1;
      return work.worldPack;
    });
  }

  async generateWorldPack(workId: string): Promise<WorldPack> {
    if (!this.designProvider) throw new Error('design provider is not configured');
    const snapshot = await this.repository.get(workId);
    if (!snapshot) throw new Error(`unknown work ${workId}`);
    const constraintRevision = snapshot.constraintRevision;
    const worldPack = await this.designProvider.generateWorldPack({ title: snapshot.title, covenant: snapshot.covenant });
    return this.commitDesign(workId, 'world_pack', constraintRevision, worldPack, (work, document) => {
      work.worldPack = withServerRevision(work, 'world_pack', { ...document, status: 'proposed', lockedAt: undefined });
      return work.worldPack;
    });
  }

  async lockWorldPack(workId: string): Promise<WorldPack> {
    return this.repository.transaction(workId, ({ work }) => {
      if (!work.worldPack) throw new Error('world pack has not been generated');
      work.worldPack = lockWorldPack(work.worldPack);
      work.recordDesignRevision('world_pack', work.worldPack);
      work.constraintRevision += 1;
      return work.worldPack;
    });
  }

  async reviewWorldPack(workId: string): Promise<WorldPack> {
    return this.repository.transaction(workId, ({ work }) => {
      if (!work.worldPack) throw new Error('world pack has not been generated');
      work.worldPack = reviewWorldPack(work.worldPack);
      work.recordDesignRevision('world_pack', work.worldPack);
      work.constraintRevision += 1;
      return work.worldPack;
    });
  }

  async saveStoryBible(workId: string, storyBible: StoryBible): Promise<StoryBible> {
    return this.repository.transaction(workId, ({ work }) => {
      work.storyBible = withServerRevision(work, 'story_bible', { ...storyBible, status: storyBible.status === 'draft' ? 'draft' : 'proposed', lockedAt: undefined });
      work.recordDesignRevision('story_bible', work.storyBible);
      work.constraintRevision += 1;
      return work.storyBible;
    });
  }

  async generateStoryBible(workId: string, chapterTarget?: number, previousStoryBible?: StoryBible): Promise<StoryBible> {
    if (!this.designProvider) throw new Error('design provider is not configured');
    const snapshot = await this.repository.get(workId);
    if (!snapshot) throw new Error(`unknown work ${workId}`);
    if (!snapshot.worldPack) throw new Error('world pack has not been generated');
    const constraintRevision = snapshot.constraintRevision;
    const storyBible = await this.designProvider.generateStoryBible({ title: snapshot.title, covenant: snapshot.covenant, worldPack: snapshot.worldPack, chapterTarget, previousStoryBible });
    return this.commitDesign(workId, 'story_bible', constraintRevision, storyBible, (work, document) => {
      work.storyBible = withServerRevision(work, 'story_bible', {
        ...document, status: 'proposed', lockedAt: undefined,
        worldPackId: work.worldPack?.id ?? document.worldPackId, worldPackRevision: work.worldPack?.revision ?? document.worldPackRevision,
      });
      return work.storyBible;
    });
  }

  async lockStoryBible(workId: string): Promise<StoryBible> {
    return this.repository.transaction(workId, ({ work }) => {
      if (!work.worldPack) throw new Error('world pack has not been generated');
      if (!work.storyBible) throw new Error('story bible has not been generated');
      work.storyBible = lockStoryBible(work.storyBible, work.worldPack);
      work.recordDesignRevision('story_bible', work.storyBible);
      work.constraintRevision += 1;
      return work.storyBible;
    });
  }

  async reviewStoryBible(workId: string): Promise<StoryBible> {
    return this.repository.transaction(workId, ({ work }) => {
      if (!work.worldPack) throw new Error('world pack has not been generated');
      if (!work.storyBible) throw new Error('story bible has not been generated');
      work.storyBible = reviewStoryBible(work.storyBible, work.worldPack);
      work.recordDesignRevision('story_bible', work.storyBible);
      work.constraintRevision += 1;
      return work.storyBible;
    });
  }

  async finalizeManuscript(workId: string): Promise<ManuscriptRevision> {
    return this.repository.transaction(workId, ({ work }) => {
      this.service.works.set(work.id, work);
      return this.service.finalizeManuscript(workId);
    });
  }

  /**
   * Formal generation re-checks readiness on the server; demo generation skips
   * the gate but its candidates can never be adopted. The model call runs
   * outside any database transaction, against a snapshot taken beforehand.
   */
  async generate(workId: string, chapterNumber: number, runId: string, mode: GenerationMode = 'formal'): Promise<ChapterCandidate> {
    const snapshot = await this.repository.get(workId);
    if (!snapshot) throw new Error(`unknown work ${workId}`);
    this.service.works.set(snapshot.id, snapshot);
    const origin = mode === 'demo' || this.provider.demo ? 'demo' : 'model';
    const existing = [...snapshot.candidates.values()].find((candidate) => candidate.runId === runId);
    if (existing) {
      if (existing.chapterNumber !== chapterNumber || existing.origin !== origin) throw new IdempotencyConflictError(`idempotency key ${runId} was already used for a different generation request`);
      return existing;
    }
    let context: ContextManifest;
    if (mode === 'formal') {
      const blockers = generationReadiness(snapshot, chapterNumber, { modelConfigured: this.modelConfigured });
      if (blockers.length) throw new ReadinessError(blockers);
      context = this.service.prepareGeneration(workId, chapterNumber);
    } else {
      context = this.service.contextFor(snapshot, chapterNumber);
    }
    const generated = await this.callModel(snapshot, chapterNumber, context);
    return this.repository.transaction(workId, ({ work }) => {
      this.service.works.set(work.id, work);
      return this.service.recordCandidate(workId, chapterNumber, runId, context, generated, origin);
    });
  }

  /**
   * Continues a run one chapter at a time. Each chapter goes through the same
   * steps as manual work: snapshot, model call outside a transaction, a commit
   * of candidate + checks, then the shared adoption path with its outbox events.
   *
   * The run holds a persisted lease on the work; every commit re-checks the
   * fencing token, so a process that lost the lease cannot commit stale work.
   * Resuming with a different target is an idempotency conflict, never a
   * silent widening. Pause/cancel requests are honoured at step boundaries; a
   * model result that arrives after one is stored but not checked or adopted.
   */
  async runUntil(workId: string, targetChapter: number, checkers: CandidateChecker[], runId: string): Promise<Checkpoint> {
    const token = randomUUID();
    await this.repository.transaction(workId, ({ work }) => {
      this.service.works.set(work.id, work);
      const existing = work.checkpoints.get(runId);
      if (existing && existing.targetChapter !== targetChapter) throw new IdempotencyConflictError(`run ${runId} targets chapter ${existing.targetChapter}; start a new run for a different target`);
      if (existing?.phase === 'cancelled') throw new RunCancelledError(`run ${runId} was cancelled; start a new run`);
      const holder = this.liveLeaseHolder(work);
      if (holder) throw new RunInProgressError(`run ${holder.runId} is already writing this work`);
      const checkpoint = this.service.openCheckpoint(workId, targetChapter, runId);
      checkpoint.control = undefined;
      checkpoint.leaseToken = token;
      checkpoint.leaseExpiresAt = new Date(this.now() + this.leaseMs).toISOString();
    });

    for (;;) {
      let chapter: number | undefined;
      try {
        const step = await this.repository.transaction(workId, ({ work }) => {
          this.service.works.set(work.id, work);
          const checkpoint = this.holdLease(work, runId, token);
          if (checkpoint.control) return { stop: true as const, checkpoint: this.stopRun(checkpoint) };
          if (checkpoint.nextChapter > checkpoint.targetChapter) {
            checkpoint.phase = 'complete';
            this.releaseLease(checkpoint);
            return { stop: true as const, checkpoint: { ...checkpoint } };
          }
          const next = checkpoint.nextChapter;
          const attempt = checkpoint.attempts?.[next] ?? 1;
          const existingId = checkpoint.candidateIds[next] ?? this.service.findRunCandidate(workId, next, runCandidateKey(runId, next, attempt))?.id;
          if (existingId) return { stop: false as const, chapter: next, attempt, candidateId: existingId };
          const blockers = generationReadiness(work, next, { modelConfigured: this.modelConfigured });
          if (blockers.length) throw new ReadinessError(blockers);
          return { stop: false as const, chapter: next, attempt, context: this.service.prepareGeneration(workId, next) };
        });
        if (step.stop) return step.checkpoint;
        chapter = step.chapter;
        let candidateId = step.candidateId;
        if (!candidateId) {
          const snapshot = await this.repository.get(workId);
          const generated = await this.callModel(snapshot!, step.chapter, step.context!);
          const committed = await this.repository.transaction(workId, ({ work }) => {
            this.service.works.set(work.id, work);
            const checkpoint = this.holdLease(work, runId, token);
            const candidate = this.service.recordCandidate(workId, step.chapter, runCandidateKey(runId, step.chapter, step.attempt), step.context!, generated, this.provider.demo ? 'demo' : 'model');
            checkpoint.candidateIds[step.chapter] = candidate.id;
            checkpoint.phase = 'generated';
            checkpoint.usage = addUsage(checkpoint.usage, generated.usage);
            if (checkpoint.control) return { stop: true as const, checkpoint: this.stopRun(checkpoint) };
            return { stop: false as const, candidateId: candidate.id };
          });
          if (committed.stop) return committed.checkpoint;
          candidateId = committed.candidateId;
        }
        await this.repository.transaction(workId, ({ work }) => {
          this.service.works.set(work.id, work);
          const checkpoint = this.holdLease(work, runId, token);
          this.service.runChecks(workId, candidateId!, checkers);
          checkpoint.phase = 'checked';
        });
        const finished = await this.repository.transaction(workId, (transaction) => {
          const checkpoint = this.holdLease(transaction.work, runId, token);
          this.adoptInTransaction(transaction, candidateId!);
          checkpoint.nextChapter = step.chapter + 1;
          checkpoint.phase = 'adopted';
          if (checkpoint.nextChapter <= checkpoint.targetChapter) return undefined;
          // Release in the same commit that adopts the last chapter, so the next run can start immediately.
          checkpoint.phase = 'complete';
          this.releaseLease(checkpoint);
          return { ...checkpoint };
        });
        if (finished) return finished;
      } catch (error) {
        // Another process owns the run now; its checkpoint is not ours to touch.
        if (error instanceof LeaseLostError) throw error;
        // Every completed step is already committed; mark the run paused so the
        // UI and a later retry can tell a failure from an idle run.
        await this.repository.transaction(workId, ({ work }) => {
          const paused: Checkpoint = work.checkpoints.get(runId) ?? {
            runId, targetChapter, nextChapter: 1, phase: 'idle', candidateIds: {},
          };
          if (paused.leaseToken && paused.leaseToken !== token) return;
          paused.phase = 'paused';
          paused.error = error instanceof Error ? error.message : String(error);
          paused.usage = addUsage(paused.usage, usageOfError(error));
          this.releaseLease(paused);
          // A candidate that was refused stays on record, but the next resume writes a fresh attempt.
          if (error instanceof AdoptionBlocked && !(error instanceof ReadinessError) && chapter !== undefined && paused.candidateIds[chapter]) {
            delete paused.candidateIds[chapter];
            paused.attempts = { ...paused.attempts, [chapter]: (paused.attempts?.[chapter] ?? 1) + 1 };
          }
          work.checkpoints.set(runId, paused);
        });
        throw error;
      }
    }
  }

  private stopRun(checkpoint: Checkpoint): Checkpoint {
    checkpoint.phase = checkpoint.control === 'cancel' ? 'cancelled' : 'paused';
    checkpoint.control = undefined;
    this.releaseLease(checkpoint);
    return { ...checkpoint };
  }

  /** Pause or cancel a run. An active run stops at its next step boundary; an idle one changes immediately. */
  async controlRun(workId: string, runId: string, action: 'pause' | 'cancel'): Promise<Checkpoint> {
    return this.repository.transaction(workId, ({ work }) => {
      const checkpoint = work.checkpoints.get(runId);
      if (!checkpoint) throw new Error(`unknown run ${runId}`);
      if (checkpoint.phase === 'complete' || checkpoint.phase === 'cancelled') return { ...checkpoint };
      const active = checkpoint.leaseToken && checkpoint.leaseExpiresAt && Date.parse(checkpoint.leaseExpiresAt) > this.now();
      if (active) checkpoint.control = action;
      else {
        checkpoint.phase = action === 'cancel' ? 'cancelled' : 'paused';
        checkpoint.control = undefined;
        this.releaseLease(checkpoint);
      }
      return { ...checkpoint };
    });
  }

  async recordRuling(workId: string, candidateId: string, input: { checkId: string; reason: string; evidence: string }): Promise<CheckRuling> {
    return this.repository.transaction(workId, ({ work }) => {
      this.service.works.set(work.id, work);
      return this.service.recordRuling(workId, candidateId, input);
    });
  }

  async check(workId: string, candidateId: string, checkers: CandidateChecker[]): Promise<void> {
    await this.repository.transaction(workId, ({ work }) => {
      this.service.works.set(work.id, work);
      this.service.runChecks(workId, candidateId, checkers);
    });
  }

  async adopt(workId: string, candidateId: string, expectedStateRevision: number): Promise<AdoptionResult> {
    return this.repository.transaction(workId, (transaction) => {
      const candidate = transaction.work.candidates.get(candidateId);
      const alreadyAdopted = candidate?.status === 'adopted';
      if (!alreadyAdopted) {
        const holder = this.liveLeaseHolder(transaction.work);
        if (holder) throw new RunInProgressError(`run ${holder.runId} is writing this work; pause it before adopting by hand`);
        if (transaction.work.stateRevision !== expectedStateRevision) throw new StaleCandidateError('adoption request has an outdated state revision');
      }
      return this.adoptInTransaction(transaction, candidateId);
    });
  }

  /** The only path that turns a candidate into a chapter version; repeats return the same version and outbox rows. */
  private adoptInTransaction({ work, enqueue }: WorkTransaction, candidateId: string): AdoptionResult {
    this.service.works.set(work.id, work);
    const version = this.service.adoptCandidate(work.id, candidateId);
    const workId = work.id;
    const created = [
      enqueue({ dedupeKey: `projection:${workId}:${version.id}`, workId, kind: 'projection', aggregateId: version.id, payload: { versionId: version.id, chapterNumber: version.chapterNumber } }),
      enqueue({ dedupeKey: `index:${workId}:${version.id}`, workId, kind: 'search_index', aggregateId: version.id, payload: { versionId: version.id } }),
      enqueue({ dedupeKey: `export:${workId}:${version.id}`, workId, kind: 'export', aggregateId: version.id, payload: { versionId: version.id } }),
    ];
    return { version, outbox: created };
  }

  async outbox(): Promise<OutboxEvent[]> { return this.repository.outbox(); }
}

export class OutboxWorker {
  private readonly repository: WorkRepository;

  constructor(repository: WorkRepository) {
    this.repository = repository;
  }

  async pending(): Promise<OutboxEvent[]> { return (await this.repository.outbox()).filter((event) => !event.publishedAt); }
}

/** Every chapter in [from, to] must come back; ids are the stable `chapter-N` form so dependencies survive regeneration. */
function designContentKey(document: WorldPack | StoryBible): string {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'status' && key !== 'lockedAt').map(([key, item]) => [key, strip(item)]));
  };
  const { revision: _revision, createdAt: _createdAt, ...content } = document as WorldPack & StoryBible;
  return JSON.stringify(strip(content));
}

/**
 * Design revisions are assigned by the server: the same content keeps its
 * number, any content change gets a new one, whatever the client or model sent.
 * Review and lock only change status and never bump it.
 */
function withServerRevision<T extends WorldPack | StoryBible>(work: Work, kind: 'world_pack' | 'story_bible', document: T): T {
  const current = kind === 'world_pack' ? work.worldPack : work.storyBible;
  if (current && designContentKey(current) === designContentKey(document)) return { ...document, revision: current.revision };
  const seen = [...work.designHistory.values()].filter((item) => item.kind === kind).map((item) => item.revision);
  const highest = Math.max(0, current?.revision ?? 0, ...seen);
  return { ...document, revision: highest ? highest + 1 : Math.max(1, document.revision || 1) };
}

function normalizeOutlineBatch(batch: ChapterOutline[], skeleton: PlanSkeleton, from: number, to: number): ChapterOutline[] {
  const byNumber = new Map(batch.map((outline) => [outline.chapterNumber, outline]));
  const result: ChapterOutline[] = [];
  for (let chapterNumber = from; chapterNumber <= to; chapterNumber += 1) {
    const outline = byNumber.get(chapterNumber);
    if (!outline) throw new PlanGateError(`planner returned no outline for chapter ${chapterNumber}`);
    const volume = skeleton.volumes.find((item) => item.startChapter <= chapterNumber && item.endChapter >= chapterNumber);
    result.push({
      ...outline, id: `chapter-${chapterNumber}`, chapterNumber, source: 'model',
      volumeId: skeleton.volumes.some((item) => item.id === outline.volumeId) ? outline.volumeId : volume?.id ?? outline.volumeId,
      threads: outline.threads ?? [], characterIds: outline.characterIds ?? [], scenes: outline.scenes ?? [],
    });
  }
  return result;
}

export function ensureAdoptionAllowed(candidate: ChapterCandidate): void {
  if (candidate.status !== 'candidate') throw new AdoptionBlocked('candidate is no longer adoptable');
}
