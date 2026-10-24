import { createHash } from 'node:crypto';
import { anchoredDesignReviewResultSchema, designReviewResultSchema } from 'novel-studio-contracts';
import { DesignReviewError, validateDesignReview, validateDesignReviewInsufficiencyFields, type DesignReviewInput } from '../../../novel-service-core/src/design-review.ts';
import { designReviewHorizon } from './design-review-horizon.ts';
import { designReviewCitationEnvelopeCharacters, designReviewReportEnvelopeSize } from '../../../novel-service-core/src/design-review-report.ts';

export class DesignReviewEvidenceError extends DesignReviewError {}
export class DesignReviewReportBudgetError extends DesignReviewError {}
export class DesignReviewInsufficiencyError extends DesignReviewError {}

/** Apply only edits explicitly selected by the model; retain the original raw
 * answer separately. The caller must validate the entire reconstructed answer. */
export function applyDesignReviewCitationEdits(value: unknown, previous: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('repairMode' in value)) return value;
  const patch = value as Record<string, unknown>;
  const fail = (message: string): never => { throw new DesignReviewEvidenceError(`引文编辑不合格：${message}`); };
  if (patch.repairMode !== 'citation_edits' || patch.confirmUnchangedChecks !== true) fail('必须明确确认未改动检查项');
  if (Object.keys(patch).some(key => !['requestId', 'repairMode', 'confirmUnchangedChecks', 'summary', 'updates'].includes(key))) fail('存在未知顶层字段');
  const original = anchoredDesignReviewResultSchema.parse(previous);
  if (patch.requestId !== original.requestId) fail('请求编号与原回答不一致');
  if (typeof patch.summary !== 'string' || !Array.isArray(patch.updates) || !patch.updates.length) fail('必须提供总结和至少一项明确编辑');
  const updates = new Map<string, unknown>();
  for (const value of patch.updates as unknown[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('编辑项必须是对象');
    const update = value as Record<string, unknown>;
    if (Object.keys(update).some(key => !['criterion', 'verdict', 'explanation', 'revisionAdvice', 'awaitingSources', 'insufficiencyReason', 'addEvidence', 'removeEvidence', 'addResolutions', 'removeResolutions'].includes(key))) fail('存在未知编辑字段');
    const criterion = update.criterion;
    if (typeof criterion !== 'string' || updates.has(criterion)) fail('检查项缺失或重复');
    const before = original.checks.find(check => check.criterion === criterion);
    if (!before) fail('不能新增未知检查项');
    const { addEvidence, removeEvidence, addResolutions, removeResolutions, ...replacement } = update;
    if (!Array.isArray(addResolutions) || !Array.isArray(removeResolutions)) fail('必须明确给出新增和撤销解除声明数组；空数组表示保留原声明');
    const resolutions = new Set(before!.resolves ?? []);
    for (const id of removeResolutions as unknown[]) {
      if (typeof id !== 'string' || !resolutions.delete(id)) fail('只能撤销原回答已有的解除声明');
      if (update.verdict === 'pass') fail('不能维持通过并撤销原问题解除；原问题未解决应明确改为insufficient或revise');
    }
    for (const id of addResolutions as unknown[]) {
      if (typeof id !== 'string' || !id) fail('新增解除声明必须使用真实问题ID');
      resolutions.add(id as string);
    }
    if (!Array.isArray(addEvidence) || !Array.isArray(removeEvidence)) fail('必须明确给出新增和删除引用数组');
    const existing = new Set(before!.evidence.map(evidence => evidence.fragmentId));
    const removed = new Set<string>();
    for (const id of removeEvidence as unknown[]) {
      if (typeof id !== 'string' || !existing.has(id) || removed.has(id)) fail('删除项必须是原回答已有且不重复的片段');
      removed.add(id as string);
    }
    const additions = (addEvidence as unknown[]).map(evidence => {
      if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) || Object.keys(evidence).length !== 1 || !('fragmentId' in evidence) || typeof evidence.fragmentId !== 'string') fail('新增引用只能包含fragmentId');
      const id = (evidence as { fragmentId: string }).fragmentId;
      if (removed.has(id)) fail('不能同时删除又新增同一片段');
      return { fragmentId: id };
    });
    if (Object.hasOwn(replacement, 'evidence')) fail('使用新增/删除操作，不直接替换引用数组');
    updates.set(criterion as string, { ...replacement, ...(resolutions.size ? { resolves: [...resolutions] } : {}),
      evidence: [...new Map([...before!.evidence.filter(evidence => !removed.has(evidence.fragmentId)), ...additions].map(evidence => [evidence.fragmentId, evidence])).values()] });
  }
  return anchoredDesignReviewResultSchema.parse({ requestId: original.requestId, summary: patch.summary,
    checks: original.checks.map(check => updates.get(check.criterion) ?? check) });
}

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
  const pending = snapshot.stage?.coverage?.pendingChecks?.find(check => check.id === (snapshot.stage?.reconsiderationFor ?? snapshot.stage?.followupFor));
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
    // A compact exact directory helps a repair navigate the already-sent text.
    // Never infer replacement anchors from the numbers in a rejected answer.
    fragmentRepairContext(value: unknown): Record<string, unknown> {
      const parsed = anchoredDesignReviewResultSchema.safeParse(value);
      if (!parsed.success) return {};
      return {
        expectedRequestId: requestId,
        fragmentReferenceProblems: parsed.data.checks.flatMap((check, checkIndex) =>
          check.evidence.flatMap((evidence, evidenceIndex) => lookup.has(evidence.fragmentId) ? [] : [{
            checkIndex, criterion: check.criterion, evidenceIndex, invalidFragmentId: evidence.fragmentId,
          }])),
        availableEvidenceSources: sources.map(source => ({
          unitId: source.id, sourceId: source.origin?.sourceId ?? source.id,
          fragmentIds: source.fragments.map(fragment => fragment.id),
        })),
      };
    },
    // Inspect raw source requests even when mutually exclusive fields prevent
    // the full answer from parsing. Diagnostics only; never replace IDs or
    // decide whether a macro source is sufficient for the model's question.
    sourceRepairContext(value: unknown): Record<string, unknown> {
      const known = snapshot.stage?.coverage?.sourceLengths;
      if (!known || !value || typeof value !== 'object' || !('requestId' in value)
        || value.requestId !== requestId || !('checks' in value) || !Array.isArray(value.checks)) return {};
      const awaitingSourceProblems = value.checks.flatMap((check, checkIndex) => {
        if (!check || typeof check !== 'object' || typeof check.criterion !== 'string' || !Array.isArray(check.awaitingSources)) return [];
        const invalidSourceIds = [...new Set(check.awaitingSources.filter((id: unknown): id is string =>
          typeof id === 'string' && !Object.hasOwn(known, id)))];
        return invalidSourceIds.length ? [{ checkIndex, criterion: check.criterion, invalidSourceIds }] : [];
      });
      if (!awaitingSourceProblems.length) return {};
      const missingChapters = awaitingSourceProblems.flatMap(problem => problem.invalidSourceIds.flatMap(id => {
        const match = /^plan\/chapters\/([1-9]\d*)$/.exec(id);
        const chapter = match ? Number(match[1]) : NaN;
        return Number.isSafeInteger(chapter) ? [chapter] : [];
      }));
      const macroSourceCandidates = (snapshot.stage?.coverage?.planRanges ?? [])
        .filter(range => Object.hasOwn(known, range.sourceId)
          && missingChapters.some(chapter => chapter >= range.startChapter && chapter <= range.endChapter))
        .map(range => ({ ...range, unitsInThisRequest: sources.filter(source =>
          (source.origin?.sourceId ?? source.id) === range.sourceId).map(source => source.id) }));
      return { awaitingSourceProblems, availableSourceIds: Object.keys(known),
        ...(macroSourceCandidates.length ? { planningHorizon: designReviewHorizon(snapshot), macroSourceCandidates } : {}),
      };
    },
    resolutionRepairContext(value: unknown) {
      const parsed = anchoredDesignReviewResultSchema.safeParse(value);
      if (!parsed.success || parsed.data.requestId !== requestId) return {};
      // Patch deletions are scoped to the selected evidence of one check,
      // not the request-wide fragment catalogue. Expose that distinction even
      // when this request has no report budget (or has an invalid anchor).
      const citationEditTargets = parsed.data.checks.map(check => ({
        criterion: check.criterion,
        selectedFragmentIds: [...new Set(check.evidence.map(evidence => evidence.fragmentId))],
        claimedResolutionIds: check.resolves ?? [],
      }));
      const requirements = pendingCitationRequirements ?? (citationRequirements ? [{
        checkId: citationRequirements.checkId, criterion: citationRequirements.criterion,
        requiredSources: citationRequirements.sources,
        oneOfPriorUnits: sources.filter(source => pending!.priorUnitIds.includes(source.id))
          .map(source => ({ id: source.id, fragmentIds: source.fragments.map(fragment => fragment.id) })),
      }] : []);
      // Report selections for every claimed resolution, not just the missing
      // source in the error. A repair must not fix one question by dropping
      // the evidence it previously supplied for another. This is navigation
      // only: the model still chooses citations and re-evaluates their meaning.
      const resolutionCitationSelection = requirements.flatMap(requirement => {
        const check = parsed.data.checks.find(check => check.criterion === requirement.criterion);
        if (!check?.resolves?.includes(requirement.checkId)) return [];
        const selected = new Set(check.evidence.map(evidence => evidence.fragmentId));
        const selection = (units: Array<{ fragmentIds: string[] }>) => {
          const available = [...new Set(units.flatMap(unit => unit.fragmentIds))];
          const selectedFragmentIds = available.filter(id => selected.has(id));
          return { selectedFragmentIds, ...(selectedFragmentIds.length ? {} : { availableFragmentIds: available }) };
        };
        return [{ checkId: requirement.checkId, criterion: requirement.criterion,
          requiredSources: requirement.requiredSources.map(source => ({ sourceId: source.sourceId, ...selection(source.units) })),
          oneOfPriorUnits: selection(requirement.oneOfPriorUnits),
        }];
      });
      const budget = snapshot.stage?.reportBudget;
      // Navigation only. Use the same schema and renderer as acceptance, even
      // when a missing required source prevents the answer from being accepted.
      // Unknown anchors must never receive a fabricated size estimate.
      if (!budget || parsed.data.checks.some(check => check.evidence.some(e => !lookup.has(e.fragmentId)))) return { citationEditTargets, resolutionCitationSelection };
      const expanded = designReviewResultSchema.parse({ ...parsed.data, checks: parsed.data.checks.map(check => ({
        ...check, evidence: check.evidence.map(e => lookup.get(e.fragmentId)!),
      })) });
      const currentCharacters = designReviewReportEnvelopeSize(snapshot, expanded, budget.sourceId);
      const maxCitationNumber = Math.max(snapshot.stage?.evidenceLimit ?? 64, ...parsed.data.checks.map(check => check.evidence.length + 1));
      return { citationEditTargets, resolutionCitationSelection, reportCapacity: {
        maxCharacters: budget.maxCharacters, currentCharacters, remainingCharacters: budget.maxCharacters - currentCharacters,
        selectedCitations: parsed.data.checks.map((check, index) => ({ criterion: check.criterion,
          evidence: check.evidence.map((e, citation) => ({ fragmentId: e.fragmentId,
            characters: designReviewCitationEnvelopeCharacters(snapshot, lookup.get(e.fragmentId)!, index + 1, citation + 1) })),
        })),
        fragments: [...lookup].map(([fragmentId, entry]) => ({ fragmentId,
          maxAppendCharacters: designReviewCitationEnvelopeCharacters(snapshot, entry, parsed.data.checks.length, maxCitationNumber) })),
        guidance: '大小为完整报告及来源位置经过JSON转义后的UTF-16字符数，不是短回答长度或token数。remainingCharacters可以为负数。selectedCitations.characters是该条已有引文的展开开销；删除后其他编号变短可能额外节省。fragments.maxAppendCharacters是单次新增引用在本批编号范围内的开销上界；同片段用于不同检查分别计费。更改总结、解释、建议和解除声明也会改变总量。只选择实际支持结论的必要片段；需要删引文时须明确removeEvidence，不能删除必引来源、截断原文、遗漏检查或隐瞒问题。若完整必要证据确实无法容纳，保留insufficient并说明capacity_limit。系统仍完整校验，不按预算自动删改证据或判定。',
      } };
    },
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
