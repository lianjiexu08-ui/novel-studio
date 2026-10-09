import { randomUUID } from 'node:crypto';
import { AdoptionBlocked, NovelService, StaleCandidateError, Work } from '../../../novel-service-core/src/core.ts';
import type { CandidateChecker, ChapterCandidate, ChapterVersion, Checkpoint, CreativeCovenant, ManuscriptRevision, ModelProvider } from '../../../novel-service-core/src/core.ts';
import { lockStoryBible, lockWorldPack, reviewStoryBible, reviewWorldPack } from '../../../novel-service-core/src/world.ts';
import type { StoryBible, WorldPack } from '../../../novel-service-core/src/world.ts';

export interface DesignProvider {
  generateWorldPack(input: { title: string; covenant: CreativeCovenant }): Promise<WorldPack>;
  generateStoryBible(input: { title: string; covenant: CreativeCovenant; worldPack: WorldPack }): Promise<StoryBible>;
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

export class ChapterWorkflow {
  private readonly service: NovelService;
  private readonly repository: WorkRepository;
  private readonly designProvider?: DesignProvider;

  constructor(repository: WorkRepository, provider: ModelProvider, designProvider?: DesignProvider) {
    this.repository = repository;
    this.service = new NovelService(provider);
    this.designProvider = designProvider;
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

  async updateWork(workId: string, input: { title: string; covenant: CreativeCovenant }): Promise<Work> {
    return this.repository.transaction(workId, ({ work }) => {
      work.title = input.title;
      work.covenant = input.covenant;
      work.constraintRevision += 1;
      return work;
    });
  }

  async saveWorldPack(workId: string, worldPack: WorldPack): Promise<WorldPack> {
    return this.repository.transaction(workId, ({ work }) => {
      work.worldPack = worldPack;
      work.constraintRevision += 1;
      return work.worldPack;
    });
  }

  async generateWorldPack(workId: string): Promise<WorldPack> {
    if (!this.designProvider) throw new Error('design provider is not configured');
    return this.repository.transaction(workId, async ({ work }) => {
      const worldPack = await this.designProvider!.generateWorldPack({ title: work.title, covenant: work.covenant });
      work.worldPack = worldPack;
      work.constraintRevision += 1;
      return worldPack;
    });
  }

  async lockWorldPack(workId: string): Promise<WorldPack> {
    return this.repository.transaction(workId, ({ work }) => {
      if (!work.worldPack) throw new Error('world pack has not been generated');
      work.worldPack = lockWorldPack(work.worldPack);
      work.constraintRevision += 1;
      return work.worldPack;
    });
  }

  async reviewWorldPack(workId: string): Promise<WorldPack> {
    return this.repository.transaction(workId, ({ work }) => {
      if (!work.worldPack) throw new Error('world pack has not been generated');
      work.worldPack = reviewWorldPack(work.worldPack);
      work.constraintRevision += 1;
      return work.worldPack;
    });
  }

  async saveStoryBible(workId: string, storyBible: StoryBible): Promise<StoryBible> {
    return this.repository.transaction(workId, ({ work }) => {
      work.storyBible = storyBible;
      work.constraintRevision += 1;
      return work.storyBible;
    });
  }

  async generateStoryBible(workId: string): Promise<StoryBible> {
    if (!this.designProvider) throw new Error('design provider is not configured');
    return this.repository.transaction(workId, async ({ work }) => {
      if (!work.worldPack) throw new Error('world pack has not been generated');
      const storyBible = await this.designProvider!.generateStoryBible({ title: work.title, covenant: work.covenant, worldPack: work.worldPack });
      work.storyBible = storyBible;
      work.constraintRevision += 1;
      return storyBible;
    });
  }

  async lockStoryBible(workId: string): Promise<StoryBible> {
    return this.repository.transaction(workId, ({ work }) => {
      if (!work.worldPack) throw new Error('world pack has not been generated');
      if (!work.storyBible) throw new Error('story bible has not been generated');
      work.storyBible = lockStoryBible(work.storyBible, work.worldPack);
      work.constraintRevision += 1;
      return work.storyBible;
    });
  }

  async reviewStoryBible(workId: string): Promise<StoryBible> {
    return this.repository.transaction(workId, ({ work }) => {
      if (!work.worldPack) throw new Error('world pack has not been generated');
      if (!work.storyBible) throw new Error('story bible has not been generated');
      work.storyBible = reviewStoryBible(work.storyBible, work.worldPack);
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

  async generate(workId: string, chapterNumber: number, runId: string): Promise<ChapterCandidate> {
    return this.repository.transaction(workId, async ({ work }) => {
      this.service.works.set(work.id, work);
      return this.service.generateCandidateAsync(workId, chapterNumber, runId);
    });
  }

  async runUntil(workId: string, targetChapter: number, checkers: CandidateChecker[], runId: string): Promise<Checkpoint> {
    let checkpoint: Checkpoint | undefined;
    do {
      checkpoint = await this.repository.transaction(workId, async ({ work }) => {
        this.service.works.set(work.id, work);
        const nextChapter = work.checkpoints.get(runId)?.nextChapter ?? 1;
        if (nextChapter > targetChapter) return work.checkpoints.get(runId)!;
        // Commit one chapter per transaction. A model timeout or process restart
        // therefore preserves every previously adopted chapter and its checkpoint.
        return this.service.runUntilAsync(workId, nextChapter, checkers, runId);
      });
    } while (checkpoint.nextChapter <= targetChapter);
    return checkpoint;
  }

  async check(workId: string, candidateId: string, checkers: CandidateChecker[]): Promise<void> {
    await this.repository.transaction(workId, ({ work }) => {
      this.service.works.set(work.id, work);
      this.service.runChecks(workId, candidateId, checkers);
    });
  }

  async adopt(workId: string, candidateId: string, expectedStateRevision: number): Promise<AdoptionResult> {
    return this.repository.transaction(workId, ({ work, enqueue }) => {
      this.service.works.set(work.id, work);
      if (work.stateRevision !== expectedStateRevision) throw new StaleCandidateError('adoption request has an outdated state revision');
      const version = this.service.adoptCandidate(workId, candidateId);
      const created = [
        enqueue({ dedupeKey: `projection:${workId}:${version.id}`, workId, kind: 'projection', aggregateId: version.id, payload: { versionId: version.id, chapterNumber: version.chapterNumber } }),
        enqueue({ dedupeKey: `index:${workId}:${version.id}`, workId, kind: 'search_index', aggregateId: version.id, payload: { versionId: version.id } }),
        enqueue({ dedupeKey: `export:${workId}:${version.id}`, workId, kind: 'export', aggregateId: version.id, payload: { versionId: version.id } }),
      ];
      return { version, outbox: created };
    });
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

export function ensureAdoptionAllowed(candidate: ChapterCandidate): void {
  if (candidate.status !== 'candidate') throw new AdoptionBlocked('candidate is no longer adoptable');
}
