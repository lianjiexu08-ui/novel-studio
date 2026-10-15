import { z } from 'zod';

// A 64-source deferral also needs its original basis and question cited.
export const maxDesignReviewEvidence = 96;
// This bounds the request metadata, not raw-source coverage. The scheduler still
// requires every requested source to fit and every required citation to exist.
export const maxDesignReviewAwaitingSources = 64;
export const designReviewAreaSchema = z.enum(['world', 'power', 'characters', 'story']);
export const designReviewResultSchema = z.object({
  summary: z.string().trim().min(1).max(4000),
  checks: z.array(z.object({
    criterion: z.string().min(1), verdict: z.enum(['pass', 'revise', 'insufficient']),
    explanation: z.string().trim().min(1).max(6000),
    evidence: z.array(z.object({ sourceId: z.string().min(1), quote: z.string().min(4).max(3000) })).max(maxDesignReviewEvidence),
    revisionAdvice: z.string().max(6000),
    awaitingSources: z.array(z.string().min(1)).min(1).max(maxDesignReviewAwaitingSources).optional(),
    insufficiencyReason: z.enum(['missing_design', 'unlocatable_sources', 'capacity_limit']).optional(),
    resolves: z.array(z.string().min(1)).min(1).max(64).optional(),
  })).min(1).max(32),
});
/** Model transport only. Stored reports continue to contain exact source quotations. */
export const anchoredDesignReviewResultSchema = designReviewResultSchema.extend({
  requestId: z.string().min(1),
  checks: z.array(designReviewResultSchema.shape.checks.element.extend({
    evidence: z.array(z.object({ fragmentId: z.string().min(1) }).strict()).max(maxDesignReviewEvidence),
  })).min(1).max(32),
});
export const designContentReviewSchema = designReviewResultSchema.extend({
  resolvedDeferrals: z.array(z.object({ checkId: z.string(), resolvedByStageId: z.string() })).optional(),
  runId: z.string().optional(),
  id: z.string(), area: designReviewAreaSchema, inputHash: z.string().length(64),
  scope: z.object({ worldPackRevision: z.number().int(), storyBibleRevision: z.number().int(), planRevisionId: z.string(), planRevision: z.number().int() }),
  status: z.enum(['passed', 'needs_revision', 'inconclusive']),
  sources: z.array(z.object({ id: z.string(), text: z.string() })), createdAt: z.string().datetime(),
});
const reviewPlanSchema = z.object({ id: z.string(), revision: z.number().int(), status: z.enum(['proposed', 'reviewed', 'approved', 'superseded']) });
export const designReviewRunOverviewSchema = z.object({
  id: z.string(), area: designReviewAreaSchema, inputHash: z.string(), scope: designContentReviewSchema.shape.scope,
  status: z.enum(['ready', 'running', 'failed', 'completed', 'outdated']),
  createdAt: z.string(), updatedAt: z.string(), reportId: z.string().optional(), leaseExpiresAt: z.string().optional(),
  totalSources: z.number(), totalCharacters: z.number(),
  stages: z.array(z.object({ id: z.string(), kind: z.enum(['batch', 'cross', 'synthesis']), label: z.string(), completed: z.boolean(), verdict: z.enum(['passed', 'needs_revision', 'inconclusive']).optional(), attempts: z.number(), error: z.string().optional() })),
});
export type DesignReviewRunOverviewDto = z.infer<typeof designReviewRunOverviewSchema>;
export const designReviewOverviewSchema = z.object({
  selectedPlan: reviewPlanSchema.optional(), plans: z.array(reviewPlanSchema).optional(),
  ready: z.boolean(), inputHash: z.string().optional(),
  areas: z.array(z.object({ area: designReviewAreaSchema, status: z.enum(['missing', 'outdated', 'passed', 'needs_revision', 'inconclusive', 'reviewing', 'interrupted']), reportId: z.string().optional() })),
  reports: z.array(designContentReviewSchema),
  runs: z.array(designReviewRunOverviewSchema).default([]),
});
export type DesignReviewAreaDto = z.infer<typeof designReviewAreaSchema>;
export type DesignContentReviewDto = z.infer<typeof designContentReviewSchema>;
export type DesignReviewOverviewDto = z.infer<typeof designReviewOverviewSchema>;
// List views retain conclusions and version binding; full evidence is fetched
// by immutable report ID when the reader opens a report.
export const designContentReviewSummarySchema = designContentReviewSchema.omit({ sources: true, checks: true, resolvedDeferrals: true });
export const designReviewSummarySchema = designReviewOverviewSchema.extend({ reports: z.array(designContentReviewSummarySchema) });
export type DesignContentReviewSummaryDto = z.infer<typeof designContentReviewSummarySchema>;
export type DesignReviewSummaryDto = z.infer<typeof designReviewSummarySchema>;
