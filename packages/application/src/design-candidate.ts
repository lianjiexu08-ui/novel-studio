import { isDeepStrictEqual } from 'node:util';
import { worldPackSchema, storyBibleSchema } from '../../contracts/src/world.ts';
import { bookPlanSchema } from '../../contracts/src/planning.ts';
import { validateWorldPack, validateStoryBible, type WorldPack, type StoryBible } from '../../../novel-service-core/src/world.ts';
import { reviewBookPlan, planDesignIssues, normalizePlan, type BookPlan } from '../../../novel-service-core/src/planning.ts';
import { Work } from '../../../novel-service-core/src/core.ts';

export interface DesignCandidate { worldPack: WorldPack; storyBible: StoryBible; plan: BookPlan }
export interface CandidateIssue { path: string; code?: string; message?: string; id?: string }
export class DesignCandidateValidationError extends Error {
  readonly issues: CandidateIssue[];
  constructor(issues: CandidateIssue[]) { super('设计修订未通过契约与结构校验'); this.issues = issues; }
}

/** Read-only preflight for a complete proposed bundle. Match all three API
 * contracts before any save rehearsal; never normalize or drop text silently. */
export function validateDesignCandidate(candidate: unknown) {
  const schemas = { worldPack: worldPackSchema, storyBible: storyBibleSchema, plan: bookPlanSchema };
  const issues: CandidateIssue[] = [], warnings: CandidateIssue[] = [], blockers: CandidateIssue[] = [];
  const result = () => ({ valid: issues.length === 0, issues, warnings, blockers,
    formalAcceptance: false, productionWrites: false,
    limitation: 'Checks API contracts and structural references only. Open blockers remain; this does not approve a plan, accept content quality, or certify an atomic save.' });
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    issues.push({ path: '', code: 'INVALID_BUNDLE', message: 'Expected worldPack, storyBible and plan documents' });
    return result();
  }
  for (const key of Object.keys(candidate)) if (!Object.hasOwn(schemas, key)) {
    issues.push({ path: key, code: 'UNKNOWN_DOCUMENT', message: 'Unexpected bundle field; no content was discarded' });
  }
  for (const [key, schema] of Object.entries(schemas)) {
    const parsed = schema.safeParse((candidate as Record<string, unknown>)[key]);
    if (!parsed.success) issues.push(...parsed.error.issues.map(issue => ({
      path: [key, ...issue.path].join('.'), code: issue.code, message: issue.message,
    })));
    else if (!isDeepStrictEqual(parsed.data, (candidate as Record<string, unknown>)[key])) issues.push({ path: key, code: 'NORMALIZATION_REQUIRED',
      message: 'API parsing would change this document; normalize explicitly, inspect the diff and revalidate before saving' });
  }
  if (issues.length) return result();
  const { worldPack, storyBible, plan } = candidate as DesignCandidate;
  for (const [key, validation] of [['worldPack', validateWorldPack(worldPack)], ['storyBible', validateStoryBible(storyBible, worldPack)]] as const) {
    issues.push(...validation.errors.map(message => ({ path: key, code: 'INVALID_REFERENCE_OR_STRUCTURE', message })));
    warnings.push(...validation.warnings.map(message => ({ path: key, message })));
  }
  if (storyBible.worldPackId !== worldPack.id || storyBible.worldPackRevision !== worldPack.revision) {
    issues.push({ path: 'storyBible.worldPackRevision', code: 'WORLD_BINDING_MISMATCH', message: 'Story bible must reference the submitted world ID and revision' });
  }
  for (const [key, questions] of [['worldPack', worldPack.unresolvedQuestions], ['storyBible', storyBible.unresolvedQuestions]] as const) {
    blockers.push(...questions.filter(q => q.blocking && q.status !== 'resolved').map(q => ({ path: `${key}.unresolvedQuestions`, id: q.id, code: 'BLOCKING_QUESTION' })));
  }
  for (const issue of reviewBookPlan(plan, { characterIds: new Set(storyBible.characters.map(c => c.id)) })) {
    if (issue.code === 'BLOCKING_QUESTION') blockers.push({ path: 'plan.openQuestions', id: issue.nodeId, code: issue.code });
    else if (issue.severity === 'error') issues.push({ path: 'plan', ...issue });
    else warnings.push({ path: 'plan', ...issue });
  }
  const work = new Work('Candidate preflight');
  work.worldPack = worldPack; work.storyBible = storyBible;
  issues.push(...planDesignIssues(work, plan).filter(issue => issue.code !== 'BLOCKING_QUESTION').map(issue => ({ path: 'plan', ...issue })));
  if (!isDeepStrictEqual(normalizePlan(plan), plan)) issues.push({ path: 'plan', code: 'NORMALIZATION_REQUIRED', message: 'Plan save would reorder items or rewrite chapter IDs; normalize explicitly before saving' });
  return result();
}

