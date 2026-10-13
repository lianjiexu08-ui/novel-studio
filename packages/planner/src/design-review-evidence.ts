import { createHash } from 'node:crypto';
import { anchoredDesignReviewResultSchema, designReviewResultSchema } from 'novel-studio-contracts';
import { DesignReviewError, validateDesignReview, type DesignReviewInput } from '../../../novel-service-core/src/design-review.ts';

export class DesignReviewEvidenceError extends DesignReviewError {}

/** Partition without rewriting, omitting or duplicating source text. Prefer line boundaries. */
function fragments(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + 1200, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end - 1);
      if (newline >= start + 80) end = newline + 1;
      // Avoid splitting a Unicode surrogate pair in a long single-line source.
      else if (/[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  if (parts.length > 1 && parts.at(-1)!.trim().length < 4) parts[parts.length - 2] += parts.pop()!;
  return parts;
}

export function prepareDesignReviewEvidence(input: DesignReviewInput) {
  // Bind both the sent material and the resolver to one immutable request snapshot.
  const snapshot = structuredClone(input);
  const requestHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  const lookup = new Map<string, { sourceId: string; quote: string }>();
  const sourceIds = new Set<string>();
  const sources = snapshot.sources.map((source) => {
    if (sourceIds.has(source.id)) throw new DesignReviewError(`评审来源 ID 重复：${source.id}`);
    sourceIds.add(source.id);
    const fingerprint = createHash('sha256').update(JSON.stringify([requestHash, source.id])).digest('hex').slice(0, 24);
    return { id: source.id, fragments: fragments(source.text).map((text, index) => {
      const id = `ev_${fingerprint}_${index + 1}`;
      lookup.set(id, { sourceId: source.id, quote: text });
      return { id, text };
    }) };
  });
  return {
    sources,
    resolve(value: unknown) {
      const parsed = anchoredDesignReviewResultSchema.parse(value);
      const problems: string[] = [];
      for (const check of parsed.checks) for (const [index, evidence] of check.evidence.entries()) {
        if (!lookup.has(evidence.fragmentId)) problems.push(`${check.criterion} 证据 ${index + 1}：${evidence.fragmentId}`);
      }
      if (problems.length) throw new DesignReviewEvidenceError(`评审片段编号不属于本次材料：${problems.join('；')}`);
      const result = designReviewResultSchema.parse({ ...parsed, checks: parsed.checks.map((check) => ({
        ...check, evidence: check.evidence.map((evidence) => ({ ...lookup.get(evidence.fragmentId)! })),
      })) });
      // A valid anchor proves provenance only. Completeness and verdict requirements still apply.
      validateDesignReview(snapshot, result);
      return result;
    },
  };
}
