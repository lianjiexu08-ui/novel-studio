import { z } from 'zod';
import { storyBibleSchema, worldPackSchema } from './world.ts';
import { chapterBriefDtoSchema } from './planning.ts';

/**
 * API contracts: the single source of truth shared by apps/web and apps/api.
 * Backends validate with the schemas; frontends consume the inferred types.
 */

// ---------- Requests ----------

export const creativeCovenantSchema = z.object({
  entryMode: z.literal('expand').default('expand'),
  genre: z.literal('xuanhuan').default('xuanhuan'),
  substyle: z.string().trim().max(50).default(''),
  audience: z.string().trim().min(1).max(500),
  hook: z.string().trim().min(1).max(500),
  mustKeep: z.string().trim().max(1000).default(''),
  lockedNotes: z.string().trim().max(1000).default(''),
  avoid: z.string().trim().max(1000).default(''),
  targetLength: z.string().trim().min(1).max(100).default('长篇，篇幅未定'),
  chapterWords: z.number().int().min(500).max(20000).default(2200),
  updateCadence: z.string().trim().min(1).max(50).default('日更'),
  protagonistGoal: z.string().trim().max(500).default(''),
  obstacle: z.string().trim().max(500).default(''),
  readingExperience: z.string().trim().max(500).default(''),
  targetChapterCount: z.number().int().min(1).max(2000).optional(),
  volumeCount: z.number().int().min(1).max(50).optional(),
});
export type CreativeCovenant = z.infer<typeof creativeCovenantSchema>;

export const createWorkRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  covenant: creativeCovenantSchema,
});
export type CreateWorkRequest = z.infer<typeof createWorkRequestSchema>;

/** Covenant edits keep the author's own words next to the structured result. */
export const updateWorkRequestSchema = createWorkRequestSchema.extend({
  authorText: z.string().trim().max(4000).optional(),
  acceptedSuggestions: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
});
export type UpdateWorkRequest = z.infer<typeof updateWorkRequestSchema>;

export const covenantImpactDtoSchema = z.object({
  covenantChanged: z.boolean(),
  staleCandidateIds: z.array(z.string()),
  planToRecheck: z.string().optional(),
});
export type CovenantImpactDto = z.infer<typeof covenantImpactDtoSchema>;

export const covenantRevisionDtoSchema = z.object({
  id: z.string(), revision: z.number().int(), covenant: creativeCovenantSchema, authorText: z.string(),
  acceptedSuggestions: z.array(z.string()), createdAt: z.string(),
});
export type CovenantRevisionDto = z.infer<typeof covenantRevisionDtoSchema>;

export const saveWorldPackRequestSchema = worldPackSchema;
export type SaveWorldPackRequest = z.infer<typeof saveWorldPackRequestSchema>;
export const saveStoryBibleRequestSchema = storyBibleSchema;
export type SaveStoryBibleRequest = z.infer<typeof saveStoryBibleRequestSchema>;
export const generateDesignRequestSchema = z.object({ stage: z.enum(['world_pack', 'story_bible']), chapterTarget: z.number().int().min(1).max(450).optional() });
export type GenerateDesignRequest = z.infer<typeof generateDesignRequestSchema>;

// ---------- Settings: characters, relationships, world rules, plot nodes ----------

const shortText = z.string().trim().max(1000).default('');

export const characterRoleSchema = z.enum(['protagonist', 'major', 'supporting', 'minor']);
export const characterInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  aliases: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  role: characterRoleSchema.default('supporting'),
  identity: shortText,
  goal: shortText,
  principles: shortText,
  voice: shortText,
  notes: shortText,
  /** Story Bible character this entry is the same person as; '' unlinks. */
  canonicalId: z.string().trim().max(100).optional(),
});
export type CharacterInput = z.infer<typeof characterInputSchema>;
export const characterPatchSchema = characterInputSchema.partial().extend({ locked: z.boolean().optional() });
export type CharacterPatch = z.infer<typeof characterPatchSchema>;
export const characterDtoSchema = characterInputSchema.extend({ id: z.string(), locked: z.boolean(), createdAt: z.string() });
export type CharacterDto = z.infer<typeof characterDtoSchema>;

