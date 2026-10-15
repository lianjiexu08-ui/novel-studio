import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Work } from './core.ts';
import { planContentHash, type PlanRevision } from './planning.ts';
import { chapterReviewChecker, chapterReviewInputHash, chapterReviewRubricForPlan, chapterReviewStatus, validateChapterReview, type ChapterReviewResult } from './chapter-review.ts';

export interface ExecutionEvidence {
  status: 'not_written' | 'other_plan' | 'stale' | 'unverified' | 'verified';
  message: string;
  versionId?: string;
  candidateId?: string;
  reviewInputHash?: string;
  explanation?: string;
  citations: Array<{ sourceId: string; quote: string }>;
}

/** Request-local cache: replay a chapter's retained review only once, without changing history. */
export function executionEvidenceResolver(work: Work) {
  const cache = new Map<string, { evidence: ExecutionEvidence; result?: ChapterReviewResult }>();
  return (plan: PlanRevision, chapterNumber: number, checkId: string): ExecutionEvidence => {
    const key = JSON.stringify([plan.id, chapterNumber]);
    let proof = cache.get(key);
    if (!proof) {
      proof = chapterEvidence(work, plan, chapterNumber);
      cache.set(key, proof);
    }
    const item = proof.result?.checks.find(check => check.criterion === `execution/${checkId}`);
    if (proof.evidence.status !== 'verified') return structuredClone(proof.evidence);
    if (!item || item.verdict !== 'pass') return { ...proof.evidence, status: 'unverified', message: '原评审缺少此验收项的通过证据。', citations: [] };
    return { ...proof.evidence, explanation: item.explanation,
      citations: item.evidence.filter(e => e.sourceId === 'draft' || e.sourceId === 'brief').map(e => ({ ...e })) };
  };
}

function chapterEvidence(work: Work, plan: PlanRevision, chapterNumber: number): { evidence: ExecutionEvidence; result?: ChapterReviewResult } {
  const versions = [...work.versions.values()].filter(v => v.chapterNumber === chapterNumber && v.status === 'adopted');
  const version = versions.sort((a, b) => b.revision - a.revision)[0];
  const evidence: ExecutionEvidence = { status: 'not_written', message: '尚无已采纳正文；候选稿或计划不计为完成。', citations: [] };
  if (!version) return { evidence };
  evidence.versionId = version.id;
  evidence.candidateId = version.sourceCandidateId;
  if (version.stale) return { evidence: { ...evidence, status: 'stale', message: '已采纳正文已失效，须重新生成或评审并采纳。' } };
  const candidate = work.candidates.get(version.sourceCandidateId ?? '');
  if (candidate?.planRevisionId && candidate.planRevisionId !== plan.id) return { evidence: { ...evidence, status: 'other_plan', message: '当前正文来自另一版大纲，不能证明本版要求已兑现。' } };
  const invalid = () => ({ evidence: { ...evidence, status: 'unverified' as const, message: '缺少与本版大纲和已采纳正文一致的完整通过评审，暂不能验收。' } });
  try {
    const check = candidate?.checks.find(c => c.checker === chapterReviewChecker);
    const report = check?.chapterReview, input = report?.input;
    const outline = plan.plan.chapters.find(c => c.chapterNumber === chapterNumber);
    if (versions.length !== 1 || version.workId !== work.id || !candidate || candidate.workId !== work.id
      || candidate.status !== 'adopted' || candidate.adoptedVersionId !== version.id || candidate.chapterNumber !== chapterNumber
      || candidate.planRevisionId !== plan.id || candidate.content !== version.content
      || candidate.origin === 'demo' || candidate.generatedAgainstWorldPackRevision !== plan.worldPackRevision
      || candidate.generatedAgainstStoryBibleRevision !== plan.storyBibleRevision
      || candidate.contentHash !== createHash('sha256').update(version.content).digest('hex')
      || plan.workId !== work.id || !['approved', 'superseded'].includes(plan.status) || plan.contentHash !== planContentHash(plan.plan)
      || !outline || !candidate.brief || candidate.brief.planRevisionId !== plan.id || candidate.brief.workId !== work.id
      || candidate.brief.chapterNumber !== chapterNumber || candidate.brief.outlineId !== outline.id
      || !isDeepStrictEqual(candidate.brief.executionChecks, outline.executionChecks)
      || !check || check.candidateId !== candidate.id || check.status !== 'passed' || check.contentHash !== candidate.contentHash
      || !check.inputs || !report || report.error || report.superseded || !input || !report.result
      || check.inputs.worldPackRevision !== plan.worldPackRevision || check.inputs.storyBibleRevision !== plan.storyBibleRevision
      || input.candidateId !== candidate.id || input.chapterNumber !== chapterNumber || input.inputHash !== report.inputHash
      || new Set(input.sources.map(s => s.id)).size !== input.sources.length
      || !isDeepStrictEqual(input.rubric, chapterReviewRubricForPlan(plan.plan, chapterNumber))) return invalid();
    const source = (id: string) => input.sources.find(s => s.id === id)?.text;
    const reviewedPlan = JSON.parse(source('plan') ?? 'null') as PlanRevision | null;
    if (!reviewedPlan || reviewedPlan.id !== plan.id || reviewedPlan.workId !== work.id || reviewedPlan.revision !== plan.revision
      || reviewedPlan.worldPackRevision !== plan.worldPackRevision || reviewedPlan.storyBibleRevision !== plan.storyBibleRevision
      || !isDeepStrictEqual(reviewedPlan.plan, plan.plan) || reviewedPlan.contentHash !== plan.contentHash
      || JSON.parse(source('world') ?? 'null')?.revision !== plan.worldPackRevision
      || JSON.parse(source('bible') ?? 'null')?.revision !== plan.storyBibleRevision
      || source('draft') !== version.content || !isDeepStrictEqual(JSON.parse(source('brief') ?? 'null'), candidate.brief)
      || chapterReviewInputHash(input, { ...check.inputs, planId: plan.id, candidatePlanId: candidate.planRevisionId }) !== report.inputHash) return invalid();
    const result = validateChapterReview(report.result, input);
    if (chapterReviewStatus(result) !== 'passed') return invalid();
    return { evidence: { ...evidence, status: 'verified', message: '本项已在该版大纲的已采纳正文中通过评审；不自动关闭设计问题。', reviewInputHash: report.inputHash }, result };
  } catch {
    return invalid();
  }
}
