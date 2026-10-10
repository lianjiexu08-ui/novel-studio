import { z } from 'zod';

/** Book plan contracts. Plans are future intent; nothing here is story fact. */

const text = (max = 2000) => z.string().trim().max(max).default('');
const textList = z.array(z.string().trim().max(500)).max(50).default([]);

export const volumePlanSchema = z.object({
  id: z.string().trim().min(1).max(100),
  order: z.number().int().min(1),
  title: z.string().trim().min(1).max(100),
  startChapter: z.number().int().min(1),
  endChapter: z.number().int().min(1),
  goal: text(),
  opposition: text(),
  characterIds: z.array(z.string().min(1).max(100)).max(50).default([]),
  climax: text(),
  endState: text(),
  carryOver: text(),
});

export const chapterOutlineSchema = z.object({
  id: z.string().trim().max(100).default(''),
  chapterNumber: z.number().int().min(1),
  volumeId: z.string().trim().max(100).default(''),
  title: text(100),
  summary: text(),
  characterGoals: text(),
  conflict: text(),
  choice: text(),
  cost: text(),
  threads: textList,
  endState: text(),
  characterIds: z.array(z.string().min(1).max(100)).max(30).default([]),
  location: z.string().trim().max(200).optional(),
  storyTime: z.string().trim().max(200).optional(),
  scenes: textList,
  source: z.enum(['model', 'author']).default('author'),
});

export const plotMilestoneSchema = z.object({
  id: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  kind: z.enum(['climax', 'turn', 'payoff']),
  startChapter: z.number().int().min(1),
  endChapter: z.number().int().min(1),
  setup: textList,
  cost: text(),
  outcome: text(),
});

export const factRequirementSchema = z.object({
  eventType: z.string().trim().min(1).max(100),
  subjectId: z.string().trim().min(1).max(100),
  predicate: z.string().trim().max(100).optional(),
  equals: z.unknown().optional(),
});

export const planDependencySchema = z.object({
  id: z.string().trim().min(1).max(100),
  targetId: z.string().trim().min(1).max(100),
  sourceId: z.string().trim().min(1).max(100).optional(),
  fact: factRequirementSchema.optional(),
  requiredness: z.enum(['must', 'optional']).default('must'),
  description: z.string().trim().min(1).max(500),
});

export const planQuestionSchema = z.object({
  id: z.string().trim().min(1).max(100),
  question: z.string().trim().min(1).max(500),
  blocking: z.boolean().default(false),
  status: z.enum(['open', 'resolved', 'deferred']).default('open'),
});

const planSkeletonShape = {
  targetChapterCount: z.number().int().min(1).max(2000),
  volumeCount: z.number().int().min(1).max(50),
  mainConflict: text(),
  theme: text(),
  protagonistArc: text(),
  endingDirection: text(),
  keyTurns: textList,
  volumes: z.array(volumePlanSchema).max(50),
  milestones: z.array(plotMilestoneSchema).max(500).default([]),
  dependencies: z.array(planDependencySchema).max(500).default([]),
  openQuestions: z.array(planQuestionSchema).max(100).default([]),
};

export const planSkeletonSchema = z.object(planSkeletonShape);
export const bookPlanSchema = z.object({ ...planSkeletonShape, chapters: z.array(chapterOutlineSchema).max(2000).default([]) });
export type BookPlanContract = z.infer<typeof bookPlanSchema>;
export type PlanSkeletonContract = z.infer<typeof planSkeletonSchema>;
export type ChapterOutlineContract = z.infer<typeof chapterOutlineSchema>;

export const generatePlanRequestSchema = z.object({
  targetChapterCount: z.number().int().min(1).max(2000),
  volumeCount: z.number().int().min(1).max(50),
  authorRequest: z.string().trim().max(2000).optional(),
});
export type GeneratePlanRequest = z.infer<typeof generatePlanRequestSchema>;

export const generateOutlinesRequestSchema = z.object({
  baseRevisionId: z.string().min(1),
  from: z.number().int().min(1),
  to: z.number().int().min(1),
  authorRequest: z.string().trim().max(2000).optional(),
});
export type GenerateOutlinesRequest = z.infer<typeof generateOutlinesRequestSchema>;

export const savePlanRequestSchema = z.object({
  baseRevisionId: z.string().min(1).optional(),
  plan: bookPlanSchema,
  note: z.string().trim().max(500).optional(),
});
export type SavePlanRequest = z.infer<typeof savePlanRequestSchema>;

