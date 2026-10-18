import type { DesignReviewInput, DesignReviewResult } from './design-review.ts';

export interface ReviewEvidenceSource {
  sourceId: string;
  text: string;
  start?: number;
  unitId?: string;
}

export interface ReviewResolutionNote {
  checkId: string;
  resolvedByStageId: string;
  explanation: string;
  kind?: 'reconsideration';
}

/** Size of a newly accepted report, before any later follow-up dispositions.
 * Use exactly the same origins, offsets and source envelope as the scheduler. */
function evidenceResolver(input: DesignReviewInput) {
  return (id: string) => {
    const source = input.sources.find(source => source.id === id);
    if (!source) return undefined;
    const unit = input.stage?.sourceMap.find(unit => unit.id === id);
    return unit ? { sourceId: unit.sourceId, unitId: unit.id, start: unit.start, text: source.text }
      : { sourceId: id, text: source.text };
  };
}

export function designReviewReportEnvelopeSize(input: DesignReviewInput, result: DesignReviewResult, sourceId: string): number {
  const text = renderDesignReviewReport(result, evidenceResolver(input));
  return JSON.stringify([{ id: sourceId, text }]).length;
}

/** Exact contribution of one citation, including its separator and JSON escaping.
 * Removing a citation can also shorten later numbered labels; this excludes that saving. */
export function designReviewCitationEnvelopeCharacters(input: DesignReviewInput, entry: DesignReviewResult['checks'][number]['evidence'][number], checkNumber: number, citationNumber: number): number {
  return JSON.stringify('\n' + renderIndependentQuote(entry, evidenceResolver(input), `${checkNumber}.${citationNumber}`)).length - 2;
}

function renderIndependentQuote(entry: DesignReviewResult['checks'][number]['evidence'][number], resolve: (id: string) => ReviewEvidenceSource | undefined, label: string): string {
  const source = resolve(entry.sourceId);
  const offset = source?.text.indexOf(entry.quote) ?? -1;
  const unique = offset >= 0 && source!.text.indexOf(entry.quote, offset + 1) < 0;
  // Repeated quotations do not have a uniquely provable location.
  const origin = source && unique ? {
    sourceId: source.sourceId, ...(source.unitId ? { unitId: source.unitId } : {}),
    start: (source.start ?? 0) + offset, end: (source.start ?? 0) + offset + entry.quote.length, unique: true,
  } : { sourceId: source?.sourceId ?? entry.sourceId, ...(source?.unitId ? { unitId: source.unitId } : {}), unique: false };
  return `\nBEGIN INDEPENDENT QUOTE ${label}\n${JSON.stringify(origin)}\n${entry.quote}\nEND INDEPENDENT QUOTE ${label}`;
}

/** Keep independent excerpts visibly separate. JSON-encoding a report and then
 * slicing its escaped quotation strings can make omitted records look adjacent. */
export function renderDesignReviewReport(result: DesignReviewResult, resolve: (id: string) => ReviewEvidenceSource | undefined, resolutions: Readonly<Record<string, ReviewResolutionNote>> = {}): string {
  const lines = ['前置报告。以下引文是独立摘录；同一来源的摘录可能相隔很远，不可把不同摘录里的字段拼成同一条记录。字符范围采用原始来源的UTF-16下标，右端不含。'];
  if (Object.values(resolutions).some(item => item.kind === 'reconsideration')) lines.push('含正式复核记录：对应原revise已经完整原文复核解决，但原判定和原评语仍保留；只有明确列出的整项判定被解除，其他问题仍有效。');
  if (Object.keys(resolutions).length) lines.push('本报告含已由原文补读显式解决的等待项。下面保留原始摘要和判定作为历史，并在对应检查前列出当前处理说明。复核解释仍是评审结论，完整原文和引用保存在所指的复核步骤；它不是正文事实，也不代表本报告或全领域通过。其他返修和普通不足仍然有效。');
  const { checks, ...head } = result;
  lines.push(JSON.stringify(head, null, 2));
  for (const [index, check] of checks.entries()) {
    const { evidence, ...finding } = check;
    const resolution = resolutions[check.criterion];
    if (resolution) {
      if (resolution.kind === 'reconsideration') {
        if (check.verdict !== 'revise') throw new Error('正式复核解除说明必须对应原返修');
        lines.push(`\nCURRENT DISPOSITION ${index + 1}\n${JSON.stringify({ disposition: 'resolved_by_raw_reconsideration', ...resolution }, null, 2)}\n下列原始revise是已正式复核解决的历史判断；仍须检查其他实际冲突。`);
      } else {
        if (check.verdict !== 'insufficient' || !check.awaitingSources?.length) throw new Error('只有显式等待补读项可以附加解除说明');
        lines.push(`\nCURRENT DISPOSITION ${index + 1}\n${JSON.stringify({ disposition: 'resolved_by_raw_review', ...resolution }, null, 2)}\n下列原始insufficient属于已解决的历史等待，不得因本步未重发全部补读原文而重新认定缺料；仍须检查本步实际可见的具体矛盾。`);
      }
    }
    lines.push(`\nCHECK ${index + 1}\n${JSON.stringify(finding, null, 2)}`);
    for (const [citation, entry] of evidence.entries()) {
      const label = `${index + 1}.${citation + 1}`;
      lines.push(renderIndependentQuote(entry, resolve, label));
    }
  }
  return lines.join('\n');
}
