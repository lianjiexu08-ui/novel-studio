import { createHash } from 'node:crypto';
import { anchoredDesignReviewResultSchema, designReviewResultSchema } from 'novel-studio-contracts';
import { DesignReviewError, validateDesignReview, validateDesignReviewInsufficiencyFields, type DesignReviewInput } from '../../../novel-service-core/src/design-review.ts';
import { designReviewHorizon } from './design-review-horizon.ts';
import { designReviewReportEnvelopeSize } from '../../../novel-service-core/src/design-review-report.ts';

export class DesignReviewEvidenceError extends DesignReviewError {}
export class DesignReviewReportBudgetError extends DesignReviewError {}
export class DesignReviewInsufficiencyError extends DesignReviewError {}

/** Partition without rewriting, omitting or duplicating source text. Prefer line boundaries. */
function fragments(text: string, size = 1200): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
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
  const requestId = `review_${requestHash.slice(0, 24)}`;
  const lookup = new Map<string, { sourceId: string; quote: string }>();
  const sourceIds = new Set<string>();
  // v16 can need >64 independent citations. Smaller anchors keep the report
  // within its existing synthesis bound while still sending every source byte.
  // Legacy requests keep their original fragment boundaries and identifiers.
  const fragmentSize = snapshot.stage?.evidenceLimit === 96 ? 600 : 1200;
  const sources = snapshot.sources.map((source) => {
    if (sourceIds.has(source.id)) throw new DesignReviewError(`评审来源 ID 重复：${source.id}`);
    sourceIds.add(source.id);
    const unit = snapshot.stage?.sourceMap.find(unit => unit.id === source.id);
    return { id: source.id, ...(unit ? { origin: { sourceId: unit.sourceId, start: unit.start, end: unit.end } } : {}), fragments: fragments(source.text, fragmentSize).map((text) => {
      // Copy one request fingerprint, then select short local IDs. Repeating a
      // long hash in every citation caused otherwise complete reviews to fail.
      const id = `e${lookup.size + 1}`;
      lookup.set(id, { sourceId: source.id, quote: text });
      return { id, text };
    }) };
  });
  // Give the reviewer a direct index for dedicated follow-ups. These IDs are
  // navigational metadata, never proof that any fragment supports a verdict.
  const pending = snapshot.stage?.coverage?.pendingChecks?.find(check => check.id === snapshot.stage?.followupFor);
  const citationRequirements = pending ? {
    checkId: pending.id, criterion: pending.criterion,
    sources: [...new Set([pending.questionSourceId, ...(pending.priorSourceIds ?? []), ...pending.requiredSourceIds])].map(sourceId => ({
      sourceId,
      units: sources.filter(source => source.id === pending.questionSourceId ? source.id === sourceId : (source.origin?.sourceId ?? source.id) === sourceId)
        .map(source => ({ id: source.id, fragmentIds: source.fragments.map(fragment => fragment.id) })),
    })),
  } : undefined;
  // Ordinary cross checks can settle several deferrals at once. They need the
  // same navigation help as dedicated follow-ups, while requiring only one
  // original-batch citation unless priorSourceIds explicitly says otherwise.
  const pendingCitationRequirements = (!snapshot.stage?.followupFor || snapshot.stage.followupBudget) && snapshot.stage?.coverage?.pendingChecks?.length
    ? snapshot.stage.coverage.pendingChecks.map(check => ({
      checkId: check.id, criterion: check.criterion,
      requiredSources: [...new Set([check.questionSourceId, ...(check.priorSourceIds ?? []), ...check.requiredSourceIds])].map(sourceId => ({
        sourceId,
        units: sources.filter(source => source.id === check.questionSourceId ? source.id === sourceId : (source.origin?.sourceId ?? source.id) === sourceId)
          .map(source => ({ id: source.id, fragmentIds: source.fragments.map(fragment => fragment.id) })),
      })),
      oneOfPriorUnits: sources.filter(source => check.priorUnitIds.includes(source.id))
        .map(source => ({ id: source.id, fragmentIds: source.fragments.map(fragment => fragment.id) })),
    })) : undefined;
  return {
    requestId,
    planningHorizon: designReviewHorizon(snapshot),
    sources,
    citationRequirements,
    pendingCitationRequirements,
    resolve(value: unknown) {
      validateDesignReviewInsufficiencyFields(value);
      const parsed = anchoredDesignReviewResultSchema.parse(value);
      if (parsed.requestId !== requestId) throw new DesignReviewEvidenceError(`评审请求编号不属于本次材料：必须重新核对本次 requestId 与全部原文片段，不能沿用旧请求编号 ${parsed.requestId}`);
      const problems: string[] = [];
      for (const check of parsed.checks) for (const [index, evidence] of check.evidence.entries()) {
        if (!lookup.has(evidence.fragmentId)) problems.push(`${check.criterion} 证据 ${index + 1}：${evidence.fragmentId}`);
      }
      if (problems.length) throw new DesignReviewEvidenceError(`评审片段编号不属于本次材料：${problems.join('；')}`);
      const result = designReviewResultSchema.parse({ ...parsed, checks: parsed.checks.map((check) => ({
        ...check, evidence: check.evidence.map((evidence) => ({ ...lookup.get(evidence.fragmentId)! })),
      })) });
      if (snapshot.stage?.requireInsufficiencyReason) {
        const unclassified = result.checks.filter(check => check.verdict === 'insufficient' && !check.awaitingSources && !check.insufficiencyReason);
        if (unclassified.length) throw new DesignReviewInsufficiencyError(`局部材料不足必须说明是否需要补读：${unclassified.map(check => check.criterion).join('、')}。如果只因尚未读到目录中已有来源，完整填写 awaitingSources，不能只在说明中写“补读前50章”。确实缺设计、无法定位来源或完整必要材料超过容量时，使用 insufficiencyReason 的 missing_design、unlocatable_sources 或 capacity_limit，并在解释与建议中说明具体缺口。不能仅为通过校验改成 pass/revise、声称已读、缩小所需来源或把未读材料说成不存在。`);
      }
      // A dedicated follow-up has exactly one original question. A bare pass
      // would finish the step while leaving that question unresolved forever.
      // Ask the model to substantiate resolution or retain an honest blocker;
      // never manufacture resolves or rewrite already stored legacy reports.
      if (pending) {
        const check = result.checks.find(check => check.criterion === pending.criterion);
        if (check?.verdict === 'pass' && !check.resolves?.includes(pending.id)) {
          throw new DesignReviewError(`专门补读通过必须显式说明解决原问题：resolves 应包含 ${pending.id}。重新核验原问题及每个必引来源；只有实际解决并提供全部必要引文才能声明 resolves，否则改为 insufficient 或 revise，不能仅补上编号维持未经核验的通过。`);
        }
      }
      // A valid anchor proves provenance only. Completeness and verdict requirements still apply.
      validateDesignReview(snapshot, result);
      if (snapshot.stage?.reportBudget) {
        const budget = snapshot.stage.reportBudget;
        const size = designReviewReportEnvelopeSize(snapshot, result, budget.sourceId);
        if (size > budget.maxCharacters) throw new DesignReviewReportBudgetError(`本批评审结论过长：片段编号展开为完整原文及来源位置后共 ${size} 字符，上限 ${budget.maxCharacters}。保留全部检查、具体问题、判定与必要证据；精炼解释并重新选择直接支持判断的片段，减少同义或重复引用。不得删检查、删必要来源、截断原文或把返修/不足改成通过来适应容量；若完整必要证据无法容纳，应保留材料不足并明确容量原因。`);
      }
      return result;
    },
  };
}
