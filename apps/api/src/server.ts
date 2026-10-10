import Fastify, { type FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import {
  adoptCandidateRequestSchema,
  createWorkRequestSchema,
  generateChapterRequestSchema,
  generateDesignRequestSchema,
  updateWorkRequestSchema,
  saveStoryBibleRequestSchema,
  saveWorldPackRequestSchema,
  type ApiError,
  type ApiErrorCode,
  type CandidateDto,
  type ManuscriptRevisionDto,
  type WorkDto,
} from 'novel-studio-contracts';
import {
  AdoptionBlocked,
  characterStateAt,
  LockedConstraintError,
  SettingConflictError,
  StaleCandidateError,
  relationshipAt,
  resourceStateAt,
  artifactStateAt,
  storyArcAt,
  storyPromiseAt,
  storySecretAt,
  storyThreadAt,
  knowledgeAt,
  canonConsistencyChecker,
  chapterLengthChecker,
  contextManifestFor,
  closureCoverageFor,
  observedEventsChecker,
  passChecker,
  type ChapterCandidate,
  type ManuscriptRevision,
  type ModelProvider,
  type Work,
} from '../../../novel-service-core/src/core.ts';
import { CanonGateError } from '../../../novel-service-core/src/world.ts';
import {
  ChapterWorkflow,
  InMemoryWorkRepository,
  type DesignProvider,
  type WorkRepository,
} from '../../../packages/application/src/index.ts';
import { PrismaWorkRepository } from '../../../packages/persistence/src/prisma-repository.ts';
import { JsonDesignPlanner, OpenAICompatibleChapterProvider, OpenAICompatiblePlanningClient } from '../../../packages/planner/src/index.ts';
import { registerSettingsRoutes } from './settings-routes.ts';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * Local-first default: SQLite via Prisma, one file at data/novel-studio.db.
 * Set NOVEL_REPOSITORY=memory to force the in-memory repository (used by tests).
 */
function createDefaultRepository(): WorkRepository {
  if (process.env.NOVEL_REPOSITORY === 'memory') return new InMemoryWorkRepository();
  const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');
  mkdirSync(dataDir, { recursive: true });
  process.env.DATABASE_URL ??= `file:${join(dataDir, 'novel-studio.db')}`;
  return new PrismaWorkRepository();
}

export interface ApiDependencies {
  repository?: WorkRepository;
  provider?: ModelProvider;
  designProvider?: DesignProvider;
  /** When set, all non-/health routes require `Authorization: Bearer <token>`. */
  authToken?: string;
}

export function defaultProvider(): ModelProvider {
  const endpoint = process.env.NOVEL_MODEL_ENDPOINT;
  const apiKey = process.env.NOVEL_MODEL_API_KEY;
  const model = process.env.NOVEL_WRITING_MODEL ?? process.env.NOVEL_PLANNING_MODEL;
  const timeoutMs = Number(process.env.NOVEL_MODEL_TIMEOUT_MS ?? 60_000);
  if (endpoint && apiKey && model) {
    return new OpenAICompatibleChapterProvider(endpoint, apiKey, model, Number(process.env.NOVEL_MODEL_BUDGET_USD ?? Number.POSITIVE_INFINITY), timeoutMs, process.env.NOVEL_INDEPENDENT_EXTRACTION !== 'false');
  }
  return {
    generateChapter: ({ chapterNumber, context }) => {
      const event = { eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: chapterNumber + context.includedEventIds.length, storyTime: chapterNumber, evidence: 'paragraph 1' };
      return { content: `第${chapterNumber}章：主角踏入新的修行阶段。`, proposedEvents: [event], observedEvents: [event] };
    },
  };
}

function defaultDesignProvider(): DesignProvider | undefined {
  const endpoint = process.env.NOVEL_MODEL_ENDPOINT;
  const apiKey = process.env.NOVEL_MODEL_API_KEY;
  const model = process.env.NOVEL_PLANNING_MODEL;
  if (!endpoint || !apiKey || !model) return undefined;
  const targetChapters = Number(process.env.NOVEL_PLANNING_CHAPTER_TARGET ?? 100);
  const timeoutMs = Number(process.env.NOVEL_MODEL_TIMEOUT_MS ?? 60_000);
  return new JsonDesignPlanner(new OpenAICompatiblePlanningClient(endpoint, apiKey, model, Number(process.env.NOVEL_MODEL_BUDGET_USD ?? Number.POSITIVE_INFINITY), timeoutMs), targetChapters);
}

function generationCheckers() {
  const checkers = [passChecker, canonConsistencyChecker, observedEventsChecker];
  if (process.env.NOVEL_MODEL_ENDPOINT && process.env.NOVEL_MODEL_API_KEY && (process.env.NOVEL_WRITING_MODEL || process.env.NOVEL_PLANNING_MODEL)) checkers.push(chapterLengthChecker);
  return checkers;
}

const chapterNumberParamSchema = z.object({ workId: z.string().min(1), chapterNumber: z.coerce.number().int().min(1) });
const candidateParamSchema = z.object({ workId: z.string().min(1), candidateId: z.string().min(1) });
const workParamSchema = z.object({ workId: z.string().min(1) });
const runRequestSchema = z.object({ targetChapter: z.number().int().min(1).max(450), runId: z.string().min(1).max(200).optional(), background: z.boolean().optional() });
const milestoneRequestSchema = z.object({ runId: z.string().min(1).max(200).optional() });
const chapterStateParamSchema = z.object({ workId: z.string().min(1), chapterNumber: z.coerce.number().int().min(1) });

function plannedChapterCount(work: Work): number {
  return work.storyBible?.volumes.reduce((sum, volume) => sum + volume.plannedChapterCount, 0) ?? 0;
}

function toWorkDto(work: Work): WorkDto {
  return { id: work.id, title: work.title, stateRevision: work.stateRevision, constraintRevision: work.constraintRevision, covenant: work.covenant };
}

function toCandidateDto(candidate: ChapterCandidate): CandidateDto {
  return {
    id: candidate.id,
    workId: candidate.workId,
    chapterNumber: candidate.chapterNumber,
    status: candidate.status,
    runId: candidate.runId,
    content: candidate.content,
    proposedEvents: candidate.proposedEvents,
    observedEvents: candidate.observedEvents,
    generatedAgainstRevision: candidate.generatedAgainstRevision,
    generatedAgainstConstraintRevision: candidate.generatedAgainstConstraintRevision,
    checks: candidate.checks,
    adoptedVersionId: candidate.adoptedVersionId,
    createdAt: candidate.createdAt,
  };
}

function toManuscriptDto(manuscript: ManuscriptRevision): ManuscriptRevisionDto {
  return manuscript;
}

export function createApiServer(dependencies: ApiDependencies = {}): { app: FastifyInstance; repository: WorkRepository } {
  const repository = dependencies.repository ?? createDefaultRepository();
  const workflow = new ChapterWorkflow(repository, dependencies.provider ?? defaultProvider(), dependencies.designProvider ?? defaultDesignProvider());
  const activeRuns = new Map<string, Promise<void>>();
  async function launchBackgroundRun(workId: string, targetChapter: number, runId: string): Promise<void> {
    const key = `${workId}:${runId}`;
    if (activeRuns.has(key)) return;
    const task = workflow.runUntil(workId, targetChapter, generationCheckers(), runId)
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => { activeRuns.delete(key); });
    activeRuns.set(key, task);
  }
  const app = Fastify({ logger: false });

  // Tolerate empty JSON bodies on POST endpoints that take no payload.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    if (body === '' || body === undefined) return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(null, { __invalidJson: true });
    }
  });

  // CORS: local dev default, tighten via env when deploying.
  app.addHook('onSend', async (request, reply) => {
    reply.header('access-control-allow-origin', process.env.API_CORS_ORIGIN ?? 'http://localhost:5173');
    reply.header('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    reply.header('access-control-allow-headers', 'content-type,authorization');
  });
  app.options('*', async (_request, reply) => reply.code(204).send());

  // Optional single-user bearer auth (enabled by setting API_TOKEN).
  const token = dependencies.authToken ?? process.env.API_TOKEN;
  app.addHook('onRequest', async (request, reply) => {
    if (!token || request.url === '/health' || request.method === 'OPTIONS') return;
    if (request.headers.authorization !== `Bearer ${token}`) {
      return reply.code(401).send(apiError('UNAUTHORIZED', 'missing or invalid bearer token'));
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const { status, body } = mapError(error);
    reply.code(status).send(body);
  });

  app.get('/health', async () => ({ ok: true }));

  app.post('/works', async (request, reply) => {
    const body = createWorkRequestSchema.parse(request.body ?? {});
    const work = await workflow.createWork(body.title, body.covenant);
    return reply.code(201).send(toWorkDto(work));
  });

  app.patch('/works/:workId', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const body = updateWorkRequestSchema.parse(request.body ?? {});
    return toWorkDto(await workflow.updateWork(workId, body));
  });

  app.get('/works', async () => {
    return { works: await repository.list() };
  });

  app.get('/works/:workId', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    return toWorkDto(work);
  });

  app.get('/works/:workId/design', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    return { worldPack: work.worldPack, storyBible: work.storyBible, constraintRevision: work.constraintRevision };
  });

  app.get('/works/:workId/design/history', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    return {
      revisions: [...work.designHistory.values()]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((revision) => ({ ...revision, snapshot: revision.snapshot })),
    };
  });

  app.get('/works/:workId/manuscripts', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    return { manuscripts: [...work.manuscripts.values()].map(toManuscriptDto) };
  });

  app.get('/works/:workId/manuscripts/:manuscriptId/export', async (request) => {
    const params = workParamSchema.extend({ manuscriptId: z.string().min(1) }).parse(request.params);
    const { workId } = params;
    const work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    const manuscript = work.manuscripts.get(params.manuscriptId);
    if (!manuscript) throw new NotFoundError(`unknown manuscript ${params.manuscriptId}`);
    const chapters = manuscript.chapterVersionIds.map((versionId) => work.versions.get(versionId)).filter((version): version is NonNullable<typeof version> => Boolean(version));
    if (chapters.length !== manuscript.chapterVersionIds.length) throw new Error('manuscript references missing chapter versions');
    return {
      manuscript: toManuscriptDto(manuscript),
      chapters: chapters.map((chapter) => ({ id: chapter.id, chapterNumber: chapter.chapterNumber, content: chapter.content, revision: chapter.revision })),
    };
  });

  app.post('/works/:workId/manuscripts/finalize', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    return { manuscript: toManuscriptDto(await workflow.finalizeManuscript(workId)) };
  });

  app.put('/works/:workId/world-pack', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const worldPack = saveWorldPackRequestSchema.parse(request.body ?? {});
    return { worldPack: await workflow.saveWorldPack(workId, worldPack) };
  });

  app.post('/works/:workId/design/generate', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const body = generateDesignRequestSchema.parse(request.body ?? {});
    const generated = body.stage === 'world_pack' ? await workflow.generateWorldPack(workId) : await workflow.generateStoryBible(workId, body.chapterTarget);
    return body.stage === 'world_pack' ? { worldPack: generated } : { storyBible: generated };
  });

  app.post('/works/:workId/world-pack/lock', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    return { worldPack: await workflow.lockWorldPack(workId) };
  });

  app.post('/works/:workId/world-pack/review', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    return { worldPack: await workflow.reviewWorldPack(workId) };
  });

  app.put('/works/:workId/story-bible', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const storyBible = saveStoryBibleRequestSchema.parse(request.body ?? {});
    return { storyBible: await workflow.saveStoryBible(workId, storyBible) };
  });

  app.post('/works/:workId/story-bible/lock', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    return { storyBible: await workflow.lockStoryBible(workId) };
  });

  app.post('/works/:workId/story-bible/review', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    return { storyBible: await workflow.reviewStoryBible(workId) };
  });

  app.get('/works/:workId/chapters', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    const chapters = work.adoptedVersions().map((version) => ({
      id: version.id, workId: version.workId, chapterNumber: version.chapterNumber,
      revision: version.revision, content: version.content, status: version.status, stale: version.stale,
      parentVersionId: version.parentVersionId, sourceCandidateId: version.sourceCandidateId,
      createdAt: version.createdAt,
    }));
    return { chapters };
  });

  app.get('/works/:workId/state/:chapterNumber', async (request) => {
    const { workId, chapterNumber } = chapterStateParamSchema.parse(request.params);
    const work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    const events = [...work.events.values()]
      .filter((event) => event.active && event.chapterNumber <= chapterNumber)
      .sort((a, b) => a.chapterNumber - b.chapterNumber || a.id.localeCompare(b.id));
    const characterIds = new Set([
      ...work.characters.keys(),
      ...(work.storyBible?.characters.map((character) => character.id) ?? []),
    ]);
    const fields = new Set(events.filter((event) => event.eventType === 'character_state').map((event) => event.predicate));
    const characterStates = [...characterIds].flatMap((characterId) => [...fields].map((field) => characterStateAt(work, characterId, field, chapterNumber)).filter((state): state is NonNullable<typeof state> => Boolean(state)));
    const knowledgeKeys = [...new Set(events.filter((event) => event.eventType === 'knowledge_belief').map((event) => `${event.subjectId}|${event.predicate}`))];
    const knowledgeStates = knowledgeKeys.map((key) => {
      const [characterId, proposition] = key.split('|');
      return knowledgeAt(work, characterId, proposition, chapterNumber);
    }).filter((state): state is NonNullable<typeof state> => Boolean(state));
    const relationshipIds = new Set([
      ...work.relationships.keys(),
      ...(work.storyBible?.relationships.map((relationship) => relationship.id) ?? []),
    ]);
    const arcStates = (work.storyBible?.arcs ?? []).map((arc) => storyArcAt(work, arc.id, chapterNumber) ?? {
      arcId: arc.id, status: 'planned' as const, value: { plannedOutcome: arc.plannedOutcome }, sourceEventId: '', sourceChapterVersionId: '',
    });
    const secretStates = (work.storyBible?.secrets ?? []).map((secret) => storySecretAt(work, secret.id, chapterNumber) ?? {
      secretId: secret.id, revealed: false, value: { revealCondition: secret.revealCondition }, sourceEventId: '', sourceChapterVersionId: '',
    });
    const promiseStates = (work.storyBible?.promises ?? []).map((promise) => storyPromiseAt(work, promise.id, chapterNumber) ?? {
      promiseId: promise.id, status: 'open' as const, value: { payoffCondition: promise.payoffCondition }, sourceEventId: '', sourceChapterVersionId: '',
    });
    const threadStates = (work.storyBible?.openThreads ?? []).map((thread) => storyThreadAt(work, thread.id, chapterNumber) ?? {
      threadId: thread.id, status: 'open' as const, value: { plannedResolution: thread.plannedResolution }, sourceEventId: '', sourceChapterVersionId: '',
    });
    const version = work.currentVersion(chapterNumber);
    const candidate = version?.sourceCandidateId
      ? work.candidates.get(version.sourceCandidateId)
      : [...work.candidates.values()].filter((item) => item.chapterNumber === chapterNumber).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const checks = candidate?.checks ?? [];
    return {
      chapterNumber,
      events,
      characterStates,
      knowledgeStates,
      relationships: [...relationshipIds].map((relationshipId) => relationshipAt(work, relationshipId, chapterNumber)),
      resourceStates: (work.worldPack?.resources ?? []).flatMap((resource) => [...new Set([...work.events.values()].filter((event) => event.active && event.eventType === 'resource_change' && event.subjectId === resource.id && event.chapterNumber <= chapterNumber).map((event) => event.predicate))].map((field) => resourceStateAt(work, resource.id, field, chapterNumber)).filter((state): state is NonNullable<typeof state> => Boolean(state))),
      artifactStates: (work.worldPack?.artifacts ?? []).flatMap((artifact) => [...new Set([...work.events.values()].filter((event) => event.active && event.eventType === 'artifact_change' && event.subjectId === artifact.id && event.chapterNumber <= chapterNumber).map((event) => event.predicate))].map((field) => artifactStateAt(work, artifact.id, field, chapterNumber)).filter((state): state is NonNullable<typeof state> => Boolean(state))),
      arcStates,
      secretStates,
      promiseStates,
      threadStates,
      quality: {
        contextManifest: contextManifestFor(work, chapterNumber),
        version: version ? { id: version.id, revision: version.revision, status: version.status, stale: version.stale, sourceCandidateId: version.sourceCandidateId } : undefined,
        candidate: candidate ? { id: candidate.id, status: candidate.status, proposedEvents: candidate.proposedEvents, observedEvents: candidate.observedEvents, checks } : undefined,
        checkCoverage: {
          total: checks.length,
          passed: checks.filter((check) => check.status === 'passed').length,
          failed: checks.filter((check) => check.status === 'failed').length,
          inconclusive: checks.filter((check) => check.status === 'inconclusive').length,
          unavailable: checks.filter((check) => check.status === 'unavailable').length,
        },
        plotNodes: [...work.plotNodes.values()].map((node) => ({ id: node.id, title: node.title, expectedResult: node.expectedResult, targetChapter: node.targetChapter, realization: node.realization })),
        impacts: work.impacts.filter((impact) => impact.changedChapterNumber <= chapterNumber),
        closureCoverage: closureCoverageFor(work, chapterNumber),
      },
    };
  });

  app.post('/works/:workId/chapters/:chapterNumber/generate', async (request, reply) => {
    const { workId, chapterNumber } = chapterNumberParamSchema.parse(request.params);
    const body = generateChapterRequestSchema.parse(request.body ?? {});
    const candidate = await workflow.generate(workId, chapterNumber, body.runId ?? `api:${workId}:${chapterNumber}`);
    return reply.code(201).send({ candidate: toCandidateDto(candidate) });
  });

  app.post('/works/:workId/runs', async (request, reply) => {
    const { workId } = workParamSchema.parse(request.params);
    const body = runRequestSchema.parse(request.body ?? {});
    const runId = body.runId ?? `api-run:${workId}`;
    if (body.background) {
      await launchBackgroundRun(workId, body.targetChapter, runId);
      const current = await repository.get(workId);
      return reply.code(202).send({ runId, status: 'running', checkpoint: current?.checkpoints.get(runId) });
    }
    const checkpoint = await workflow.runUntil(workId, body.targetChapter, generationCheckers(), runId);
    return { checkpoint };
  });

  app.post('/works/:workId/milestones/100/start', async (request, reply) => {
    const { workId } = workParamSchema.parse(request.params);
    const body = milestoneRequestSchema.parse(request.body ?? {});
    let work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    if (!work.worldPack) await workflow.generateWorldPack(workId);
    work = await repository.get(workId);
    if (!work?.worldPack) throw new Error('world pack generation did not produce a world pack');
    if (work.worldPack.status !== 'locked') {
      if (work.worldPack.status !== 'reviewed') await workflow.reviewWorldPack(workId);
      await workflow.lockWorldPack(workId);
    }
    work = await repository.get(workId);
    if (!work?.storyBible || plannedChapterCount(work) !== 100) await workflow.generateStoryBible(workId, 100);
    work = await repository.get(workId);
    if (!work?.storyBible) throw new Error('story bible generation did not produce a story bible');
    if (work.storyBible.status !== 'locked') {
      if (work.storyBible.status !== 'reviewed') await workflow.reviewStoryBible(workId);
      await workflow.lockStoryBible(workId);
    }
    const runId = body.runId ?? `milestone-100:${workId}`;
    await launchBackgroundRun(workId, 100, runId);
    const ready = await repository.get(workId);
    return reply.code(202).send({
      milestone: { targetChapter: 100, worldPack: ready?.worldPack, storyBible: ready?.storyBible },
      runId, status: 'running', checkpoint: ready?.checkpoints.get(runId),
    });
  });

  app.post('/works/:workId/milestones/450/start', async (request, reply) => {
    const { workId } = workParamSchema.parse(request.params);
    const body = milestoneRequestSchema.parse(request.body ?? {});
    let work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    if (!work.worldPack) await workflow.generateWorldPack(workId);
    work = await repository.get(workId);
    if (!work?.worldPack) throw new Error('world pack generation did not produce a world pack');
    if (work.worldPack.status !== 'locked') {
      if (work.worldPack.status !== 'reviewed') await workflow.reviewWorldPack(workId);
      await workflow.lockWorldPack(workId);
    }
    work = await repository.get(workId);
    if (!work?.storyBible || plannedChapterCount(work) !== 450) await workflow.generateStoryBible(workId, 450, work?.storyBible);
    work = await repository.get(workId);
    if (!work?.storyBible) throw new Error('story bible generation did not produce a story bible');
    if (plannedChapterCount(work) !== 450) throw new Error(`story bible must plan exactly 450 chapters (got ${plannedChapterCount(work)})`);
    if (work.storyBible.status !== 'locked') {
      if (work.storyBible.status !== 'reviewed') await workflow.reviewStoryBible(workId);
      await workflow.lockStoryBible(workId);
    }
    const runId = body.runId ?? `milestone-450:${workId}`;
    await launchBackgroundRun(workId, 450, runId);
    const ready = await repository.get(workId);
    return reply.code(202).send({
      milestone: { targetChapter: 450, worldPack: ready?.worldPack, storyBible: ready?.storyBible },
      runId, status: 'running', checkpoint: ready?.checkpoints.get(runId),
    });
  });

  app.get('/works/:workId/runs', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    return { checkpoints: [...work.checkpoints.values()], activeRunIds: [...activeRuns.keys()].filter((key) => key.startsWith(`${workId}:`)).map((key) => key.slice(workId.length + 1)) };
  });

  app.post('/works/:workId/candidates/:candidateId/check', async (request) => {
    const { workId, candidateId } = candidateParamSchema.parse(request.params);
    await workflow.check(workId, candidateId, generationCheckers());
    const candidate = (await repository.get(workId))?.candidates.get(candidateId);
    return { ok: true, candidate: candidate ? toCandidateDto(candidate) : undefined };
  });

  app.post('/works/:workId/candidates/:candidateId/adopt', async (request) => {
    const { workId, candidateId } = candidateParamSchema.parse(request.params);
    const body = adoptCandidateRequestSchema.parse(request.body ?? {});
    return workflow.adopt(workId, candidateId, body.expectedStateRevision);
  });

  registerSettingsRoutes(app, { workflow, repository, notFound: (message) => new NotFoundError(message) });

  app.get('/works/:workId/outbox', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    return { events: (await repository.outbox()).filter((event) => event.workId === workId) };
  });

  return { app, repository };
}

