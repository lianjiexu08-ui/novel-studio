export interface ReviewSourceInput {
  sources: Array<{ id: string; text: string }>;
  stage?: {
    sourceMap: Array<{ id: string; sourceId: string; start: number; end: number }>;
    coverage?: {
      mode: 'whole_input' | 'local_sources' | 'reports_with_context';
      sourceLengths: Record<string, number>;
      sourceNames?: Record<string, string>;
      sourceRelationships?: Record<string, { fromCharacterId: string; toCharacterId: string; fromName?: string; toName?: string; kind?: string }>;
      planRanges?: Array<{ sourceId: string; startChapter: number; endChapter: number; title?: string }>;
      synthesis?: { scope: 'partial_reports' | 'complete_reports'; coveredStageIds: string[]; totalStages: number };
    };
  };
}

export type SourceCoverage = {
  id: string; name?: string; length: number;
  status: 'complete' | 'partial' | 'absent' | 'unknown';
  fragments: Array<{ id: string; text: string; start: number; end: number }>;
};

/** Only direct original-source envelopes count. A mention inside a report
 * cannot prove that the original was supplied in full to this step. */
export function reviewSourceCoverage(input: ReviewSourceInput): SourceCoverage[] | undefined {
  const coverage = input.stage?.coverage;
  if (!coverage) return undefined;
  return Object.entries(coverage.sourceLengths).map(([id, length]) => {
    const units = input.stage!.sourceMap.filter(unit => unit.sourceId === id).sort((a, b) => a.start - b.start);
    const fragments: SourceCoverage['fragments'] = [];
    let invalid = !Number.isSafeInteger(length) || length < 0;
    for (const unit of units) {
      const sources = input.sources.filter(source => source.id === unit.id);
      if (sources.length !== 1 || !Number.isSafeInteger(unit.start) || !Number.isSafeInteger(unit.end)
        || unit.start < 0 || unit.end < unit.start || unit.end > length || sources[0]?.text.length !== unit.end - unit.start) invalid = true;
      if (sources.length === 1) fragments.push({ ...sources[0], start: unit.start, end: unit.end });
    }
    if (!units.length) {
      const direct = input.sources.filter(source => source.id === id);
      if (direct.length > 1) invalid = true;
      if (direct.length === 1) {
        fragments.push({ ...direct[0], start: 0, end: direct[0].text.length });
        if (direct[0].text.length !== length) invalid = true;
      }
    }
    let end = 0, contiguous = true;
    for (const fragment of fragments) {
      if (fragment.start < end) invalid = true;
      if (fragment.start !== end) contiguous = false;
      end = fragment.end;
    }
    const status = invalid ? 'unknown' : !fragments.length ? 'absent' : contiguous && end === length ? 'complete' : 'partial';
    const chapter = /^plan\/chapters\/(\d+)$/.exec(id);
    const relationship = coverage.sourceRelationships?.[id];
    const endpoint = (id: string, name?: string) => name ? `${name}（${id}）` : id;
    const relationshipName = relationship ? `${endpoint(relationship.fromCharacterId, relationship.fromName)} → ${endpoint(relationship.toCharacterId, relationship.toName)}` : undefined;
    const name = relationshipName ?? coverage.sourceNames?.[id] ?? coverage.planRanges?.find(range => range.sourceId === id)?.title
      ?? (chapter ? `第${chapter[1]}章章纲` : id === 'plan/overview' ? '全书计划概要' : undefined);
    return { id, name, length, status, fragments };
  });
}