export const planIssueDtoSchema = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
  volumeId: z.string().optional(),
  chapterNumber: z.number().int().optional(),
  nodeId: z.string().optional(),
});
export type PlanIssueDto = z.infer<typeof planIssueDtoSchema>;

export const planReviewDtoSchema = z.object({
  id: z.string(),
  contentHash: z.string(),
  worldPackRevision: z.number().int().optional(),
  storyBibleRevision: z.number().int().optional(),
  passed: z.boolean(),
  issues: z.array(planIssueDtoSchema),
  reviewedAt: z.string(),
});
export type PlanReviewDto = z.infer<typeof planReviewDtoSchema>;

export const planRevisionDtoSchema = z.object({
  id: z.string(),
  workId: z.string(),
  revision: z.number().int().min(1),
  parentId: z.string().optional(),
  status: z.enum(['proposed', 'reviewed', 'approved', 'superseded']),
  source: z.enum(['model', 'author', 'mixed']),
  note: z.string(),
  plan: bookPlanSchema,
  contentHash: z.string(),
  worldPackRevision: z.number().int().optional(),
  storyBibleRevision: z.number().int().optional(),
  reviews: z.array(planReviewDtoSchema),
  createdAt: z.string(),
  approvedAt: z.string().optional(),
});
export type PlanRevisionDto = z.infer<typeof planRevisionDtoSchema>;

export const briefDependencyDtoSchema = z.object({
  dependencyId: z.string(),
  description: z.string(),
  requiredness: z.enum(['must', 'optional']),
  satisfied: z.boolean(),
  evidence: z.string().optional(),
});

export const chapterBriefDtoSchema = z.object({
  id: z.string(),
  workId: z.string(),
  chapterNumber: z.number().int().min(1),
  planRevisionId: z.string(),
  outlineId: z.string(),
  status: z.enum(['derived', 'author_confirmed']),
  pov: z.string(),
  characters: z.array(z.string()),
  location: z.string(),
  storyTime: z.string(),
  scenes: z.array(z.string()),
  mustDo: z.array(z.string()),
  mustNotHappen: z.array(z.string()),
  endState: z.string(),
  dependsOn: z.array(briefDependencyDtoSchema),
  preserve: z.array(z.string()),
  basisFingerprint: z.string(),
  createdAt: z.string(),
});
export type ChapterBriefDto = z.infer<typeof chapterBriefDtoSchema>;

/** Author edits to a brief. Prerequisite status is never editable; it comes from adopted facts. */
export const confirmBriefRequestSchema = z.object({
  pov: z.string().trim().max(100).optional(),
  characters: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  location: z.string().trim().max(200).optional(),
  storyTime: z.string().trim().max(200).optional(),
  scenes: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
  mustDo: z.array(z.string().trim().min(1).max(1000)).max(30).optional(),
  mustNotHappen: z.array(z.string().trim().min(1).max(1000)).max(30).optional(),
  endState: z.string().trim().max(1000).optional(),
  preserve: z.array(z.string().trim().min(1).max(1000)).max(30).optional(),
});
export type ConfirmBriefRequest = z.infer<typeof confirmBriefRequestSchema>;

export const nodeRealizationDtoSchema = z.object({
  nodeId: z.string(),
  kind: z.enum(['chapter', 'milestone']),
  title: z.string(),
  startChapter: z.number().int(),
  endChapter: z.number().int(),
  status: z.enum(['unrealized', 'partial', 'realized', 'diverged', 'insufficient']),
  due: z.boolean(),
  overdue: z.boolean(),
  evidence: z.array(z.object({ chapterNumber: z.number().int(), versionId: z.string(), eventId: z.string(), text: z.string() })),
});
export type NodeRealizationDto = z.infer<typeof nodeRealizationDtoSchema>;

export const planOverviewDtoSchema = z.object({
  active: planRevisionDtoSchema.optional(),
  latest: planRevisionDtoSchema.optional(),
  realization: z.object({ reachedChapter: z.number().int(), nodes: z.array(nodeRealizationDtoSchema) }).optional(),
  planningConfigured: z.boolean(),
});
export type PlanOverviewDto = z.infer<typeof planOverviewDtoSchema>;

export function parsePlanSkeleton(input: unknown): PlanSkeletonContract {
  return planSkeletonSchema.parse(input);
}

export function parseChapterOutlines(input: unknown): ChapterOutlineContract[] {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? (input as { chapters?: unknown }).chapters : input;
  return z.array(chapterOutlineSchema).parse(value);
}
