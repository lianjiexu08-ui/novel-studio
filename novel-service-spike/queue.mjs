import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * A very small durable queue used by the novel-service spike.
 *
 * The queue deliberately keeps its state in one JSON file. It is not intended
 * to replace a production queue yet; it gives the workflow an explicit state
 * machine that can be moved to Redis/Postgres later without changing callers.
 * A running task has a lease. If the process dies while the lease is active,
 * the next process will put the task back in the queued state. Completion is
 * guarded by task id and worker id, so a stale worker cannot complete a task
 * that has already been recovered by another worker.
 */
export class PersistentQueue {
  constructor(filePath, { leaseMs = 60_000, now = () => Date.now() } = {}) {
    this.filePath = path.resolve(filePath);
    this.leaseMs = leaseMs;
    this.now = now;
    this.state = this.#read();
    this.#recoverExpiredLeases();
  }

  enqueue({ workId, kind = 'write', dedupeKey, payload = {} }) {
    if (!workId) throw new Error('workId is required');
    if (!dedupeKey) throw new Error('dedupeKey is required');

    // A task key is unique for a work. In particular, an adoption task may be
    // retried after a crash without creating a second adoption task.
    const existing = this.state.tasks.find(
      (task) => task.workId === workId && task.dedupeKey === dedupeKey,
    );
    if (existing) return clone(existing);

    const timestamp = this.now();
    const task = {
      id: crypto.randomUUID(),
      workId,
      kind,
      dedupeKey,
      payload,
      status: 'queued',
      attempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      claimedAt: null,
      leaseUntil: null,
      workerId: null,
      result: null,
      error: null,
    };
    this.state.tasks.push(task);
    this.#write();
    return clone(task);
  }

  /** Claim the oldest runnable task, while keeping one active task per work. */
  claim(workerId = 'worker') {
    if (!workerId) throw new Error('workerId is required');
    this.#recoverExpiredLeases();

    const activeWorks = new Set(
      this.state.tasks
        .filter((task) => task.status === 'running' && task.leaseUntil > this.now())
        .map((task) => task.workId),
    );
    const task = this.state.tasks
      .filter((candidate) => candidate.status === 'queued' && !activeWorks.has(candidate.workId))
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!task) return null;

    const timestamp = this.now();
    task.status = 'running';
    task.attempts += 1;
    task.claimedAt = timestamp;
    task.leaseUntil = timestamp + this.leaseMs;
    task.workerId = workerId;
    task.updatedAt = timestamp;
    task.error = null;
    this.#write();
    return clone(task);
  }

  heartbeat(taskId, workerId) {
    const task = this.#find(taskId);
    this.#assertOwner(task, workerId);
    task.leaseUntil = this.now() + this.leaseMs;
    task.updatedAt = this.now();
    this.#write();
    return clone(task);
  }

  complete(taskId, workerId, result = null) {
    const task = this.#find(taskId);
    this.#assertOwner(task, workerId);
    const timestamp = this.now();
    task.status = 'succeeded';
    task.result = result;
    task.error = null;
    task.leaseUntil = null;
    task.claimedAt = null;
    task.workerId = null;
    task.updatedAt = timestamp;
    this.#write();
    return clone(task);
  }

  fail(taskId, workerId, error, { retry = false } = {}) {
    const task = this.#find(taskId);
    this.#assertOwner(task, workerId);
    const timestamp = this.now();
    task.status = retry ? 'queued' : 'failed';
    task.error = String(error?.message ?? error ?? 'task failed');
    task.leaseUntil = null;
    task.claimedAt = null;
    task.workerId = null;
    task.updatedAt = timestamp;
    this.#write();
    return clone(task);
  }

  async runNext(workerId, handler) {
    const task = this.claim(workerId);
    if (!task) return null;
    try {
      const result = await handler(task);
      return this.complete(task.id, workerId, result);
    } catch (error) {
      this.fail(task.id, workerId, error);
      throw error;
    }
  }

  get(taskId) {
    const task = this.state.tasks.find((candidate) => candidate.id === taskId);
    return task ? clone(task) : null;
  }

  list({ workId, status } = {}) {
    return this.state.tasks
      .filter((task) => (workId ? task.workId === workId : true))
      .filter((task) => (status ? task.status === status : true))
      .map(clone);
  }

  #find(taskId) {
    const task = this.state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    return task;
  }

  #assertOwner(task, workerId) {
    if (task.status !== 'running') {
      throw new Error(`Task ${task.id} is ${task.status}, not running`);
    }
    if (task.workerId !== workerId) {
      throw new Error(`Worker ${workerId} does not own task ${task.id}`);
    }
    if (task.leaseUntil <= this.now()) {
      throw new Error(`Task ${task.id} lease expired`);
    }
  }

  #recoverExpiredLeases() {
    const timestamp = this.now();
    let changed = false;
    for (const task of this.state.tasks) {
      if (task.status === 'running' && task.leaseUntil <= timestamp) {
        task.status = 'queued';
        task.error = 'Recovered after worker lease expired';
        task.claimedAt = null;
        task.leaseUntil = null;
        task.workerId = null;
        task.updatedAt = timestamp;
        changed = true;
      }
    }
    if (changed) this.#write();
  }

  #read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || !Array.isArray(parsed.tasks)) throw new Error('Invalid queue state');
      return parsed;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, tasks: [] };
      throw error;
    }
  }

  #write() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.filePath);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