export const relationshipLayerSchema = z.enum(['objective', 'belief']);
export const relationshipInputSchema = z.object({
  fromCharacterId: z.string().min(1),
  toCharacterId: z.string().min(1),
  layer: relationshipLayerSchema.default('objective'),
  kind: z.string().trim().min(1).max(30),
  value: z.string().trim().max(200).default(''),
  note: z.string().trim().max(500).default(''),
  sinceChapter: z.number().int().min(1).optional(),
});
export type RelationshipInput = z.infer<typeof relationshipInputSchema>;
export const lockPolicySchema = z.enum(['document_revision_locked', 'baseline_locked', 'event_change_forbidden', 'evolvable']);
export type LockPolicyDto = z.infer<typeof lockPolicySchema>;
export const relationshipPatchSchema = relationshipInputSchema.partial().extend({ locked: z.boolean().optional(), lockPolicy: lockPolicySchema.optional() });
export type RelationshipPatch = z.infer<typeof relationshipPatchSchema>;
export const relationshipDtoSchema = relationshipInputSchema.extend({ id: z.string(), locked: z.boolean(), lockPolicy: lockPolicySchema.optional() });
export type RelationshipDto = z.infer<typeof relationshipDtoSchema>;

export const worldRuleCategorySchema = z.enum(['power', 'cost', 'resource', 'institution', 'geography', 'other']);
export const worldRuleInputSchema = z.object({
  category: worldRuleCategorySchema,
  title: z.string().trim().min(1).max(100),
  content: z.string().trim().max(2000).default(''),
});
export type WorldRuleInput = z.infer<typeof worldRuleInputSchema>;
export const worldRulePatchSchema = worldRuleInputSchema.partial().extend({ locked: z.boolean().optional() });
export type WorldRulePatch = z.infer<typeof worldRulePatchSchema>;
export const worldRuleDtoSchema = worldRuleInputSchema.extend({ id: z.string(), locked: z.boolean(), createdAt: z.string() });
export type WorldRuleDto = z.infer<typeof worldRuleDtoSchema>;

export const plotLevelSchema = z.enum(['book', 'volume', 'chapter']);
export const plotNodeInputSchema = z.object({
  level: plotLevelSchema.default('chapter'),
  title: z.string().trim().min(1).max(100),
  expectedResult: z.string().trim().max(1000).default(''),
  targetChapter: z.number().int().min(1).optional(),
  prerequisites: z.array(z.string().min(1)).max(50).default([]),
});
export type PlotNodeInput = z.infer<typeof plotNodeInputSchema>;
/** Realization is set only by adopted chapters, never by an edit request. */
export const plotNodePatchSchema = plotNodeInputSchema.partial();
export type PlotNodePatch = z.infer<typeof plotNodePatchSchema>;
export const plotNodeDtoSchema = plotNodeInputSchema.extend({
  id: z.string(),
  realization: z.object({
    status: z.enum(['unrealized', 'partial', 'realized', 'diverged', 'insufficient']),
    chapterVersionId: z.string().optional(),
    evidence: z.string().optional(),
    updatedAt: z.string(),
  }),
});
export type PlotNodeDto = z.infer<typeof plotNodeDtoSchema>;

export const characterStateDtoSchema = z.object({
  characterId: z.string(),
  field: z.string(),
  value: z.unknown(),
  sourceChapterVersionId: z.string(),
  storyTime: z.number().optional(),
});
export type CharacterStateDto = z.infer<typeof characterStateDtoSchema>;

export const bibleDtoSchema = z.object({
  characters: z.array(characterDtoSchema),
  relationships: z.array(relationshipDtoSchema),
  worldRules: z.array(worldRuleDtoSchema),
  plotNodes: z.array(plotNodeDtoSchema),
  /** Projection rebuilt from adopted chapters only. */
  states: z.array(characterStateDtoSchema),
});
export type BibleDto = z.infer<typeof bibleDtoSchema>;

