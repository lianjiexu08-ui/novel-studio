import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseCovenant, Work } from '../../../novel-service-core/src/core.ts';
import type { CreativeCovenant } from '../../../novel-service-core/src/core.ts';
import type {
  ChapterCandidate, ChapterVersion, Character, CharacterState, ImpactRecord, ManuscriptRevision, PlotNode, Relationship, StoryEvent, WorldRule,
} from '../../../novel-service-core/src/core.ts';
import type { StoryBible, WorldPack } from '../../../novel-service-core/src/world.ts';
import type { OutboxEvent, WorkRepository, WorkTransaction } from '../../application/src/index.ts';

interface PersistedWork {
  id: string;
  title: string;
  stateRevision: number;
  constraintRevision?: number;
  covenant?: CreativeCovenant;
  worldPack?: WorldPack;
  storyBible?: StoryBible;
  manuscripts?: ManuscriptRevision[];
  candidates: ChapterCandidate[];
  versions: ChapterVersion[];
  events: StoryEvent[];
  states: CharacterState[];
  relationships: Relationship[];
  characters?: Character[];
  worldRules?: WorldRule[];
  plotNodes: PlotNode[];
  checkpoints: Array<[string, unknown]>;
  impacts: ImpactRecord[];
}

interface PersistedState {
  version: 1;
  works: PersistedWork[];
  outbox: OutboxEvent[];
}

export class JsonWorkRepository implements WorkRepository {
  private readonly filePath: string;
  private readonly works = new Map<string, Work>();
  private readonly events = new Map<string, OutboxEvent>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  async get(workId: string): Promise<Work | undefined> { return this.works.get(workId); }

  async list(): Promise<{ id: string; title: string; stateRevision: number; constraintRevision: number; covenant: CreativeCovenant }[]> {
    return [...this.works.values()].map((work) => ({ id: work.id, title: work.title, stateRevision: work.stateRevision, constraintRevision: work.constraintRevision, covenant: work.covenant }));
  }

  save(work: Work): void {
    this.works.set(work.id, work);
    this.flush();
  }

  async outbox(): Promise<OutboxEvent[]> {
    return [...this.events.values()].map((event) => ({ ...event, payload: { ...event.payload } }));
  }

  async transaction<T>(workId: string, callback: (transaction: WorkTransaction) => Promise<T> | T): Promise<T> {
    const previous = this.locks.get(workId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.locks.set(workId, queued);
    await previous;
    const before = this.snapshot();
    try {
      const work = this.works.get(workId);
      if (!work) throw new Error(`unknown work ${workId}`);
      const pending: OutboxEvent[] = [];
      const transaction: WorkTransaction = {
        work,
        enqueue: (input) => {
          const existing = [...this.events.values(), ...pending].find((event) => event.dedupeKey === input.dedupeKey);
          if (existing) return clone(existing);
          const event: OutboxEvent = {
            ...input,
            id: `outbox_${randomUUID().replaceAll('-', '')}`,
            createdAt: new Date().toISOString(),
            attempts: 0,
          };
          pending.push(event);
          return clone(event);
        },
      };
      const result = await callback(transaction);
      this.works.set(work.id, work);
      for (const event of pending) this.events.set(event.id, event);
      this.flush();
      return result;
    } catch (error) {
      this.restore(before);
      this.flush();
      throw error;
    } finally {
      release();
      if (this.locks.get(workId) === queued) this.locks.delete(workId);
    }
  }

  private load(): void {
    try {
      const state = JSON.parse(readFileSync(this.filePath, 'utf8')) as PersistedState;
      if (state.version !== 1 || !Array.isArray(state.works) || !Array.isArray(state.outbox)) throw new Error('invalid persistence state');
      for (const persisted of state.works) this.works.set(persisted.id, deserializeWork(persisted));
      for (const event of state.outbox) this.events.set(event.id, event);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }

  private snapshot(): PersistedState {
    return JSON.parse(JSON.stringify({ version: 1, works: [...this.works.values()].map(serializeWork), outbox: [...this.events.values()] })) as PersistedState;
  }

  private restore(state: PersistedState): void {
    this.works.clear();
    this.events.clear();
    for (const persisted of state.works) this.works.set(persisted.id, deserializeWork(persisted));
    for (const event of state.outbox) this.events.set(event.id, event);
  }

  private flush(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.snapshot(), null, 2)}\n`, 'utf8');
    renameSync(temporary, this.filePath);
  }
}

function serializeWork(work: Work): PersistedWork {
  return {
    id: work.id,
    title: work.title,
    stateRevision: work.stateRevision,
    constraintRevision: work.constraintRevision,
    covenant: work.covenant,
    worldPack: work.worldPack,
    storyBible: work.storyBible,
    manuscripts: [...work.manuscripts.values()],
    candidates: [...work.candidates.values()],
    versions: [...work.versions.values()],
    events: [...work.events.values()],
    states: [...work.states.values()],
    relationships: [...work.relationships.values()],
    characters: [...work.characters.values()],
    worldRules: [...work.worldRules.values()],
    plotNodes: [...work.plotNodes.values()],
    checkpoints: [...work.checkpoints.entries()],
    impacts: work.impacts,
  };
}

function deserializeWork(value: PersistedWork): Work {
  const work = new Work(value.title, value.id);
  work.stateRevision = value.stateRevision;
  work.constraintRevision = value.constraintRevision ?? 0;
  work.covenant = parseCovenant(value.covenant);
  work.worldPack = value.worldPack;
  work.storyBible = value.storyBible;
  for (const manuscript of value.manuscripts ?? []) work.manuscripts.set(manuscript.id, manuscript);
  for (const candidate of value.candidates) {
    work.candidates.set(candidate.id, { ...candidate, generatedAgainstConstraintRevision: candidate.generatedAgainstConstraintRevision ?? 0 });
  }
  for (const version of value.versions) work.versions.set(version.id, version);
  for (const event of value.events) work.events.set(event.id, event);
  for (const state of value.states) work.states.set(`${state.characterId}|${state.field}`, state);
  for (const relationship of value.relationships) work.relationships.set(relationship.id, relationship);
  for (const character of value.characters ?? []) work.characters.set(character.id, character);
  for (const rule of value.worldRules ?? []) work.worldRules.set(rule.id, rule);
  for (const node of value.plotNodes) work.plotNodes.set(node.id, node);
  for (const checkpoint of value.checkpoints) work.checkpoints.set(checkpoint[0], checkpoint[1] as any);
  work.impacts.push(...value.impacts);
  return work;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
