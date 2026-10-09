import { z } from 'zod';
import { storyBibleSchema, worldPackSchema } from './world.ts';

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
});
export type CreativeCovenant = z.infer<typeof creativeCovenantSchema>;

export const createWorkRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  covenant: creativeCovenantSchema,
});
export type CreateWorkRequest = z.infer<typeof createWorkRequestSchema>;

export const updateWorkRequestSchema = createWorkRequestSchema;
export type UpdateWorkRequest = z.infer<typeof updateWorkRequestSchema>;

export const saveWorldPackRequestSchema = worldPackSchema;
export type SaveWorldPackRequest = z.infer<typeof saveWorldPackRequestSchema>;
export const saveStoryBibleRequestSchema = storyBibleSchema;
export type SaveStoryBibleRequest = z.infer<typeof saveStoryBibleRequestSchema>;

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
export const relationshipPatchSchema = relationshipInputSchema.partial().extend({ locked: z.boolean().optional() });
export type RelationshipPatch = z.infer<typeof relationshipPatchSchema>;
export const relationshipDtoSchema = relationshipInputSchema.extend({ id: z.string(), locked: z.boolean() });
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

export const generateChapterRequestSchema = z.object({
  runId: z.string().min(1).max(200).optional(),
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
});
export type CheckResultDto = z.infer<typeof checkResultDtoSchema>;

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
  checks: z.array(checkResultDtoSchema),
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
  'INTERNAL',
] as const;
export type ApiErrorCode = (typeof apiErrorCodes)[number];

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(apiErrorCodes),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