class NotFoundError extends Error {}

function apiError(code: ApiErrorCode, message: string, details?: unknown): ApiError {
  return { error: { code, message, details } };
}

function mapError(error: unknown): { status: number; body: ApiError } {
  if (error instanceof ZodError || (typeof (error as { statusCode?: unknown }).statusCode === 'number' && (error as { statusCode: number }).statusCode === 400)) {
    const issues = error instanceof ZodError ? error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) : [{ path: '$', message: error.message }];
    return { status: 400, body: apiError('VALIDATION_FAILED', 'request failed contract validation', issues) };
  }
  if (error instanceof LockedConstraintError) return { status: 409, body: apiError('LOCKED_CONSTRAINT', error.message) };
  if (error instanceof StaleCandidateError) return { status: 409, body: apiError('STALE_CANDIDATE', error.message) };
  if (error instanceof AdoptionBlocked) return { status: 409, body: apiError('ADOPTION_BLOCKED', error.message) };
  if (error instanceof SettingConflictError) return { status: 409, body: apiError('CONFLICT', error.message) };
  if (error instanceof CanonGateError) return { status: 409, body: apiError('CONFLICT', error.message) };
  if (error instanceof NotFoundError || /unknown (work|candidate|character|relationship|rule|plot node)\b/.test(String(error))) {
    return { status: 404, body: apiError('NOT_FOUND', error instanceof Error ? error.message : 'not found') };
  }
  return { status: 500, body: apiError('INTERNAL', 'internal error') };
}

if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  const { app } = createApiServer();
  const port = Number(process.env.PORT ?? 8787);
  app.listen({ port, host: '127.0.0.1' }).then(() => console.log(`novel-studio API listening on http://127.0.0.1:${port}`));
}
