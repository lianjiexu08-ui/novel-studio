import { z } from 'zod';

export const designReviewAreaSchema = z.enum(['world', 'power', 'characters', 'story']);
export const designReviewResultSchema = z.object({
  summary: z.string().trim().min(1).max(4000),
  checks: z.array(z.object({
    criterion: z.string().min(1), verdict: z.enum(['pass', 'revise', 'insufficient']),
    explanation: z.string().trim().min(1).max(6000),
    evidence: z.array(z.object({ sourceId: z.string().min(1), quote: z.string().min(4).max(3000) })).max(20),
    revisionAdvice: z.string().max(6000),
  })).min(1).max(10),
});
export const designContentReviewSchema = designReviewResultSchema.extend({
  id: z.string(), area: designReviewAreaSchema, inputHash: z.string().length(64),
  scope: z.object({ worldPackRevision: z.number().int(), storyBibleRevision: z.number().int(), planRevisionId: z.string(), planRevision: z.number().int() }),
  status: z.enum(['passed', 'needs_revision', 'inconclusive']),
  sources: z.array(z.object({ id: z.string(), text: z.string() })), createdAt: z.string().datetime(),
});
export const designReviewOverviewSchema = z.object({
  ready: z.boolean(), inputHash: z.string().optional(),
  areas: z.array(z.object({ area: designReviewAreaSchema, status: z.enum(['missing', 'outdated', 'passed', 'needs_revision', 'inconclusive']), reportId: z.string().optional() })),
  reports: z.array(designContentReviewSchema),
});
export type DesignReviewAreaDto = z.infer<typeof designReviewAreaSchema>;
export type DesignContentReviewDto = z.infer<typeof designContentReviewSchema>;
export type DesignReviewOverviewDto = z.infer<typeof designReviewOverviewSchema>;
