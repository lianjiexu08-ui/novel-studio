import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { parseCovenant, rebuildCharacterStates, StaleCandidateError, Work } from '../../../novel-service-core/src/core.ts';
import type { ChapterCandidate, ChapterVersion, EventDraft, PlotNode, Relationship, StoryEvent } from '../../../novel-service-core/src/core.ts';
import type { OutboxEvent, WorkRepository, WorkTransaction } from '../../application/src/index.ts';

function readCovenant(raw: string | null | undefined) {
  if (!raw) return parseCovenant(undefined);
  try {
    return parseCovenant(JSON.parse(raw) as unknown);
  } catch {
    return parseCovenant(undefined);
  }
}

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const now = () => new Date().toISOString();

type PrismaTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Maps the in-memory Work aggregate onto normalized SQLite/PostgreSQL tables.
 * - transaction(): in-process per-work mutex + a real DB transaction with an
 *   optimistic stateRevision check, so concurrent adopters cannot interleave.
 * - Character states are NOT stored: they are a projection rebuilt from active
 *   events on load (single source of truth = StoryEvent).
 * - Checkpoints are process-local for now; durable runs land with the worker.
 */
export class PrismaWorkRepository implements WorkRepository {
  private readonly prisma: PrismaClient;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma ?? new PrismaClient();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async get(workId: string): Promise<Work | undefined> {
    const project = await this.prisma.project.findUnique({ where: { id: workId } });
    if (!project) return undefined;
    return this.loadAggregate(project);
  }

  async list(): Promise<Array<{ id: string; title: string; stateRevision: number; covenant: ReturnType<typeof parseCovenant> }>> {
    const projects = await this.prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
    return projects.map((project) => ({
      id: project.id,
      title: project.title,
      stateRevision: project.stateRevision,
      covenant: readCovenant(project.covenant),
    }));
  }

  async save(work: Work): Promise<void> {
    await this.prisma.project.upsert({
      where: { id: work.id },
      create: { id: work.id, title: work.title, stateRevision: work.stateRevision, covenant: JSON.stringify(work.covenant) },
      update: { title: work.title, stateRevision: work.stateRevision, covenant: JSON.stringify(work.covenant) },
    });
    await this.persist(this.prisma, work, null);
  }

  async outbox(): Promise<OutboxEvent[]> {
    const rows = await this.prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(mapOutbox);
  }