export const designDtoSchema = z.object({
  worldPack: worldPackSchema.optional(),
  storyBible: storyBibleSchema.optional(),
  constraintRevision: z.number().int().min(0),
});
export type DesignDto = z.infer<typeof designDtoSchema>;

export const manuscriptRevisionDtoSchema = z.object({
  id: z.string(), workId: z.string(), revision: z.number().int().positive(), status: z.enum(['final', 'superseded']),
  chapterVersionIds: z.array(z.string()), chapterCount: z.number().int().positive(), wordCount: z.number().int().nonnegative(), targetWordCount: z.number().int().nonnegative(), lengthCoverage: z.number().nonnegative(), contentHash: z.string().length(64),
  stateRevision: z.number().int().min(0), constraintRevision: z.number().int().min(0),
  worldPackRevision: z.number().int().positive(), storyBibleRevision: z.number().int().positive(), createdAt: z.string(),
});
export type ManuscriptRevisionDto = z.infer<typeof manuscriptRevisionDtoSchema>;

export const generateChapterRequestSchema = z.object({
  runId: z.string().min(1).max(200).optional(),
  /** `demo` produces a trial candidate that can be read and checked but never adopted. */
  mode: z.enum(['formal', 'demo']).default('formal'),
});
export type GenerateChapterRequest = z.infer<typeof generateChapterRequestSchema>;

export const adoptCandidateRequestSchema = z.object({
  expectedStateRevision: z.number().int().min(0),
});
export type AdoptCandidateRequest = z.infer<typeof adoptCandidateRequestSchema>;

// ---------- Responses (DTOs) ----------

export const workDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  stateRevision: z.number().int().min(0),
  constraintRevision: z.number().int().min(0),
  covenant: creativeCovenantSchema,
});
export type WorkDto = z.infer<typeof workDtoSchema>;

export const checkResultDtoSchema = z.object({
  checker: z.string(),
  status: z.enum(['passed', 'failed', 'inconclusive', 'unavailable']),
  message: z.string(),
  candidateId: z.string(),
  checkedAt: z.string(),
  policyVersion: z.string().optional(),
  id: z.string().optional(),
  contentHash: z.string().optional(),
  inputs: z.object({
    stateRevision: z.number().int(), constraintRevision: z.number().int(),
    worldPackRevision: z.number().int().optional(), storyBibleRevision: z.number().int().optional(),
  }).optional(),
});
export type CheckResultDto = z.infer<typeof checkResultDtoSchema>;

export const checkRulingDtoSchema = z.object({
  id: z.string(), candidateId: z.string(), checkId: z.string(), checker: z.string(),
  decision: z.literal('false_positive'), reason: z.string(), evidence: z.string(), createdAt: z.string(),
});
export type CheckRulingDto = z.infer<typeof checkRulingDtoSchema>;

/** An author marks one specific check execution as a false positive; the check result itself is never edited. */
export const createRulingRequestSchema = z.object({
  checkId: z.string().min(1),
  reason: z.string().trim().min(1).max(1000),
  evidence: z.string().trim().min(1).max(2000),
});
export type CreateRulingRequest = z.infer<typeof createRulingRequestSchema>;

export const runUsageDtoSchema = z.object({
  calls: z.number().int().min(0), failedCalls: z.number().int().min(0),
  inputTokens: z.number().min(0), outputTokens: z.number().min(0),
  costUsd: z.number().min(0), costKnown: z.boolean(),
});
export type RunUsageDto = z.infer<typeof runUsageDtoSchema>;

export const readinessBlockerDtoSchema = z.object({
  code: z.enum([
    'MODEL_NOT_CONFIGURED', 'COVENANT_INCOMPLETE', 'CANON_NOT_READY', 'CHAPTER_PREREQUISITE_MISSING', 'CONTEXT_INCOMPLETE',
    'PLAN_NOT_APPROVED', 'PLAN_OUTDATED', 'PLAN_OUTLINE_MISSING', 'PLAN_PREREQUISITE_UNMET', 'BRIEF_NEEDS_CONFIRMATION',
  ]),
  message: z.string(),
  nextAction: z.string(),
});
export type ReadinessBlockerDto = z.infer<typeof readinessBlockerDtoSchema>;

