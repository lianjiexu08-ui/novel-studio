import type { CandidateDto, ChapterReadinessDto } from 'novel-studio-contracts';

/** UI eligibility only; the server revalidates design, evidence and revisions. */
export function canAdoptChapter(candidate: CandidateDto | null, readiness: ChapterReadinessDto | null,
  current: { workId: string; chapterNumber: number; stateRevision: number; constraintRevision: number }): boolean {
  if (!candidate || !readiness || readiness.chapterNumber !== current.chapterNumber
    || candidate.workId !== current.workId || candidate.chapterNumber !== current.chapterNumber
    || candidate.status !== 'candidate' || candidate.origin !== 'model' || candidate.stale
    || candidate.generatedAgainstRevision !== current.stateRevision
    || candidate.generatedAgainstConstraintRevision !== current.constraintRevision) return false;
  // Model connectivity is required to generate, but not to adopt an already
  // reviewed candidate. Use the design gates shared with server-side adoption.
  if (readiness.blockers.some(blocker => ['CANON_NOT_READY', 'DESIGN_REVIEW_REQUIRED'].includes(blocker.code))) return false;
  return candidate.checks.length > 0 && candidate.checks.every(check => check.status === 'passed')
    && readiness.requiredChecks.every(name => candidate.checks.some(check => check.checker === name));
}
