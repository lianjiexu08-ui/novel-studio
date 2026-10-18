import { createHash } from 'node:crypto';
import { designReviewAnnotationSchema } from 'novel-studio-contracts';
import type { Work } from './core.ts';
import { annotationSources } from './design-review-annotations.ts';
import { DesignReviewError, type DesignReviewInput } from './design-review.ts';

const digest = (notes: unknown) => createHash('sha256').update(JSON.stringify(notes)).digest('hex');
export const annotationContextCapacity = 40_000;

/** Capture once, after deciding to create a new run. Resuming/retrying must not
 * consult live annotations or change the saved request fingerprint. */
export function withDesignReviewAnnotations(work: Work, input: DesignReviewInput): DesignReviewInput {
  const notes = [...work.designReviewAnnotations.values()].filter(note => {
    const run = work.designReviewRuns.get(note.runId);
    return run?.input.area === input.area && note.expectedInputHash === input.inputHash;
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (!notes.length) return input;
  for (const note of notes) annotationSources(work, note);
  const result = { ...input, annotationContext: { version: 1 as const, sha256: digest(notes), notes: structuredClone(notes) } };
  validateDesignReviewAnnotationContext(result, true);
  return result;
}

/** A hash binds editorial context, independently of the unchanged design hash.
 * Full original-source matching is possible only before slicing the run input. */
export function validateDesignReviewAnnotationContext(input: DesignReviewInput, fullSources = false): number {
  const context = input.annotationContext;
  if (!context) return 0;
  if (input.purpose === 'chapter_review' || context.version !== 1 || !Array.isArray(context.notes) || !context.notes.length
    || context.sha256 !== digest(context.notes)) throw new DesignReviewError('评审核对说明快照不匹配');
  const ids = new Set<string>();
  for (const raw of context.notes) {
    const note = designReviewAnnotationSchema.parse(raw);
    if (ids.has(note.id) || note.expectedInputHash !== input.inputHash
      || Object.entries(input.scope).some(([key, value]) => note.scope[key as keyof typeof note.scope] !== value)) {
      throw new DesignReviewError('评审核对说明不属于本设计版本或编号重复');
    }
    ids.add(note.id);
    if (fullSources) for (const evidence of note.evidence) {
      if (!input.sources.find(source => source.id === evidence.sourceId)?.text.includes(evidence.quote)) {
        throw new DesignReviewError(`评审核对说明的依据不在本次原文：${evidence.sourceId}`);
      }
    }
  }
  const size = JSON.stringify(context).length;
  if (size > annotationContextCapacity) throw new DesignReviewError('核对说明超过单次评审容量；已保留全部记录，未截断或调用模型');
  return size;
}
