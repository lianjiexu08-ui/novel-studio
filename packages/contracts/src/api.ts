import { z } from 'zod';

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
