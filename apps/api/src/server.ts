import { DesignQuestionConflictError } from '../../../novel-service-core/src/design-questions.ts';
import { annotationSources } from '../../../novel-service-core/src/design-review-annotations.ts';
import { orderedStoryEvents, resolveStoryEventOrder } from '../../../novel-service-core/src/event-order.ts';
import { completeDesignReviewRun, designReviewStageInput } from '../../../novel-service-core/src/design-review-run.ts';
import { restoreChapterReviewRun } from '../../../novel-service-core/src/chapter-review.ts';
import { addDesignReviewAnnotationSchema, designReviewAreaSchema } from 'novel-studio-contracts';
import { designReviewOverview, DesignReviewError } from '../../../novel-service-core/src/design-review.ts';
import Fastify, { type FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import {
  adoptCandidateRequestSchema,
  createRulingRequestSchema,
  createWorkRequestSchema,
  generateChapterRequestSchema,
  generateDesignRequestSchema,
  updateWorkRequestSchema,
  activateModelChannelRequestSchema,
  probeModelChannelRequestSchema,
  updateModelSettingsRequestSchema,
  confirmBriefRequestSchema,
  generateOutlinesRequestSchema,
  generatePlanRequestSchema,
  savePlanRequestSchema,
  saveStoryBibleRequestSchema,
  saveWorldPackRequestSchema,
  type ApiError,
  type ApiErrorCode,
  type CandidateDto,
  type ChapterReadinessDto,
  type ManuscriptRevisionDto,
  type WorkDto,
} from 'novel-studio-contracts';
import {
  AdoptionBlocked,
  characterStateAt,
  DemoCandidateError,
  QualityGateError,
  ReadinessError,
  RulingNotAllowedError,
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
  storyVolumeAt,
  knowledgeAt,
  canonConsistencyChecker,
  chapterLengthChecker,
  contextManifestFor,
  closureCoverageFor,
  designSnapshotFor,
  qualityAuditFor,
  observedEventsChecker,
  passChecker,
  type ChapterCandidate,
  type Checkpoint,
  type CheckPolicy,
  type ManuscriptRevision,
  type ModelProvider,
  type Work,
} from '../../../novel-service-core/src/core.ts';
import { CanonGateError } from '../../../novel-service-core/src/world.ts';
import { effectiveBrief, PlanConflictError, PlanGateError } from '../../../novel-service-core/src/planning.ts';
import {
  ChapterWorkflow,
  DesignCandidateValidationError,
  IdempotencyConflictError,
  InMemoryWorkRepository,
  LeaseLostError,
  PlanProviderMissingError,
  RunCancelledError,
  RunInProgressError,
  type DesignProvider,
  type PlanProvider,
  type WorkRepository,
} from '../../../packages/application/src/index.ts';
import { BudgetExceededError, ModelTimeoutError, redactSecrets, UsageLedger } from '../../../packages/model-gateway/src/index.ts';
import { PrismaWorkRepository } from '../../../packages/persistence/src/prisma-repository.ts';
import { JsonBookPlanner, JsonDesignPlanner, OpenAICompatibleChapterProvider, OpenAICompatiblePlanningClient, PlanningParseError } from '../../../packages/planner/src/index.ts';
import { collectHotTopics } from './hot-topics.ts';
import { registerSettingsRoutes } from './settings-routes.ts';
import {
  activeChannel, backupConnections, connectionOf, listModelIds, loadModelStore, newModelChannelId, providersFromConnection, removeChannel, saveModelStore, testModelConnection, toModelSettingsView, upsertChannel,
  type ModelChannel, type ModelConnection, type ModelStore,
} from './model-settings.ts';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * Local-first default: SQLite via Prisma, one file at data/novel-studio.db.
 * Set NOVEL_REPOSITORY=memory to force the in-memory repository (used by tests).
 */
function dataDirectory(): string {
  const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');
  mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

function createDefaultRepository(): WorkRepository {
  if (process.env.NOVEL_REPOSITORY === 'memory') return new InMemoryWorkRepository();
  process.env.DATABASE_URL ??= `file:${join(dataDirectory(), 'novel-studio.db')}`;
  return new PrismaWorkRepository();
}

export interface ApiDependencies {
  repository?: WorkRepository;
  provider?: ModelProvider;
  designProvider?: DesignProvider;
  /** Book plan and chapter outline generation; defaults to the env-configured planning model. */
  planProvider?: PlanProvider;
  /** When set, all non-/health routes require `Authorization: Bearer <token>`. */
  authToken?: string;
  /**
   * P0 is chapter-by-chapter only; multi-chapter runs and milestones stay off
   * unless explicitly enabled (NOVEL_ENABLE_BATCH_RUNS=true) for acceptance scripts.
   */
  allowBatchRuns?: boolean;
  /** Shared model usage ledger; defaults to one built from NOVEL_MODEL_* limits. */
  ledger?: UsageLedger;
  /**
   * When set, model endpoint, key and model names come from a local file
   * (seeded by the environment) and can be changed through /settings/model.
   * Tests leave this off so they keep the injected provider.
   */
  manageModelSettings?: boolean;
  modelSettingsPath?: string;
  /** Defaults to true. Tests turn this off so a saved key does not leak into process.env. */
  writeProcessEnvironment?: boolean;
  /** Hot-topic lookup. Tests inject a fixture instead of calling public boards. */
  topicSearch?: (query: string) => Promise<import('novel-studio-contracts').HotTopicsResponse>;
}

const optionalNumber = (raw: string | undefined) => (raw === undefined || raw === '' ? undefined : Number(raw));

/** One ledger for every model role in this process: planning, writing, extraction and failed calls. */
export function createUsageLedger(): UsageLedger {
  return new UsageLedger(Number(process.env.NOVEL_MODEL_BUDGET_USD ?? Number.POSITIVE_INFINITY), undefined, {
    maxCalls: optionalNumber(process.env.NOVEL_MODEL_MAX_CALLS),
    maxOutputTokens: optionalNumber(process.env.NOVEL_MODEL_MAX_OUTPUT_TOKENS),
  });
}

export function defaultProvider(ledger: UsageLedger = createUsageLedger()): ModelProvider {
  const endpoint = process.env.NOVEL_MODEL_ENDPOINT;
  const apiKey = process.env.NOVEL_MODEL_API_KEY;
  const model = process.env.NOVEL_WRITING_MODEL ?? process.env.NOVEL_PLANNING_MODEL;
  const timeoutMs = Number(process.env.NOVEL_MODEL_TIMEOUT_MS ?? 180_000);
  if (endpoint && apiKey && model) {
    return new OpenAICompatibleChapterProvider(endpoint, apiKey, model, ledger, timeoutMs, process.env.NOVEL_INDEPENDENT_EXTRACTION !== 'false');
  }
  return {
    demo: true,
    generateChapter: ({ chapterNumber, context }) => {
      const event = { eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: chapterNumber + context.includedEventIds.length, storyTime: chapterNumber, evidence: 'paragraph 1' };
      return { content: `第${chapterNumber}章：主角踏入新的修行阶段。`, proposedEvents: [event], observedEvents: [event] };
    },
  };
}

function defaultDesignProvider(ledger: UsageLedger): DesignProvider | undefined {
  const endpoint = process.env.NOVEL_MODEL_ENDPOINT;
  const apiKey = process.env.NOVEL_MODEL_API_KEY;
  const model = process.env.NOVEL_PLANNING_MODEL;
  if (!endpoint || !apiKey || !model) return undefined;
  const targetChapters = Number(process.env.NOVEL_PLANNING_CHAPTER_TARGET ?? 100);
  const timeoutMs = Number(process.env.NOVEL_MODEL_TIMEOUT_MS ?? 180_000);
  return new JsonDesignPlanner(new OpenAICompatiblePlanningClient(endpoint, apiKey, model, ledger, timeoutMs), targetChapters);
}

function defaultPlanProvider(ledger: UsageLedger): PlanProvider | undefined {
  const endpoint = process.env.NOVEL_MODEL_ENDPOINT;
  const apiKey = process.env.NOVEL_MODEL_API_KEY;
  const model = process.env.NOVEL_PLANNING_MODEL;
  if (!endpoint || !apiKey || !model) return undefined;
  const timeoutMs = Number(process.env.NOVEL_MODEL_TIMEOUT_MS ?? 180_000);
  return new JsonBookPlanner(new OpenAICompatiblePlanningClient(endpoint, apiKey, model, ledger, timeoutMs));
}

const chapterCheckers = [passChecker, canonConsistencyChecker, observedEventsChecker, chapterLengthChecker];

/**
 * Every registered chapter checker is required; a missing or non-passing one
 * blocks adoption. Only the length check may be ruled a false positive: the
 * others guard hard constraints and the independent extraction.
 */
export const chapterCheckPolicy: CheckPolicy = {
  version: 'chapter-policy-v3',
  required: [...chapterCheckers.map((checker) => checker.name), 'chapter_content_review'],
  overridable: ['chapter_length'],
};

/** Fencing tokens stay on the server. */
function toCheckpointDto(checkpoint: Checkpoint) {
  const { leaseToken, ...rest } = checkpoint;
  return { ...rest, active: Boolean(leaseToken && checkpoint.leaseExpiresAt && Date.parse(checkpoint.leaseExpiresAt) > Date.now()) };
}

function checkpointOf(work: Work | undefined, runId: string) {
  const checkpoint = work?.checkpoints.get(runId);
  return checkpoint ? toCheckpointDto(checkpoint) : undefined;
}

function generationCheckers() {
  return chapterCheckers;
}

class BatchRunsDisabledError extends Error {}

const chapterNumberParamSchema = z.object({ workId: z.string().min(1), chapterNumber: z.coerce.number().int().min(1) });
const candidateParamSchema = z.object({ workId: z.string().min(1), candidateId: z.string().min(1) });
const workParamSchema = z.object({ workId: z.string().min(1) });
const runControlParamSchema = z.object({ workId: z.string().min(1), runId: z.string().min(1), action: z.enum(['pause', 'cancel']) });
const runRequestSchema = z.object({ targetChapter: z.number().int().min(1).max(450), runId: z.string().min(1).max(200).optional(), background: z.boolean().optional() });
const milestoneRequestSchema = z.object({ runId: z.string().min(1).max(200).optional() });
const chapterStateParamSchema = z.object({ workId: z.string().min(1), chapterNumber: z.coerce.number().int().min(1) });

function plannedChapterCount(work: Work): number {
  return work.storyBible?.volumes.reduce((sum, volume) => sum + volume.plannedChapterCount, 0) ?? 0;
}

function toWorkDto(work: Work): WorkDto {
  return { id: work.id, title: work.title, stateRevision: work.stateRevision, constraintRevision: work.constraintRevision, covenant: work.covenant };
}

function candidateIsStale(candidate: ChapterCandidate, work: Work): boolean {
  if (candidate.status !== 'candidate') return false;
  return candidate.generatedAgainstRevision !== work.stateRevision
    || candidate.generatedAgainstConstraintRevision !== work.constraintRevision
    || candidate.generatedAgainstWorldPackRevision !== work.worldPack?.revision
    || candidate.generatedAgainstStoryBibleRevision !== work.storyBible?.revision
    || Boolean(work.activePlanId && candidate.planRevisionId !== work.activePlanId);
}

function toCandidateDto(candidate: ChapterCandidate, work: Work): CandidateDto {
  // Full review inputs are immutable persistence evidence. Do not repeat the
  // entire world, plan and prior chapters in both current and historical lists.
  const checks = (rows: ChapterCandidate['checks']) => rows.map(check => {
    const { chapterReview: record, ...rest } = check;
    if (!record) return rest;
    const { input, stage, ...chapterReview } = record;
    return { ...rest, chapterReview: { ...chapterReview, ...(stage ? { stage: { ...stage } } : {}), inputAvailable: Boolean(input) } };
  });
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
    generatedAgainstWorldPackRevision: candidate.generatedAgainstWorldPackRevision,
    generatedAgainstStoryBibleRevision: candidate.generatedAgainstStoryBibleRevision,
    contentHash: candidate.contentHash,
    origin: candidate.origin,
    planRevisionId: candidate.planRevisionId,
    brief: candidate.brief,
    stale: candidateIsStale(candidate, work),
    checks: checks(candidate.checks),
    checkHistory: checks(candidate.checkRuns),
    rulings: candidate.rulings,
    usage: candidate.usage,
    adoptedVersionId: candidate.adoptedVersionId,
    createdAt: candidate.createdAt,
  };
}

function toManuscriptDto(manuscript: ManuscriptRevision): ManuscriptRevisionDto {
  const { exportSnapshot, ...dto } = manuscript;
  return dto;
}

export function createApiServer(dependencies: ApiDependencies = {}): { app: FastifyInstance; repository: WorkRepository } {
  const repository = dependencies.repository ?? createDefaultRepository();
  const topicSearch = dependencies.topicSearch ?? collectHotTopics;
  const ledger = dependencies.ledger ?? createUsageLedger();
  const settingsPath = dependencies.modelSettingsPath ?? join(dataDirectory(), 'model-settings.json');
  let store: ModelStore | undefined = dependencies.manageModelSettings ? loadModelStore(settingsPath) : undefined;
  const initial = store ? providersFromConnection(connectionOf(activeChannel(store), store.source), ledger, backupConnections(store)) : undefined;
  const workflow = new ChapterWorkflow(
    repository,
    dependencies.provider ?? initial?.provider ?? defaultProvider(ledger),
    dependencies.designProvider ?? (store ? initial?.designProvider : defaultDesignProvider(ledger)),
    {
      checkPolicy: chapterCheckPolicy,
      planProvider: dependencies.planProvider ?? (store ? initial?.planProvider : defaultPlanProvider(ledger)),
    },
  );
  const allowBatchRuns = dependencies.allowBatchRuns ?? process.env.NOVEL_ENABLE_BATCH_RUNS === 'true';
  const requireBatchRuns = () => {
    if (!allowBatchRuns) throw new BatchRunsDisabledError('multi-chapter runs are disabled; generate, review and adopt one chapter at a time');
  };
  const activeRuns = new Map<string, Promise<void>>();
  async function launchBackgroundRun(workId: string, targetChapter: number, runId: string): Promise<void> {
    const key = `${workId}:${runId}`;
    if (activeRuns.has(key)) return;
    // Surface lease conflicts to the caller instead of losing them in the background task.
    const work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    const holder = [...work.checkpoints.values()].find((checkpoint) => toCheckpointDto(checkpoint).active);
    if (holder) throw new RunInProgressError(`run ${holder.runId} is already writing this work`);
    const existing = work.checkpoints.get(runId);
    if (existing && existing.targetChapter !== targetChapter) throw new IdempotencyConflictError(`run ${runId} targets chapter ${existing.targetChapter}; start a new run for a different target`);
    if (existing?.phase === 'cancelled') throw new RunCancelledError(`run ${runId} was cancelled; start a new run`);
    let nextChapter = 1;
    while (work.currentVersion(nextChapter)) nextChapter += 1;
    if (nextChapter <= targetChapter) {
      const blockers = await workflow.readiness(workId, nextChapter);
      if (blockers.length) throw new ReadinessError(blockers);
    }
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
    reply.header('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
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

  if (store) {
    const persist = (next: ModelStore, savedId?: string) => {
      store = next;
      saveModelStore(settingsPath, next, dependencies.writeProcessEnvironment !== false);
      const built = providersFromConnection(connectionOf(activeChannel(next), 'saved'), ledger, backupConnections(next));
      if (!dependencies.provider) workflow.applyModelProviders(built.provider, built.designProvider, built.planProvider);
      return toModelSettingsView(next, built, savedId);
    };
    const channelFrom = (body: unknown): { channel: ModelChannel; activate: boolean } => {
      const parsed = updateModelSettingsRequestSchema.parse(body ?? {});
      const existing = parsed.id ? store!.channels.find((channel) => channel.id === parsed.id) : undefined;
      if (parsed.id && !existing) throw new NotFoundError(`unknown channel ${parsed.id}`);
      if (!existing && store!.channels.length >= 20) throw new Error('at most 20 model channels');
      const channel: ModelChannel = {
        id: existing?.id ?? newModelChannelId(),
        name: parsed.name,
        endpoint: parsed.endpoint,
        apiKey: parsed.clearApiKey ? '' : (parsed.apiKey?.trim() ? parsed.apiKey : existing?.apiKey ?? ''),
        planningModel: parsed.planningModel,
        writingModel: parsed.writingModel,
        timeoutMs: parsed.timeoutMs,
        independentExtraction: parsed.independentExtraction,
        fallback: parsed.fallback,
      };
      const activate = parsed.activate === true || channel.id === store!.activeId || !store!.activeId;
      return { channel, activate };
    };
    const probeConnection = (body: unknown): ModelConnection => {
      const parsed = probeModelChannelRequestSchema.parse(body ?? {});
      const existing = parsed.id ? store!.channels.find((channel) => channel.id === parsed.id) : undefined;
      if (parsed.id && !existing) throw new NotFoundError(`unknown channel ${parsed.id}`);
      return {
        endpoint: parsed.endpoint || existing?.endpoint || '',
        apiKey: parsed.apiKey?.trim() ? parsed.apiKey : existing?.apiKey ?? '',
        planningModel: parsed.planningModel,
        writingModel: parsed.writingModel,
        timeoutMs: parsed.timeoutMs,
        independentExtraction: existing?.independentExtraction ?? true,
        source: 'saved',
      };
    };

    app.get('/settings/model', async () => {
      const current = store!;
      return toModelSettingsView(current, providersFromConnection(connectionOf(activeChannel(current), current.source), ledger, backupConnections(current)));
    });

    app.put('/settings/model', async (request) => {
      const { channel, activate } = channelFrom(request.body);
      return persist(upsertChannel(store!, channel, activate), channel.id);
    });

    app.post('/settings/model/activate', async (request) => {
      const { id } = activateModelChannelRequestSchema.parse(request.body ?? {});
      const channel = store!.channels.find((item) => item.id === id);
      if (!channel) throw new NotFoundError(`unknown channel ${id}`);
      return persist(upsertChannel(store!, channel, true), channel.id);
    });

    app.delete('/settings/model/channels/:channelId', async (request) => {
      const { channelId } = z.object({ channelId: z.string().min(1) }).parse(request.params);
      if (!store!.channels.some((channel) => channel.id === channelId)) throw new NotFoundError(`unknown channel ${channelId}`);
      return persist(removeChannel(store!, channelId));
    });

    app.post('/settings/model/test', async (request) => testModelConnection(probeConnection(request.body)));

    app.post('/settings/model/models', async (request) => {
      try {
        return { models: await listModelIds(probeConnection(request.body)) };
      } catch (error) {
        return { models: [] as string[], message: error instanceof Error ? error.message : String(error) };
      }
    });
  }

  app.get('/topics/hot', async (request) => {
    const query = z.object({ q: z.string().trim().max(80).optional() }).parse(request.query ?? {});
    return topicSearch(query.q ?? '');
  });

  app.post('/works', async (request, reply) => {
    const body = createWorkRequestSchema.parse(request.body ?? {});
    const work = await workflow.createWork(body.title, body.covenant);
    return reply.code(201).send(toWorkDto(work));
  });

  app.patch('/works/:workId', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const body = updateWorkRequestSchema.parse(request.body ?? {});
    const { work, impact } = await workflow.updateWorkWithImpact(workId, body);
    return { ...toWorkDto(work), impact };
  });

  app.get('/works/:workId/covenant/history', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    return { revisions: work.covenantHistory };
  });

  app.get('/works/:workId/plans', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    return { ...(await workflow.planOverview(workId)), planningConfigured: workflow.planningConfigured };
  });

  app.get('/works/:workId/plans/history', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    return { plans: [...work.plans.values()].sort((a, b) => a.revision - b.revision), activePlanId: work.activePlanId };
  });

  app.post('/works/:workId/plans/generate', async (request, reply) => {
    const { workId } = workParamSchema.parse(request.params);
    const body = generatePlanRequestSchema.parse(request.body ?? {});
    return reply.code(201).send({ plan: await workflow.generatePlan(workId, body) });
  });

  app.post('/works/:workId/plans/outlines', async (request, reply) => {
    const { workId } = workParamSchema.parse(request.params);
    const body = generateOutlinesRequestSchema.parse(request.body ?? {});
    return reply.code(201).send({ plan: await workflow.generateOutlines(workId, body) });
  });

  app.put('/works/:workId/plans', async (request, reply) => {
    const { workId } = workParamSchema.parse(request.params);
    const body = savePlanRequestSchema.parse(request.body ?? {});
    return reply.code(201).send({ plan: await workflow.savePlan(workId, body) });
  });

  app.post('/works/:workId/plans/:planId/review', async (request) => {
    const { workId, planId } = workParamSchema.extend({ planId: z.string().min(1) }).parse(request.params);
    const review = await workflow.reviewPlan(workId, planId);
    const work = await repository.get(workId);
    return { review, plan: work?.plans.get(planId) };
  });

  app.post('/works/:workId/plans/:planId/approve', async (request) => {
    const { workId, planId } = workParamSchema.extend({ planId: z.string().min(1) }).parse(request.params);
    return { plan: await workflow.approvePlan(workId, planId) };
  });

  app.get('/works/:workId/next-chapter', async (request) => workflow.prepareNextChapter(workParamSchema.parse(request.params).workId));

  app.get('/works/:workId/chapters/:chapterNumber/brief', async (request) => {
    const { workId, chapterNumber } = chapterNumberParamSchema.parse(request.params);
    const work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    return { chapterNumber, brief: effectiveBrief(work, chapterNumber) };
  });

  app.post('/works/:workId/chapters/:chapterNumber/brief/confirm', async (request, reply) => {
    const { workId, chapterNumber } = chapterNumberParamSchema.parse(request.params);
    const body = confirmBriefRequestSchema.parse(request.body ?? {});
    return reply.code(201).send({ brief: await workflow.confirmBrief(workId, chapterNumber, body) });
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
    return { worldPack: work.worldPack, storyBible: work.storyBible, constraintRevision: work.constraintRevision, atomicCandidateSave: true };
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

  app.get('/works/:workId/design/content-reviews', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    const { planId, since, view } = z.object({ planId: z.string().min(1).optional(), since: z.string().max(64).optional(), view: z.enum(['full', 'summary']).default('full') }).parse(request.query);
    const plans = [...work.plans.values()].filter((plan) => plan.status !== 'superseded').sort((a, b) => b.revision - a.revision);
    const selected = planId ? plans.find((plan) => plan.id === planId) : plans[0];
    if (planId && !selected) throw new NotFoundError(`unknown plan ${planId}`);
    const overview = { ...designReviewOverview(work, selected?.id), selectedPlan: selected ? { id: selected.id, revision: selected.revision, status: selected.status } : undefined, plans: plans.map((plan) => ({ id: plan.id, revision: plan.revision, status: plan.status })) };
    // Saved reports are immutable. Track their identities and all mutable run
    // metadata without serializing their potentially huge source/evidence text.
    const revisionToken = createHash('sha256').update(JSON.stringify({ workId, view, ...overview, reports: overview.reports.map(report => report.id) })).digest('hex');
    if (since === revisionToken) return { unchanged: true, revisionToken };
    return { ...overview, reports: view === 'summary' ? overview.reports.map(({ sources, checks, resolvedDeferrals, ...report }) => report) : overview.reports, revisionToken };
  });

  app.get('/works/:workId/design/content-reviews/:reportId', async (request) => {
    const { workId, reportId } = workParamSchema.extend({ reportId: z.string().min(1) }).parse(request.params);
    const work = await repository.get(workId);
    const report = work?.designContentReviews.get(reportId);
    if (!report) throw new NotFoundError('unknown design review report');
    return { report };
  });

  app.post('/works/:workId/design/content-reviews', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const { area, planId } = z.object({ area: designReviewAreaSchema, planId: z.string().min(1).optional() }).strict().parse(request.body);
    return { report: await workflow.reviewDesignContent(workId, area, planId) };
  });

  app.get('/works/:workId/design/review-annotations', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const { runId, stageId } = z.object({ runId: z.string().min(1), stageId: z.string().min(1).optional() }).strict().parse(request.query);
    const work = await repository.get(workId);
    const run = work?.designReviewRuns.get(runId);
    if (!work || !run || stageId && !run.stages.some(stage => stage.id === stageId)) throw new NotFoundError('unknown review run or stage');
    const annotations = [...work.designReviewAnnotations.values()].filter(note => note.runId === runId && (!stageId || note.stageId === stageId));
    for (const note of annotations) annotationSources(work, note);
    return { annotations };
  });
  app.get('/works/:workId/design/review-annotations/:annotationId', async (request) => {
    const { workId, annotationId } = workParamSchema.extend({ annotationId: z.string().min(1) }).parse(request.params);
    const work = await repository.get(workId), annotation = work?.designReviewAnnotations.get(annotationId);
    if (!work || !annotation) throw new NotFoundError('unknown review annotation');
    return { annotation, sources: annotationSources(work, annotation) };
  });
  app.post('/works/:workId/design/review-annotations', async (request, reply) => {
    const { workId } = workParamSchema.parse(request.params);
    const input = addDesignReviewAnnotationSchema.parse(request.body);
    if (!await repository.get(workId)) throw new NotFoundError(`unknown work ${workId}`);
    return reply.code(201).send({ annotation: await workflow.addDesignReviewAnnotation(workId, input) });
  });

  app.post('/works/:workId/design/review-runs', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const { area, planId } = z.object({ area: designReviewAreaSchema, planId: z.string().min(1).optional() }).strict().parse(request.body);
    const run = await workflow.startDesignReview(workId, area, planId);
    return { runId: run.id };
  });
  app.post('/works/:workId/design/review-runs/:runId/step', async (request) => {
    const { workId, runId } = z.object({ workId: z.string(), runId: z.string() }).parse(request.params);
    const run = await workflow.stepDesignReview(workId, runId);
    return { runId: run.id, status: run.status, completed: run.stages.filter(s => s.result).length, total: run.stages.length, reportId: run.reportId };
  });
  app.post('/works/:workId/design/review-runs/:runId/restart', async (request) => {
    const { workId, runId } = z.object({ workId: z.string().min(1), runId: z.string().min(1) }).parse(request.params);
    const { expectedInputHash } = z.object({ expectedInputHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(request.body);
    const run = await workflow.restartDesignReview(workId, runId, expectedInputHash);
    return { runId: run.id };
  });
  app.get('/works/:workId/design/review-runs/:runId/stages/:stageId', async (request) => {
    const { workId, runId, stageId } = z.object({ workId: z.string(), runId: z.string(), stageId: z.string() }).parse(request.params);
    const work = await repository.get(workId);
    const run = work?.designReviewRuns.get(runId);
    const stage = run?.stages.find(stage => stage.id === stageId);
    if (!run || !stage) throw new NotFoundError('unknown review stage');
    return { stage, input: designReviewStageInput(run, stage) };
  });

  app.get('/works/:workId/quality-audit', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    return { audit: qualityAuditFor(work) };
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
    const chapterIds = new Set(manuscript.chapterVersionIds);
    const snapshot = manuscript.exportSnapshot;
    const worldPack = snapshot ? work.designHistory.get(snapshot.worldPackDesignId)?.snapshot
      : designSnapshotFor(work, 'world_pack', manuscript.worldPackRevision);
    const storyBible = snapshot ? work.designHistory.get(snapshot.storyBibleDesignId)?.snapshot
      : designSnapshotFor(work, 'story_bible', manuscript.storyBibleRevision);
    if (!worldPack || !storyBible) throw new CanonGateError('manuscript design snapshot is missing; export cannot substitute the current design');
    const designHistory = snapshot
      ? snapshot.designHistoryIds.map(id => work.designHistory.get(id))
      : [...work.designHistory.values()].filter(item => item.createdAt <= manuscript.createdAt
        && item.revision <= (item.kind === 'world_pack' ? manuscript.worldPackRevision : manuscript.storyBibleRevision));
    if (designHistory.some(item => !item)) throw new CanonGateError('manuscript design history is missing; export cannot substitute the current history');
    return {
      work: { id: work.id, title: snapshot?.title ?? null, covenant: snapshot?.covenant ?? null,
        metadataStatus: snapshot ? 'frozen' : 'unavailable_legacy' },
      worldPack,
      storyBible,
      designHistory: designHistory.sort((a, b) => a!.createdAt.localeCompare(b!.createdAt)),
      manuscript: toManuscriptDto(manuscript),
      chapters: chapters.map((chapter) => ({ id: chapter.id, chapterNumber: chapter.chapterNumber, content: chapter.content, revision: chapter.revision })),
      events: [...work.events.values()]
        .filter((event) => chapterIds.has(event.chapterVersionId))
        // Membership is effective in this frozen book, independently of the current draft.
        .map(event => ({ ...event, active: true }))
        .sort((a, b) => a.chapterNumber - b.chapterNumber || a.id.localeCompare(b.id)),
      closureCoverage: snapshot?.closureCoverage ?? closureCoverageFor(work, manuscript.chapterCount, { storyBibleRevision: manuscript.storyBibleRevision, chapterVersionIds: manuscript.chapterVersionIds }),
    };
  });

  app.post('/works/:workId/manuscripts/finalize', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    return { manuscript: toManuscriptDto(await workflow.finalizeManuscript(workId)) };
  });

  app.get('/works/:workId/design/candidate', async (request) =>
    workflow.designCandidate(workParamSchema.parse(request.params).workId));

  app.put('/works/:workId/design/candidate', { bodyLimit: 20 * 1024 * 1024 }, async (request, reply) => {
    const { workId } = workParamSchema.parse(request.params);
    // Keep the candidate raw: the workflow rejects silent schema transforms.
    const body = z.object({ basePlanId: z.string().min(1), expectedInputHash: z.string().regex(/^[a-f0-9]{64}$/),
      candidate: z.unknown(), note: z.string().max(2000).optional() }).strict().parse(request.body);
    return reply.code(201).send(await workflow.saveDesignCandidate(workId, { ...body, candidate: body.candidate }));
  });

  app.put('/works/:workId/world-pack', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const worldPack = saveWorldPackRequestSchema.parse(request.body ?? {});
    return { worldPack: await workflow.saveWorldPack(workId, worldPack) };
  });

  app.post('/works/:workId/design/generate', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const body = generateDesignRequestSchema.parse(request.body ?? {});
    const generated = body.stage === 'world_pack' ? await workflow.generateWorldPack(workId, body.chapterTarget) : await workflow.generateStoryBible(workId, body.chapterTarget);
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
    const { candidateId } = z.object({ candidateId: z.string().min(1).optional() }).parse(request.query);
    const work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    const chapterCandidates = [...work.candidates.values()].filter(item => item.chapterNumber === chapterNumber)
      .reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const selectedCandidate = candidateId ? chapterCandidates.find(item => item.id === candidateId) : undefined;
    if (candidateId && !selectedCandidate) throw new NotFoundError('candidate does not belong to this work and chapter');
    const events = orderedStoryEvents(work)
      .filter((event) => event.active && event.chapterNumber <= chapterNumber);
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
    const volumeStates = (work.storyBible?.volumes ?? []).map((volume) => storyVolumeAt(work, volume.id, chapterNumber) ?? {
      volumeId: volume.id, status: 'planned' as const, value: { endState: volume.endState }, sourceEventId: '', sourceChapterVersionId: '',
    });
    const version = work.currentVersion(chapterNumber);
    const candidate = selectedCandidate ?? (version?.sourceCandidateId
      ? work.candidates.get(version.sourceCandidateId)
      : chapterCandidates[0]);
    const checks = candidate?.checks ?? [];
    return {
      chapterNumber,
      // Current author-facing identity labels, not chapter-time knowledge or
      // additional story facts. Stable IDs remain on every relationship.
      characterNames: Object.fromEntries([
        ...(work.storyBible?.characters.map(character => [character.id, character.name]) ?? []),
        ...[...work.characters.values()].map(character => [character.id, character.name]),
      ]),
      events,
      eventOrderIssues: resolveStoryEventOrder(work, events).issues,
      characterStates,
      knowledgeStates,
      relationships: [...relationshipIds].map((relationshipId) => relationshipAt(work, relationshipId, chapterNumber)).filter((relationship): relationship is NonNullable<typeof relationship> => Boolean(relationship)),
      resourceStates: (work.worldPack?.resources ?? []).flatMap((resource) => [...new Set([...work.events.values()].filter((event) => event.active && event.eventType === 'resource_change' && event.subjectId === resource.id && event.chapterNumber <= chapterNumber).map((event) => event.predicate))].map((field) => resourceStateAt(work, resource.id, field, chapterNumber)).filter((state): state is NonNullable<typeof state> => Boolean(state))),
      artifactStates: (work.worldPack?.artifacts ?? []).flatMap((artifact) => [...new Set([...work.events.values()].filter((event) => event.active && event.eventType === 'artifact_change' && event.subjectId === artifact.id && event.chapterNumber <= chapterNumber).map((event) => event.predicate))].map((field) => artifactStateAt(work, artifact.id, field, chapterNumber)).filter((state): state is NonNullable<typeof state> => Boolean(state))),
      arcStates,
      secretStates,
      promiseStates,
      threadStates,
      volumeStates,
      quality: {
        contextManifest: contextManifestFor(work, chapterNumber),
        version: version ? { id: version.id, revision: version.revision, status: version.status, stale: version.stale, sourceCandidateId: version.sourceCandidateId } : undefined,
        candidate: candidate ? toCandidateDto(candidate, work) : undefined,
        reviewCandidates: chapterCandidates.map(item => ({
          id: item.id, status: item.status, origin: item.origin, createdAt: item.createdAt,
          isCurrentVersion: version?.sourceCandidateId === item.id,
          stale: item.status === 'adopted' ? Boolean(item.adoptedVersionId && work.versions.get(item.adoptedVersionId)?.stale) : candidateIsStale(item, work),
        })),
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
    // Without a client idempotency key every click is a new attempt; a key makes retries return the same candidate.
    const candidate = await workflow.generate(workId, chapterNumber, body.runId ?? `api:${randomUUID()}`, body.mode);
    const work = await repository.get(workId);
    return reply.code(201).send({ candidate: toCandidateDto(candidate, work!) });
  });

  app.get('/works/:workId/chapters/:chapterNumber/readiness', async (request): Promise<ChapterReadinessDto> => {
    const { workId, chapterNumber } = chapterNumberParamSchema.parse(request.params);
    const blockers = await workflow.readiness(workId, chapterNumber);
    return {
      chapterNumber, ready: blockers.length === 0, modelConfigured: workflow.modelConfigured, blockers,
      requiredChecks: workflow.checkPolicy?.required ?? [], checkPolicyVersion: workflow.checkPolicy?.version,
    };
  });

  app.post('/works/:workId/runs', async (request, reply) => {
    requireBatchRuns();
    const { workId } = workParamSchema.parse(request.params);
    const body = runRequestSchema.parse(request.body ?? {});
    const runId = body.runId ?? `api-run:${workId}`;
    if (body.background) {
      await launchBackgroundRun(workId, body.targetChapter, runId);
      const current = await repository.get(workId);
      return reply.code(202).send({ runId, status: 'running', checkpoint: checkpointOf(current, runId) });
    }
    const checkpoint = await workflow.runUntil(workId, body.targetChapter, generationCheckers(), runId);
    return { checkpoint: toCheckpointDto(checkpoint) };
  });

  app.post('/works/:workId/milestones/100/start', async (request, reply) => {
    requireBatchRuns();
    const { workId } = workParamSchema.parse(request.params);
    const body = milestoneRequestSchema.parse(request.body ?? {});
    const work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    if (work.worldPack?.status !== 'locked' || work.storyBible?.status !== 'locked' || plannedChapterCount(work) !== 100) {
      throw new CanonGateError('100-chapter run requires a separately reviewed and locked design; the current design was not changed');
    }
    const runId = body.runId ?? `milestone-100:${workId}`;
    await launchBackgroundRun(workId, 100, runId);
    const ready = await repository.get(workId);
    return reply.code(202).send({
      milestone: { targetChapter: 100, worldPack: ready?.worldPack, storyBible: ready?.storyBible },
      runId, status: 'running', checkpoint: checkpointOf(ready, runId),
    });
  });

  app.post('/works/:workId/milestones/450/start', async (request, reply) => {
    requireBatchRuns();
    const { workId } = workParamSchema.parse(request.params);
    const body = milestoneRequestSchema.parse(request.body ?? {});
    const work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    // Starting a run must never generate, review, or lock an expansion.
    // Authors prepare and review design revisions through the design routes.
    if (work.worldPack?.status !== 'locked' || work.storyBible?.status !== 'locked' || plannedChapterCount(work) !== 450) {
      throw new CanonGateError('450-chapter expansion requires a separately reviewed and locked design; the current design was not changed');
    }
    const runId = body.runId ?? `milestone-450:${workId}`;
    await launchBackgroundRun(workId, 450, runId);
    const ready = await repository.get(workId);
    return reply.code(202).send({
      milestone: { targetChapter: 450, worldPack: ready?.worldPack, storyBible: ready?.storyBible },
      runId, status: 'running', checkpoint: checkpointOf(ready, runId),
    });
  });

  app.get('/works/:workId/runs', async (request) => {
    const { workId } = workParamSchema.parse(request.params);
    const work = await repository.get(workId);
    if (!work) throw new NotFoundError(`unknown work ${workId}`);
    return { checkpoints: [...work.checkpoints.values()].map(toCheckpointDto), activeRunIds: [...activeRuns.keys()].filter((key) => key.startsWith(`${workId}:`)).map((key) => key.slice(workId.length + 1)) };
  });

  app.post('/works/:workId/runs/:runId/:action', async (request) => {
    const { workId, runId, action } = runControlParamSchema.parse(request.params);
    return { checkpoint: toCheckpointDto(await workflow.controlRun(workId, runId, action)) };
  });

  app.get('/usage', async () => ledger.summary());

  app.post('/works/:workId/candidates/:candidateId/rulings', async (request, reply) => {
    const { workId, candidateId } = candidateParamSchema.parse(request.params);
    const body = createRulingRequestSchema.parse(request.body ?? {});
    const ruling = await workflow.recordRuling(workId, candidateId, body);
    const work = await repository.get(workId);
    const candidate = work?.candidates.get(candidateId);
    return reply.code(201).send({ ruling, candidate: candidate && work ? toCandidateDto(candidate, work) : undefined });
  });

  app.post('/works/:workId/candidates/:candidateId/check', async (request) => {
    const { workId, candidateId } = candidateParamSchema.parse(request.params);
    await workflow.check(workId, candidateId, generationCheckers());
    const work = await repository.get(workId);
    const candidate = work?.candidates.get(candidateId);
    return { ok: true, candidate: candidate && work ? toCandidateDto(candidate, work) : undefined };
  });

  app.get('/works/:workId/candidates/:candidateId/checks/:checkId/source', async (request) => {
    const { workId, candidateId, checkId } = candidateParamSchema.extend({ checkId: z.string().min(1) }).parse(request.params);
    const { sourceId } = z.object({ sourceId: z.string().min(1).max(500) }).parse(request.query);
    const work = await repository.get(workId);
    const candidate = work?.candidates.get(candidateId);
    const check = candidate?.checkRuns.find(item => item.id === checkId);
    if (!candidate || !check?.chapterReview) throw new NotFoundError('未找到此候选的正文评审记录');
    const { input, result } = check.chapterReview;
    if (!input) throw new NotFoundError('此旧评审未保存原材料，无法恢复当时原文');
    let sources = input.sources;
    let original: { sourceId: string; start: number; end: number } | undefined;
    if (result?.stageProof) {
      const run = restoreChapterReviewRun(input, result.stageProof);
      sources = completeDesignReviewRun(run).input.sources;
      original = run.units.find(unit => unit.id === sourceId);
    }
    const source = sources.find(item => item.id === sourceId);
    if (!source) throw new NotFoundError('本次评审没有该来源，不能用当前材料补齐');
    return {
      candidateId, chapterNumber: candidate.chapterNumber, checkId, checkedAt: check.checkedAt,
      inputHash: input.inputHash, source,
      kind: sourceId.startsWith('review-result/') ? 'review_result' : sourceId.startsWith('review-question/') ? 'review_question' : 'original',
      ...(original ? { original: { sourceId: original.sourceId, start: original.start, end: original.end } } : {}),
    };
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
    const issues = error instanceof ZodError ? error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) : [{ path: '$', message: error instanceof Error ? error.message : 'Invalid request' }];
    return { status: 400, body: apiError('VALIDATION_FAILED', 'request failed contract validation', issues) };
  }
  if (error instanceof DesignCandidateValidationError) return { status: 400, body: apiError('VALIDATION_FAILED', error.message, error.issues) };
  if (error instanceof ReadinessError) return { status: 409, body: apiError(error.code, error.message, { blockers: error.blockers }) };
  if (error instanceof DemoCandidateError) return { status: 409, body: apiError('DEMO_CANDIDATE_NOT_ADOPTABLE', error.message) };
  if (error instanceof QualityGateError) return { status: 409, body: apiError('REQUIRED_CHECK_FAILED', error.message) };
  if (error instanceof BatchRunsDisabledError) return { status: 409, body: apiError('BATCH_RUNS_DISABLED', error.message) };
  if (error instanceof RulingNotAllowedError) return { status: 409, body: apiError('RULING_NOT_ALLOWED', error.message) };
  if (error instanceof RunInProgressError || error instanceof LeaseLostError) return { status: 409, body: apiError('RUN_IN_PROGRESS', error.message) };
  if (error instanceof RunCancelledError) return { status: 409, body: apiError('RUN_CANCELLED', error.message) };
  if (error instanceof IdempotencyConflictError) return { status: 409, body: apiError('IDEMPOTENCY_CONFLICT', error.message) };
  if (error instanceof BudgetExceededError) return { status: 429, body: apiError('BUDGET_EXCEEDED', error.message) };
  if (error instanceof LockedConstraintError) return { status: 409, body: apiError('LOCKED_CONSTRAINT', error.message) };
  if (error instanceof StaleCandidateError) return { status: 409, body: apiError('STALE_CANDIDATE', error.message) };
  if (error instanceof AdoptionBlocked) return { status: 409, body: apiError('ADOPTION_BLOCKED', error.message) };
  if (error instanceof SettingConflictError) return { status: 409, body: apiError('CONFLICT', error.message) };
  if (error instanceof DesignReviewError) return { status: 409, body: apiError('DESIGN_REVIEW_REQUIRED', error.message) };
  if (error instanceof DesignQuestionConflictError) return { status: 409, body: apiError('CONFLICT', error.message) };
  if (error instanceof CanonGateError) return { status: 409, body: apiError('CONFLICT', error.message) };
  if (error instanceof PlanConflictError) return { status: 409, body: apiError('PLAN_CONFLICT', error.message) };
  if (error instanceof PlanGateError) return { status: 409, body: apiError('PLAN_GATE', error.message) };
  if (error instanceof PlanProviderMissingError) return { status: 409, body: apiError('PLANNER_NOT_CONFIGURED', error.message) };
  if (error instanceof NotFoundError || /unknown (work|candidate|character|relationship|rule|plot node|run|plan|channel)\b/.test(String(error))) {
    return { status: 404, body: apiError('NOT_FOUND', error instanceof Error ? error.message : 'not found') };
  }
  if (error instanceof ModelTimeoutError) {
    const ms = Number(/(\d+)ms/.exec(error.message)?.[1]);
    const seconds = Number.isFinite(ms) ? Math.round(ms / 1000) : undefined;
    return { status: 504, body: apiError('MODEL_TIMEOUT', `模型连续${seconds ? ` ${seconds} 秒` : '一段时间'}没有任何输出，已断开。可能是接口拥堵或模型卡住，稍后再试；仍不行就到系统设置换渠道或把超时调大。`) };
  }
  if (error instanceof PlanningParseError) return { status: 502, body: apiError('MODEL_FAILED', `模型返回的内容不合格：${String(redactSecrets(error.message))}`) };
  if (error instanceof Error && /^(openai-compatible|gemini) (request failed|response has no)/.test(error.message)) {
    return { status: 502, body: apiError('MODEL_FAILED', `模型接口报错：${String(redactSecrets(error.message))}`) };
  }
  return { status: 500, body: apiError('INTERNAL', 'internal error') };
}

if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  const { app } = createApiServer({ manageModelSettings: true });
  const port = Number(process.env.PORT ?? 8787);
  app.listen({ port, host: '127.0.0.1' }).then(() => console.log(`novel-studio API listening on http://127.0.0.1:${port}`));
}