export const chapterReadinessDtoSchema = z.object({
  chapterNumber: z.number().int().min(1),
  ready: z.boolean(),
  modelConfigured: z.boolean(),
  blockers: z.array(readinessBlockerDtoSchema),
  requiredChecks: z.array(z.string()),
  checkPolicyVersion: z.string().optional(),
});
export type ChapterReadinessDto = z.infer<typeof chapterReadinessDtoSchema>;

export const eventDraftDtoSchema = z.object({
  eventType: z.string(),
  subjectId: z.string(),
  predicate: z.string(),
  value: z.unknown(),
  storyTime: z.number().int().min(0).optional(),
  evidence: z.string().optional(),
  plotNodeId: z.string().optional(),
});
export type EventDraftDto = z.infer<typeof eventDraftDtoSchema>;

export const candidateDtoSchema = z.object({
  id: z.string(),
  workId: z.string(),
  chapterNumber: z.number().int().min(1),
  content: z.string(),
  proposedEvents: z.array(eventDraftDtoSchema),
  observedEvents: z.array(eventDraftDtoSchema).optional(),
  status: z.enum(['candidate', 'adopted', 'rejected']),
  runId: z.string(),
  generatedAgainstRevision: z.number().int().min(0),
  generatedAgainstConstraintRevision: z.number().int().min(0),
  generatedAgainstWorldPackRevision: z.number().int().optional(),
  generatedAgainstStoryBibleRevision: z.number().int().optional(),
  planRevisionId: z.string().optional(),
  brief: chapterBriefDtoSchema.optional(),
  contentHash: z.string().length(64),
  origin: z.enum(['model', 'demo']),
  /** True when the work moved on after generation; adoption would be rejected. */
  stale: z.boolean(),
  checks: z.array(checkResultDtoSchema),
  checkHistory: z.array(checkResultDtoSchema),
  rulings: z.array(checkRulingDtoSchema),
  usage: runUsageDtoSchema.optional(),
  adoptedVersionId: z.string().optional(),
  createdAt: z.string(),
});
export type CandidateDto = z.infer<typeof candidateDtoSchema>;

export const chapterVersionDtoSchema = z.object({
  id: z.string(),
  workId: z.string(),
  chapterNumber: z.number().int().min(1),
  revision: z.number().int().min(1),
  content: z.string(),
  status: z.enum(['adopted', 'superseded']),
  stale: z.boolean(),
  parentVersionId: z.string().optional(),
  sourceCandidateId: z.string().optional(),
  createdAt: z.string(),
});
export type ChapterVersionDto = z.infer<typeof chapterVersionDtoSchema>;

export const outboxEventDtoSchema = z.object({
  id: z.string(),
  dedupeKey: z.string(),
  workId: z.string(),
  kind: z.enum(['projection', 'search_index', 'export', 'publication_check']),
  aggregateId: z.string(),
  payload: z.record(z.string(), z.unknown()),
  publishedAt: z.string().optional(),
  attempts: z.number().int().min(0),
  createdAt: z.string(),
});
export type OutboxEventDto = z.infer<typeof outboxEventDtoSchema>;

export const adoptionResponseSchema = z.object({
  version: chapterVersionDtoSchema,
  outbox: z.array(outboxEventDtoSchema),
});
export type AdoptionResponse = z.infer<typeof adoptionResponseSchema>;

// ---------- Errors ----------

