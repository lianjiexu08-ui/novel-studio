import { createHash, randomUUID } from 'node:crypto';
import { addDesignReviewAnnotationSchema, type AddDesignReviewAnnotation, type DesignReviewAnnotationDto } from 'novel-studio-contracts';
import type { DesignReviewRun } from './design-review-run.ts';
import type { Work } from './core.ts';
import { DesignReviewError, type DesignReviewResult } from './design-review.ts';

export type DesignReviewAnnotation = DesignReviewAnnotationDto;
export const designReviewCheckHash = (check: DesignReviewResult['checks'][number]): string =>
  createHash('sha256').update(JSON.stringify(check)).digest('hex');

/** Validate against the immutable run input, including when the live design has changed.
 * Exact quotations establish provenance, not the semantic truth of the annotation. */
export function annotationSources(work: Work, input: AddDesignReviewAnnotation) {
  return annotationRunSources(work.designReviewRuns.get(input.runId), input);
}

export function annotationRunSources(run: DesignReviewRun | undefined, input: AddDesignReviewAnnotation) {
  if (!run || run.id !== input.runId || run.input.inputHash !== input.expectedInputHash) throw new DesignReviewError('核对记录的原评审版本不匹配');
  const check = run.stages.find(stage => stage.id === input.stageId)?.result?.checks.find(check => check.criterion === input.criterion);
  if (!check || designReviewCheckHash(check) !== input.expectedCheckHash) throw new DesignReviewError('核对记录的原判定不匹配或尚未完成');
  const claimField = input.claimField ?? 'explanation';
  if (!check[claimField].includes(input.claimQuote)) throw new DesignReviewError(`被核对的原话不在该项${claimField === 'revisionAdvice' ? '返修建议' : '评审解释'}中`);
  const sourceIds = [...new Set(input.evidence.map(item => item.sourceId))];
  const sources = sourceIds.map(id => {
    const source = run.input.sources.find(source => source.id === id);
    if (!source) throw new DesignReviewError(`核对依据不在该任务原始输入中：${id}`);
    return source;
  });
  for (const evidence of input.evidence) {
    if (!sources.find(source => source.id === evidence.sourceId)!.text.includes(evidence.quote)) {
      throw new DesignReviewError(`核对引文与保存的原文不符：${evidence.sourceId}`);
    }
  }
  return structuredClone(sources);
}

export function recordDesignReviewAnnotation(work: Work, raw: AddDesignReviewAnnotation, createdAt = new Date().toISOString()): DesignReviewAnnotation {
  const input = addDesignReviewAnnotationSchema.parse(raw);
  annotationSources(work, input);
  const existing = [...work.designReviewAnnotations.values()].find(item => item.runId === input.runId && item.requestKey === input.requestKey);
  if (existing) {
    const previous = addDesignReviewAnnotationSchema.parse(Object.fromEntries(Object.keys(input).map(key => [key, existing[key as keyof typeof existing]])));
    if (JSON.stringify(previous) !== JSON.stringify(input)) throw new DesignReviewError('核对记录请求编号已用于其他内容，请保留旧记录并使用新编号');
    return structuredClone(existing);
  }
  const annotation: DesignReviewAnnotation = { ...structuredClone(input), id: `review_note_${randomUUID()}`, createdAt,
    scope: structuredClone(work.designReviewRuns.get(input.runId)!.input.scope) };
  work.designReviewAnnotations.set(annotation.id, annotation);
  // Editorial metadata is neither story state nor a changed design constraint.
  return structuredClone(annotation);
}
