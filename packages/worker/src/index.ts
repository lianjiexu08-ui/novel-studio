import { randomUUID } from 'node:crypto';

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'paused';
export type TaskKind = 'generate_chapter' | 'extract_events' | 'review' | 'adopt' | 'projection' | 'publish' | 'verify_publish';

export interface Task {
  id: string;
  workId: string;
  kind: TaskKind;
  dedupeKey: string;
  payload: Record<string, unknown>;
  status: TaskStatus;
  attempt: number;
  maxAttempts: number;
  owner?: string;
  leaseUntil?: number;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TaskStore {
  enqueue(input: { workId: string; kind: TaskKind; dedupeKey: string; payload?: Record<string, unknown>; maxAttempts?: number }): Task;
  claim(workerId: string, leaseMs: number): Task | undefined;
  complete(taskId: string, workerId: string, result?: unknown): Task;
  fail(taskId: string, workerId: string, error: unknown, retry?: boolean): Task;
  recoverExpiredLeases(): number;
  get(taskId: string): Task | undefined;
  list(filter?: { workId?: string; status?: TaskStatus }): Task[];
}

export class TaskOwnershipError extends Error {}
export class TaskConflictError extends Error {}

export class InMemoryTaskStore implements TaskStore {
  private readonly tasks = new Map<string, Task>();
  private readonly clock: () => number;

  constructor(clock: () => number = () => Date.now()) {
    this.clock = clock;
  }

  enqueue(input: { workId: string; kind: TaskKind; dedupeKey: string; payload?: Record<string, unknown>; maxAttempts?: number }): Task {
    const existing = [...this.tasks.values()].find((task) => task.dedupeKey === input.dedupeKey && task.status !== 'failed');
    if (existing) return clone(existing);
    const timestamp = this.clock();
    const task: Task = {
      id: `task_${randomUUID().replaceAll('-', '')}`,
      workId: input.workId,
      kind: input.kind,
      dedupeKey: input.dedupeKey,
      payload: { ...(input.payload ?? {}) },
      status: 'queued',
      attempt: 0,
      maxAttempts: input.maxAttempts ?? 3,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.tasks.set(task.id, task);
    return clone(task);
  }

  claim(workerId: string, leaseMs: number): Task | undefined {
    this.recoverExpiredLeases();
    const runningWorks = new Set([...this.tasks.values()].filter((task) => task.status === 'running').map((task) => task.workId));
    const candidate = [...this.tasks.values()].filter((task) => task.status === 'queued' && !runningWorks.has(task.workId)).sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!candidate) return undefined;
    candidate.status = 'running';
    candidate.owner = workerId;
    candidate.attempt += 1;
    candidate.leaseUntil = this.clock() + leaseMs;
    candidate.updatedAt = this.clock();
    return clone(candidate);
  }

  complete(taskId: string, workerId: string, result?: unknown): Task {
    const task = this.mustGet(taskId);
    if (task.status === 'succeeded') return clone(task);
    this.assertOwner(task, workerId);
    task.status = 'succeeded';
    task.result = result;
    task.owner = undefined;
    task.leaseUntil = undefined;
    task.updatedAt = this.clock();
    return clone(task);
  }

  fail(taskId: string, workerId: string, error: unknown, retry = false): Task {
    const task = this.mustGet(taskId);
    this.assertOwner(task, workerId);
    task.error = String(error instanceof Error ? error.message : error);
    task.status = retry && task.attempt < task.maxAttempts ? 'queued' : 'failed';
    task.owner = undefined;
    task.leaseUntil = undefined;
    task.updatedAt = this.clock();
    return clone(task);
  }

  recoverExpiredLeases(): number {
    const timestamp = this.clock();
    let recovered = 0;
    for (const task of this.tasks.values()) {
      if (task.status === 'running' && task.leaseUntil !== undefined && task.leaseUntil <= timestamp) {
        task.status = 'queued';
        task.owner = undefined;
        task.leaseUntil = undefined;
        task.error = 'Recovered after worker lease expired';
        task.updatedAt = timestamp;
        recovered += 1;
      }
    }
    return recovered;
  }

  get(taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    return task ? clone(task) : undefined;
  }

  list(filter: { workId?: string; status?: TaskStatus } = {}): Task[] {
    return [...this.tasks.values()].filter((task) => (!filter.workId || task.workId === filter.workId) && (!filter.status || task.status === filter.status)).map(clone);
  }

  private mustGet(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new TaskConflictError(`unknown task ${taskId}`);
    return task;
  }

  private assertOwner(task: Task, workerId: string): void {
    if (task.status !== 'running' || task.owner !== workerId || (task.leaseUntil !== undefined && task.leaseUntil <= this.clock())) throw new TaskOwnershipError(`worker ${workerId} does not own task ${task.id}`);
  }
}

export class WorkerRunner {
  private readonly store: TaskStore;
  private readonly leaseMs: number;

  constructor(store: TaskStore, leaseMs = 30_000) {
    this.store = store;
    this.leaseMs = leaseMs;
  }

  async runNext(workerId: string, handler: (task: Task) => Promise<unknown> | unknown): Promise<Task | undefined> {
    const task = this.store.claim(workerId, this.leaseMs);
    if (!task) return undefined;
    try {
      const result = await handler(task);
      return this.store.complete(task.id, workerId, result);
    } catch (error) {
      this.store.fail(task.id, workerId, error, true);
      throw error;
    }
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