/** Stable machine-readable codes; the web app renders blocking UI from these. */
export const apiErrorCodes = [
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'ADOPTION_BLOCKED',
  'STALE_CANDIDATE',
  'LOCKED_CONSTRAINT',
  'CONFLICT',
  'UNAUTHORIZED',
  'MODEL_NOT_CONFIGURED',
  'COVENANT_INCOMPLETE',
  'CANON_NOT_READY',
  'CHAPTER_PREREQUISITE_MISSING',
  'CONTEXT_INCOMPLETE',
  'DEMO_CANDIDATE_NOT_ADOPTABLE',
  'REQUIRED_CHECK_FAILED',
  'BATCH_RUNS_DISABLED',
  'RULING_NOT_ALLOWED',
  'RUN_IN_PROGRESS',
  'RUN_CANCELLED',
  'IDEMPOTENCY_CONFLICT',
  'BUDGET_EXCEEDED',
  'PLAN_NOT_APPROVED',
  'PLAN_OUTDATED',
  'PLAN_OUTLINE_MISSING',
  'PLAN_PREREQUISITE_UNMET',
  'BRIEF_NEEDS_CONFIRMATION',
  'PLAN_CONFLICT',
  'PLAN_GATE',
  'PLANNER_NOT_CONFIGURED',
  'MODEL_TIMEOUT',
  'MODEL_FAILED',
  'INTERNAL',
] as const;

export const modelChannelDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  endpoint: z.string(),
  hasApiKey: z.boolean(),
  apiKeyHint: z.string(),
  planningModel: z.string(),
  writingModel: z.string(),
  timeoutMs: z.number().int(),
  independentExtraction: z.boolean(),
  fallback: z.boolean(),
});
export type ModelChannelDto = z.infer<typeof modelChannelDtoSchema>;

export const modelSettingsDtoSchema = z.object({
  configured: z.boolean(),
  planningConfigured: z.boolean(),
  source: z.enum(['saved', 'environment', 'none']),
  activeId: z.string().optional(),
  channels: z.array(modelChannelDtoSchema),
  storedAt: z.string(),
  savedId: z.string().optional(),
});
export type ModelSettingsDto = z.infer<typeof modelSettingsDtoSchema>;

/** `apiKey` is write-only. Leave it empty to keep the key already stored for this channel. */
export const updateModelSettingsRequestSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(40),
  endpoint: z.string().trim().max(500).default(''),
  apiKey: z.string().max(500).optional(),
  clearApiKey: z.boolean().optional(),
  planningModel: z.string().trim().max(200).default(''),
  writingModel: z.string().trim().max(200).default(''),
  timeoutMs: z.number().int().min(5_000).max(600_000).default(180_000),
  independentExtraction: z.boolean().default(true),
  /** When not active, take over if the active channel is overloaded, rate limited or times out. */
  fallback: z.boolean().default(true),
  /** Make this channel the one planning and writing use. Defaults to staying on the current channel. */
  activate: z.boolean().optional(),
});
export type UpdateModelSettingsRequest = z.infer<typeof updateModelSettingsRequestSchema>;

export const activateModelChannelRequestSchema = z.object({ id: z.string().trim().min(1).max(80) });

/** Connectivity check and model listing. A model name is not required yet. */
export const probeModelChannelRequestSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  endpoint: z.string().trim().max(500).default(''),
  apiKey: z.string().max(500).optional(),
  planningModel: z.string().trim().max(200).default(''),
  writingModel: z.string().trim().max(200).default(''),
  timeoutMs: z.number().int().min(5_000).max(600_000).default(180_000),
});
export type ProbeModelChannelRequest = z.infer<typeof probeModelChannelRequestSchema>;

export const hotTopicSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  source: z.string(),
  heat: z.string().optional(),
  url: z.string().optional(),
});
export type HotTopic = z.infer<typeof hotTopicSchema>;

export const hotTopicsResponseSchema = z.object({
  query: z.string(),
  topics: z.array(hotTopicSchema),
  sources: z.array(z.string()),
  failures: z.array(z.string()),
  fetchedAt: z.string(),
});
export type HotTopicsResponse = z.infer<typeof hotTopicsResponseSchema>;
export type ApiErrorCode = (typeof apiErrorCodes)[number];

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(apiErrorCodes),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