  async transaction<T>(workId: string, callback: (transaction: WorkTransaction) => Promise<T> | T): Promise<T> {
    const previous = this.locks.get(workId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.locks.set(workId, previous.then(() => current));
    await previous;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const work = await this.loadForUpdate(tx, workId);
        const loadedRevision = work.stateRevision;
        const pending: Omit<OutboxEvent, 'id' | 'createdAt' | 'attempts'>[] = [];
        const transaction: WorkTransaction = {
          work,
          enqueue: (input) => {
            const existing = pending.find((event) => event.dedupeKey === input.dedupeKey);
            if (existing) return existing as OutboxEvent;
            pending.push(input);
            return { ...input, id: id('outbox'), createdAt: now(), attempts: 0 } as OutboxEvent;
          },
        };
        const result = await callback(transaction);
        // Optimistic concurrency: the stateRevision we loaded must still be current.
        const updated = await tx.project.updateMany({
          where: { id: workId, stateRevision: loadedRevision },
          data: { stateRevision: work.stateRevision, title: work.title, covenant: JSON.stringify(work.covenant) },
        });
        if (updated.count === 0) throw new StaleCandidateError('concurrent modification detected; reload and retry');
        await this.persist(tx, work, loadedRevision);
        for (const event of pending) {
          await tx.outboxEvent.upsert({
            where: { dedupeKey: event.dedupeKey },
            create: {
              id: id('outbox'), projectId: event.workId, dedupeKey: event.dedupeKey, kind: event.kind,
              aggregateId: event.aggregateId, payload: JSON.stringify(event.payload),
            },
            update: {},
          });
        }
        return result;
      });
    } finally {
      release();
      const queued = this.locks.get(workId);
      if (queued) this.locks.delete(workId);
    }
  }

  private async loadForUpdate(tx: PrismaTx, workId: string): Promise<Work> {
    const project = await tx.project.findUnique({ where: { id: workId } });
    if (!project) throw new Error(`unknown work ${workId}`);
    return this.loadAggregate(project, tx);
  }

  private async loadAggregate(project: { id: string; title: string; stateRevision: number; covenant: string }, tx: PrismaTx | PrismaClient = this.prisma): Promise<Work> {
    const workId = project.id;
    const [chapters, candidates, events, relationships, plotNodes, impacts] = await Promise.all([
      tx.chapter.findMany({ where: { projectId: workId }, include: { versions: true } }),
      tx.chapterCandidate.findMany({ where: { projectId: workId }, include: { checks: true } }),
      tx.storyEvent.findMany({ where: { projectId: workId } }),
      tx.relationship.findMany({ where: { projectId: workId } }),
      tx.plotNode.findMany({ where: { projectId: workId }, include: { realization: true } }),
      tx.impactRecord.findMany({ where: { projectId: workId }, orderBy: { createdAt: 'asc' } }),
    ]);

    const work = new Work(project.title, workId);
    work.stateRevision = project.stateRevision;
    work.covenant = readCovenant(project.covenant);

    const chapterNumberById = new Map(chapters.map((chapter) => [chapter.id, chapter.number]));
    for (const chapter of chapters) {
      for (const version of chapter.versions) {
        const mapped: ChapterVersion = {
          id: version.id, workId, chapterNumber: chapter.number, revision: version.revision,
          content: version.content, status: version.status as ChapterVersion['status'],
          parentVersionId: version.parentVersionId ?? undefined,
          sourceCandidateId: version.sourceCandidateId ?? undefined,
          stale: version.stale, createdAt: version.createdAt.toISOString(),
        };
        work.versions.set(mapped.id, mapped);
      }
    }
    for (const row of candidates) {
      const mapped: ChapterCandidate = {
        id: row.id, workId, chapterNumber: chapterNumberById.get(row.chapterId) ?? 0,
        content: row.content,
        proposedEvents: JSON.parse(row.proposedEvents) as EventDraft[],
        observedEvents: row.observedEvents ? (JSON.parse(row.observedEvents) as EventDraft[]) : undefined,
        runId: row.runId ?? '', generatedAgainstRevision: row.generatedAgainstRev,
        status: row.status as ChapterCandidate['status'],
        checks: row.checks.map((check) => ({
          checker: check.checker, status: check.status as never, message: check.message ?? '',
          candidateId: row.id, checkedAt: check.createdAt.toISOString(),
        })),
        adoptedVersionId: row.adoptedVersionId ?? undefined,
        createdAt: row.createdAt.toISOString(),
      };
      work.candidates.set(mapped.id, mapped);
    }
    for (const row of events) {
      const mapped: StoryEvent = {
        id: row.id, workId, chapterVersionId: row.chapterVersionId, chapterNumber: row.chapterNumber,
        eventType: row.eventType, subjectId: row.subjectId, predicate: row.predicate,
        value: JSON.parse(row.value) as unknown, storyTime: row.storyTime ?? undefined,
        evidence: row.evidence, active: row.active,
      };
      work.events.set(mapped.id, mapped);
    }
    for (const row of relationships) {
      const mapped: Relationship = {
        id: row.id, fromCharacterId: row.fromCharacterId, toCharacterId: row.toCharacterId,
        kind: row.kind, value: row.value, locked: row.locked, sourceEventId: row.sourceEventId ?? undefined,
      };
      work.relationships.set(`${row.fromCharacterId}|${row.toCharacterId}|${row.kind}`, mapped);
    }
    for (const row of plotNodes) {
      const mapped: PlotNode = {
        id: row.id, title: row.title, expectedResult: row.expectedResult,
        prerequisites: JSON.parse(row.prerequisites) as string[],
        realization: {
          status: (row.realization?.status ?? 'unrealized') as PlotNode['realization']['status'],
          chapterVersionId: row.realization?.chapterVersionId ?? undefined,
          evidence: row.realization?.evidence ?? undefined,
          updatedAt: row.realization?.updatedAt.toISOString() ?? now(),
        },
      };
      work.plotNodes.set(mapped.id, mapped);
    }
    for (const row of impacts) {
      work.impacts.push({
        id: row.id, changedChapterNumber: row.changedChapterNumber,
        affectedChapterNumbers: JSON.parse(row.affectedChapterNumbers) as number[],
        reason: row.reason, createdAt: row.createdAt.toISOString(),
      });
    }
    rebuildCharacterStates(work);
    return work;
  }

  /** Upserts the whole aggregate. Child rows are never deleted: history is append-only. */
  private async persist(tx: PrismaTx, work: Work, _loadedRevision: number | null): Promise<void> {
    const chapterIds = new Map<number, string>();
    const chapterNumberOf = (chapterNumber: number) => {
      const existing = chapterIds.get(chapterNumber);
      if (existing) return existing;
      const chapterId = `${work.id}:chapter:${chapterNumber}`;
      chapterIds.set(chapterNumber, chapterId);
      return chapterId;
    };

    for (const version of work.versions.values()) {
      const chapterId = chapterNumberOf(version.chapterNumber);
      await tx.chapter.upsert({
        where: { projectId_number: { projectId: work.id, number: version.chapterNumber } },
        create: { id: chapterId, projectId: work.id, number: version.chapterNumber },
        update: {},
      });
      await tx.chapterVersion.upsert({
        where: { id: version.id },
        create: {
          id: version.id, chapterId, revision: version.revision, content: version.content,
          status: version.status, stale: version.stale,
          parentVersionId: version.parentVersionId ?? null,
          sourceCandidateId: version.sourceCandidateId ?? null,
          createdAt: new Date(version.createdAt),
        },
        update: { status: version.status, stale: version.stale },
      });
    }

    for (const candidate of work.candidates.values()) {
      const chapterId = chapterNumberOf(candidate.chapterNumber);
      await tx.chapter.upsert({
        where: { projectId_number: { projectId: work.id, number: candidate.chapterNumber } },
        create: { id: chapterId, projectId: work.id, number: candidate.chapterNumber },
        update: {},
      });
      await tx.chapterCandidate.upsert({
        where: { id: candidate.id },
        create: {
          id: candidate.id, projectId: work.id, chapterId, runId: candidate.runId,
          content: candidate.content,
          proposedEvents: JSON.stringify(candidate.proposedEvents),
          observedEvents: candidate.observedEvents ? JSON.stringify(candidate.observedEvents) : null,
          generatedAgainstRev: candidate.generatedAgainstRevision, status: candidate.status,
          adoptedVersionId: candidate.adoptedVersionId ?? null,
          createdAt: new Date(candidate.createdAt),
        },
        update: { status: candidate.status, adoptedVersionId: candidate.adoptedVersionId ?? null },
      });
      for (const check of candidate.checks) {
        await tx.checkExecution.upsert({
          where: { id: `${candidate.id}:${check.checker}` },
          create: {
            id: `${candidate.id}:${check.checker}`, candidateId: candidate.id, checker: check.checker,
            status: check.status, message: check.message, stateRevision: candidate.generatedAgainstRevision,
            createdAt: new Date(check.checkedAt),
          },
          update: { status: check.status, message: check.message },
        });
      }
    }

    for (const event of work.events.values()) {
      await tx.storyEvent.upsert({
        where: { id: event.id },
        create: {
          id: event.id, projectId: work.id, chapterVersionId: event.chapterVersionId,
          chapterNumber: event.chapterNumber, eventType: event.eventType, subjectId: event.subjectId,
          predicate: event.predicate, value: JSON.stringify(event.value),
          storyTime: event.storyTime ?? null, evidence: event.evidence, active: event.active,
        },
        update: { active: event.active },
      });
    }

    for (const relationship of work.relationships.values()) {
      await tx.relationship.upsert({
        where: {
          projectId_fromCharacterId_toCharacterId_kind: {
            projectId: work.id, fromCharacterId: relationship.fromCharacterId,
            toCharacterId: relationship.toCharacterId, kind: relationship.kind,
          },
        },
        create: {
          id: relationship.id, projectId: work.id, fromCharacterId: relationship.fromCharacterId,
          toCharacterId: relationship.toCharacterId, kind: relationship.kind,
          value: relationship.value, locked: relationship.locked,
          sourceEventId: relationship.sourceEventId ?? null,
        },
        update: { value: relationship.value, locked: relationship.locked, sourceEventId: relationship.sourceEventId ?? null },
      });
    }

    for (const node of work.plotNodes.values()) {
      await tx.plotNode.upsert({
        where: { id: node.id },
        create: {
          id: node.id, projectId: work.id, title: node.title,
          expectedResult: node.expectedResult, prerequisites: JSON.stringify(node.prerequisites),
        },
        update: { title: node.title, expectedResult: node.expectedResult, prerequisites: JSON.stringify(node.prerequisites) },
      });
      await tx.planRealization.upsert({
        where: { plotNodeId: node.id },
        create: {
          id: `realization:${node.id}`, plotNodeId: node.id, status: node.realization.status,
          chapterVersionId: node.realization.chapterVersionId ?? null, evidence: node.realization.evidence ?? null,
        },
        update: {
          status: node.realization.status,
          chapterVersionId: node.realization.chapterVersionId ?? null,
          evidence: node.realization.evidence ?? null,
        },
      });
    }

    for (const impact of work.impacts) {
      await tx.impactRecord.upsert({
        where: { id: impact.id },
        create: {
          id: impact.id, projectId: work.id, changedChapterNumber: impact.changedChapterNumber,
          affectedChapterNumbers: JSON.stringify(impact.affectedChapterNumbers),
          reason: impact.reason, createdAt: new Date(impact.createdAt),
        },
        update: {},
      });
    }
  }
}

function mapOutbox(row: {
  id: string; projectId: string; dedupeKey: string; kind: string; aggregateId: string;
  payload: string; publishedAt: Date | null; attempts: number; createdAt: Date;
}): OutboxEvent {
  return {
    id: row.id, workId: row.projectId, dedupeKey: row.dedupeKey,
    kind: row.kind as OutboxEvent['kind'], aggregateId: row.aggregateId,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    publishedAt: row.publishedAt?.toISOString(), attempts: row.attempts,
    createdAt: row.createdAt.toISOString(),
  };
}
