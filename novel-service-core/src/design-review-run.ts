import { randomUUID } from 'node:crypto';
import { maxDesignReviewEvidence } from '../../packages/contracts/src/index.ts';
import { renderDesignReviewReport } from './design-review-report.ts';
import { designReviewPlanRanges, designReviewSourceNames, localDesignReviewRubric } from './design-review-scope.ts';
import { DesignReviewError, validateDesignReview, type DesignReviewInput, type DesignReviewResult, type DesignReviewSource } from './design-review.ts';

export const designReviewCapacity = 240_000;
const batchCapacity = 100_000;
const resultCapacity = 40_000;
// Measured as the exact serialized source envelope sent to synthesis. Two
// 90k reports plus at most 40k planning context stay below the 240k input cap.
const scopedResultSourceCapacity = 90_000;
const sharedContextCapacity = 40_000;
export interface DesignReviewUnit { id: string; sourceId: string; start: number; end: number }
export interface DesignReviewStage {
  id: string;
  kind: 'batch' | 'cross' | 'synthesis';
  label: string;
  unitIds: string[];
  children: string[];
  /** A bounded raw-source recheck of one unresolved unread-source question. */
  followupFor?: string;
  result?: DesignReviewResult;
  attempts: number;
  error?: string;
  modelResponses?: string[];
  rejectedResult?: DesignReviewResult;
  failures?: Array<{ at: string; error: string; modelResponses?: string[]; rejectedResult?: DesignReviewResult }>;
}
export interface DesignReviewRun {
  id: string;
  /** Absent on persisted legacy schedules, which must resume without reshuffling. */
  scheduleVersion?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
  input: DesignReviewInput;
  units: DesignReviewUnit[];
  stages: DesignReviewStage[];
  status: 'ready' | 'running' | 'failed' | 'completed' | 'outdated';
  createdAt: string;
  updatedAt: string;
  reportId?: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
}

/** All raw text is retained. Cross checks co-read every pair of partitions;
 * synthesis then combines every finding without allowing a blocker to disappear. */
export function createDesignReviewRun(input: DesignReviewInput, now = new Date().toISOString(), scheduleVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 = 11): DesignReviewRun {
  if (new Set(input.sources.map(s => s.id)).size !== input.sources.length) throw new DesignReviewError('评审来源 ID 重复');
  const units: DesignReviewUnit[] = [];
  const stages: DesignReviewStage[] = [];
  const small = JSON.stringify(input.sources).length <= designReviewCapacity;
  // Two v3 raw batches plus shared context use at most 220k characters,
  // leaving room for the exact questions a cross check must resolve.
  const ordinaryBatchCapacity = scheduleVersion >= 3 ? 90_000 : batchCapacity;
  for (const source of input.sources) {
    let start = 0;
    do {
      let end = small ? source.text.length : Math.min(start + 10_000, source.text.length);
      if (end < source.text.length && /[\uD800-\uDBFF]/.test(source.text[end - 1])) end--;
      units.push({ id: small ? source.id : `review-unit/${units.length + 1}`, sourceId: source.id, start, end });
      start = end;
    } while (start < source.text.length);
  }
  const unitSource = (u: DesignReviewUnit) => ({ id: u.id, text: input.sources.find(s => s.id === u.sourceId)!.text.slice(u.start, u.end) });
  // A late chapter-only batch still needs the actual rules it is judging. Repeat
  // bounded, complete sources; unselected sources remain in the ordinary batches.
  const shared: DesignReviewUnit[] = [];
  if (!small && scheduleVersion >= 2) {
    const priorities = input.area === 'power'
      ? ['author', 'plan/overview', 'world/axioms/', 'world/powerSystems/', 'world/tierLadders/', 'world/realms/', 'world/techniques/', 'world/artifacts/', 'world/resources/']
      : input.area === 'characters'
        ? ['author', 'plan/overview', 'world/axioms/', 'story/characters/', 'world/realms/', 'story/overview', 'world/factions/']
        : ['author', 'plan/overview', 'world/axioms/', 'world/realms/', 'world/locations/', 'story/characters/', 'world/techniques/', 'world/artifacts/'];
    for (const prefix of priorities) for (const source of input.sources.filter(s => prefix.endsWith('/') ? s.id.startsWith(prefix) : s.id === prefix)) {
      const sourceUnits = units.filter(u => u.sourceId === source.id);
      if (JSON.stringify([...shared, ...sourceUnits].map(unitSource)).length <= sharedContextCapacity) shared.push(...sourceUnits);
    }
  }
  const sharedIds = new Set(shared.map(u => u.id));
  let pending: DesignReviewUnit[] = [];
  const flush = () => { if (pending.length) stages.push({ id: `batch-${stages.length + 1}`, kind: 'batch', label: `原文批次 ${stages.length + 1}`, unitIds: [...shared, ...pending].map(u => u.id), children: [], attempts: 0 }); pending = []; };
  const ordinary = units.filter(u => !sharedIds.has(u.id));
  // A bible summary deliberately omits fields such as the detailed cost ledger.
  // Co-read both versions of a chapter so that omission is not mistaken for a
  // missing plan. Neither source wins: disagreements still need review.
  const groups = scheduleVersion >= 4 ? chapterUnitGroups(input.sources, ordinary) : ordinary.map(unit => [unit]);
  for (const group of groups) {
    if (!small && JSON.stringify(group.map(unitSource)).length > ordinaryBatchCapacity) {
      // Very large chapters still use the bounded slicing and cross checks.
      // Never truncate them or enlarge the request to keep a pair together.
      for (const unit of group) {
        if (JSON.stringify([...pending, unit].map(unitSource)).length > ordinaryBatchCapacity) flush();
        pending.push(unit);
      }
    } else {
      if (!small && JSON.stringify([...pending, ...group].map(unitSource)).length > ordinaryBatchCapacity) flush();
      pending.push(...group);
    }
  }
  flush();
  const batches = [...stages];
  if (batches.length > 64) throw new DesignReviewError('评审需要超过64个原文批次，请先拆分作品验收阶段；原文未截断，尚未调用模型');
  for (let a = 0; a < batches.length; a++) for (let b = a + 1; b < batches.length; b++) {
    stages.push({ id: `cross-${a + 1}-${b + 1}`, kind: 'cross', label: `跨批检查 ${a + 1} / ${b + 1}`, unitIds: [...new Set([...batches[a].unitIds, ...batches[b].unitIds])], children: [], attempts: 0 });
  }
  // Keep the real planning horizon visible during synthesis. A prior report
  // saying "all 100 chapters need detailed scenes" is not the source plan.
  const overviewUnits = scheduleVersion >= 3 ? units.filter(u => u.sourceId === 'plan/overview') : [];
  const synthesisContext = JSON.stringify(overviewUnits.map(unitSource)).length <= sharedContextCapacity ? overviewUnits : [];
  let level = stages.map(s => s.id);
  let sequence = 0;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) { next.push(level[i]); continue; }
      const id = `synthesis-${++sequence}`;
      stages.push({ id, kind: 'synthesis', label: `综合检查 ${sequence}`, unitIds: synthesisContext.map(u => u.id), children: level.slice(i, i + 2), attempts: 0 }); next.push(id);
    }
    level = next;
  }
  return { id: `design_run_${randomUUID()}`, ...(scheduleVersion >= 2 ? { scheduleVersion: scheduleVersion as 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 } : {}), input: structuredClone(input), units, stages, status: 'ready', createdAt: now, updatedAt: now };
}

function chapterUnitGroups(sources: DesignReviewSource[], units: DesignReviewUnit[]): DesignReviewUnit[][] {
  const chapters = new Map<number, { kinds: Set<string>; sourceIds: string[] }>();
  for (const source of sources) {
    const kind = source.id.startsWith('story/chapterPlans/') ? 'bible' : source.id.startsWith('plan/chapters/') ? 'plan' : undefined;
    if (!kind) continue;
    let chapterNumber: unknown;
    try { chapterNumber = JSON.parse(source.text)?.chapterNumber; } catch { continue; }
    if (typeof chapterNumber !== 'number' || !Number.isSafeInteger(chapterNumber) || chapterNumber < 1) continue;
    const chapter = chapters.get(chapterNumber) ?? { kinds: new Set<string>(), sourceIds: [] };
    chapter.kinds.add(kind); chapter.sourceIds.push(source.id); chapters.set(chapterNumber, chapter);
  }
  const paired = new Map<string, number>();
  for (const [number, chapter] of chapters) if (chapter.kinds.size === 2) for (const id of chapter.sourceIds) paired.set(id, number);
  const grouped = new Map<number, DesignReviewUnit[]>();
  for (const unit of units) {
    const number = paired.get(unit.sourceId);
    if (number !== undefined) { const group = grouped.get(number) ?? []; group.push(unit); grouped.set(number, group); }
  }
  const emitted = new Set<number>();
  return units.flatMap(unit => {
    const number = paired.get(unit.sourceId);
    if (number === undefined) return [[unit]];
    if (emitted.has(number)) return [];
    emitted.add(number); return [grouped.get(number)!];
  });
}

export function designReviewUnitSources(run: DesignReviewRun): DesignReviewSource[] {
  return run.units.map(u => ({ id: u.id, text: run.input.sources.find(s => s.id === u.sourceId)!.text.slice(u.start, u.end) }));
}
function resultSource(run: DesignReviewRun, stage: DesignReviewStage, cache = new Map<string, DesignReviewSource>()): DesignReviewSource {
  const cached = cache.get(stage.id);
  if (cached) return cached;
  const text = (run.scheduleVersion ?? 1) < 6 ? JSON.stringify(stage.result, null, 2) : renderDesignReviewReport(stage.result!, id => {
    const unit = run.units.find(u => u.id === id);
    if (unit) return { sourceId: unit.sourceId, unitId: unit.id, start: unit.start, text: run.input.sources.find(s => s.id === unit.sourceId)!.text.slice(unit.start, unit.end) };
    // Reports may only refer to earlier stages. This also prevents a corrupt
    // stored citation from recursing back into its own report.
    const index = run.stages.findIndex(s => s.id === stage.id);
    const prior = run.stages.slice(0, index).find(s => `review-result/${s.id}` === id && s.result);
    if (prior) return { sourceId: id, text: resultSource(run, prior, cache).text };
    const question = deferrals(run, index).find(p => p.question.id === id)?.question;
    return question ? { sourceId: question.id, text: question.text } : undefined;
  });
  const source = { id: `review-result/${stage.id}`, text };
  cache.set(stage.id, source);
  return source;
}
function deferrals(run: DesignReviewRun, before = run.stages.length) {
  return run.stages.slice(0, before).flatMap(stage => stage.kind === 'synthesis' || stage.followupFor ? [] : (stage.result?.checks ?? []).filter(check => check.verdict === 'insufficient' && check.awaitingSources?.length).map(check => ({
    id: `${stage.id}/${check.criterion}`, stage, check,
    question: { id: `review-question/${stage.id}/${check.criterion}`, text: JSON.stringify({ criterion: check.criterion, explanation: check.explanation, revisionAdvice: check.revisionAdvice, awaitingSources: check.awaitingSources }, null, 2) },
  })));
}
function coversDeferral(run: DesignReviewRun, stage: DesignReviewStage, pending: ReturnType<typeof deferrals>[number]) {
  if (stage.followupFor) return (run.scheduleVersion ?? 1) >= 5 && stage.followupFor === pending.id
    && followupUnits(run, pending)?.every(id => stage.unitIds.includes(id)) === true;
  return stage.kind !== 'synthesis' && [...pending.stage.unitIds, ...run.units.filter(u => pending.check.awaitingSources!.includes(u.sourceId)).map(u => u.id)].every(id => stage.unitIds.includes(id));
}

/** Prefer the entire original batch. When it cannot fit, re-read complete
 * sources for its cited evidence plus every requested source and shared rules.
 * Never turn a partial quotation or an inventory entry into source coverage. */
function followupUnits(run: DesignReviewRun, pending: ReturnType<typeof deferrals>[number]): string[] | undefined {
  const sources = designReviewUnitSources(run);
  const required = run.units.filter(u => pending.check.awaitingSources!.includes(u.sourceId)).map(u => u.id);
  const cited = new Set(pending.check.evidence.flatMap(e => {
    const unit = run.units.find(u => u.id === e.sourceId && pending.stage.unitIds.includes(u.id));
    return unit ? [unit.sourceId] : [];
  }));
  // One citation per original/requested source and one for the question must
  // be expressible without violating the result contract.
  if (new Set([...cited, ...pending.check.awaitingSources!]).size + 1 > maxDesignReviewEvidence) return undefined;
  const fits = (ids: string[]) => JSON.stringify([...sources.filter(s => ids.includes(s.id)), pending.question]).length <= designReviewCapacity;
  const citedUnits = run.units.filter(u => cited.has(u.sourceId)).map(u => u.id);
  const full = [...new Set([...pending.stage.unitIds, ...citedUnits, ...required])];
  if (fits(full)) return full;
  if (!cited.size) return undefined;
  const batches = run.stages.filter(s => s.kind === 'batch');
  const common = run.units.filter(u => batches.every(b => b.unitIds.includes(u.id))).map(u => u.sourceId);
  const sourceIds = new Set([...cited, ...common, 'plan/overview', ...pending.check.awaitingSources!]);
  const focused = run.units.filter(u => sourceIds.has(u.sourceId)).map(u => u.id);
  return fits(focused) ? focused : undefined;
}

/** Freeze additional checks after all original raw checks finish, before any
 * synthesis. Their content is derived from immutable questions and citations;
 * questions too large to co-read remain unresolved, never truncated. */
function scheduleFollowups(run: DesignReviewRun): void {
  if ((run.scheduleVersion ?? 1) < 5) return;
  const raw = run.stages.filter(s => s.kind !== 'synthesis' && !s.followupFor);
  if (raw.some(s => !s.result) || run.stages.some(s => s.followupFor || s.kind === 'synthesis' && s.result)) return;
  const resolved = new Set(resolvedDeferrals(run).map(r => r.checkId));
  const followups: DesignReviewStage[] = [];
  for (const pending of deferrals(run)) {
    if (resolved.has(pending.id)) continue;
    const unitIds = followupUnits(run, pending);
    if (unitIds) followups.push({ id: `followup-${pending.id}`, kind: 'cross', label: `原文补读 ${pending.id}`, unitIds, children: [], followupFor: pending.id, attempts: 0 });
  }
  if (!followups.length) return;
  const context = run.stages.find(s => s.kind === 'synthesis')?.unitIds ?? [];
  let level = [...raw, ...followups].map(s => s.id);
  const synthesis: DesignReviewStage[] = [];
  let sequence = 0;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) { next.push(level[i]); continue; }
      const id = `synthesis-${++sequence}`;
      synthesis.push({ id, kind: 'synthesis', label: `综合检查 ${sequence}`, unitIds: [...context], children: level.slice(i, i + 2), attempts: 0 });
      next.push(id);
    }
    level = next;
  }
  run.stages.splice(raw.length, run.stages.length - raw.length, ...followups, ...synthesis);
}
function resolvedDeferrals(run: DesignReviewRun, before = run.stages.length) {
  return deferrals(run, before).flatMap(pending => {
    const resolver = run.stages.slice(run.stages.indexOf(pending.stage) + 1, before).find(stage => coversDeferral(run, stage, pending) && stage.result?.checks.some(check => check.criterion === pending.check.criterion && check.verdict === 'pass' && check.resolves?.includes(pending.id)));
    return resolver ? [{ checkId: pending.id, resolvedByStageId: resolver.id }] : [];
  });
}
function synthesisCoverage(run: DesignReviewRun, stage: DesignReviewStage) {
  const indexed = new Map(run.stages.map((item, index) => [item.id, { item, index }]));
  const covered = new Set<string>();
  const visited = new Set<string>();
  function visit(current: DesignReviewStage): void {
    if (visited.has(current.id)) return;
    visited.add(current.id);
    if (current.kind !== 'synthesis') { covered.add(current.id); return; }
    for (const id of current.children) {
      const child = indexed.get(id);
      if (!child || child.index >= indexed.get(current.id)!.index) throw new DesignReviewError('综合报告依赖必须指向此前步骤');
      visit(child.item);
    }
  }
  visit(stage);
  const raw = run.stages.filter(item => item.kind !== 'synthesis');
  const coveredStageIds = raw.filter(item => covered.has(item.id)).map(item => item.id);
  return { scope: coveredStageIds.length === raw.length ? 'complete_reports' as const : 'partial_reports' as const, coveredStageIds, totalStages: raw.length };
}

export function designReviewStageInput(run: DesignReviewRun, stage: DesignReviewStage): DesignReviewInput {
  const stageIndex = run.stages.findIndex(s => s.id === stage.id);
  if (stageIndex < 0) throw new DesignReviewError('评审步骤不属于本任务');
  const followup = stage.followupFor ? deferrals(run, stageIndex).find(p => p.id === stage.followupFor) : undefined;
  if (stage.followupFor && ((run.scheduleVersion ?? 1) < 5 || !followup)) throw new DesignReviewError('补读步骤没有原始等待问题');
  const rawSources = designReviewUnitSources(run).filter(s => stage.unitIds.includes(s.id));
  const sources = stage.kind === 'synthesis' ? [...stage.children.map(id => {
    const child = run.stages.find(s => s.id === id);
    if (!child?.result) throw new DesignReviewError('前置批次尚未完成');
    return resultSource(run, child);
  }), ...rawSources] : rawSources;
  if (JSON.stringify(sources).length > designReviewCapacity) throw new DesignReviewError('本批材料超出单次评审容量；未截断原文');
  const coverage: NonNullable<DesignReviewInput['stage']>['coverage'] = (run.scheduleVersion ?? 1) >= 3 ? {
    mode: stage.kind === 'synthesis' ? 'reports_with_context' : run.units.every(u => stage.unitIds.includes(u.id)) ? 'whole_input' : 'local_sources',
    sourceLengths: Object.fromEntries(run.input.sources.map(s => [s.id, s.text.length])),
    ...((run.scheduleVersion ?? 1) >= 10 ? { sourceNames: designReviewSourceNames(run.input) } : {}),
    ...((run.scheduleVersion ?? 1) >= 9 ? { planRanges: designReviewPlanRanges(run.input) } : {}),
  } : undefined;
  if (coverage && stage.kind !== 'synthesis') {
    const pendingChecks: NonNullable<typeof coverage.pendingChecks> = [];
    for (const pending of deferrals(run, stageIndex)) {
      if (!coversDeferral(run, stage, pending)) continue;
      // Do not remove raw material to squeeze in a question. If it cannot fit,
      // this stage cannot authorize a resolution; the unresolved item blocks.
      if (JSON.stringify([...sources, pending.question]).length > designReviewCapacity) continue;
      sources.push(pending.question);
      const priorSourceIds = followup ? [...new Set(pending.check.evidence.flatMap(e => {
        const unit = run.units.find(u => u.id === e.sourceId && pending.stage.unitIds.includes(u.id));
        return unit ? [unit.sourceId] : [];
      }))] : undefined;
      pendingChecks.push({ id: pending.id, criterion: pending.check.criterion, questionSourceId: pending.question.id, requiredSourceIds: pending.check.awaitingSources!, priorUnitIds: pending.stage.unitIds.filter(id => stage.unitIds.includes(id)), ...(priorSourceIds ? { priorSourceIds } : {}) });
    }
    if (pendingChecks.length) coverage.pendingChecks = pendingChecks;
  }
  if (coverage && stage.kind === 'synthesis') {
    coverage.resolvedDeferrals = resolvedDeferrals(run, stageIndex);
    if ((run.scheduleVersion ?? 1) >= 11) coverage.synthesis = synthesisCoverage(run, stage);
  }
  if (coverage && JSON.stringify(coverage).length > sharedContextCapacity) throw new DesignReviewError('评审范围目录与补读元数据超过容量，请拆分作品验收阶段；目录未截断');
  const rubric = followup ? { [followup.check.criterion]: run.input.rubric[followup.check.criterion] }
    : (run.scheduleVersion ?? 1) >= 7 && coverage?.mode === 'local_sources' ? localDesignReviewRubric(run.input, run.scheduleVersion) : structuredClone(run.input.rubric);
  return { ...structuredClone(run.input), rubric, sources, stage: {
    kind: stage.kind, label: stage.label, totalBatches: run.stages.filter(s => s.kind === 'batch').length,
    ...(followup ? { followupFor: followup.id } : {}),
    sourceMap: run.units.filter(u => stage.unitIds.includes(u.id)),
    ...(coverage ? { coverage } : {}),
  } };
}

export function acceptDesignReviewStage(run: DesignReviewRun, stage: DesignReviewStage, result: DesignReviewResult): void {
  const input = designReviewStageInput(run, stage);
  validateDesignReview(input, result);
  const tooLarge = (run.scheduleVersion ?? 1) >= 3
    ? JSON.stringify([resultSource(run, { ...stage, result })]).length > scopedResultSourceCapacity
    : JSON.stringify(result).length > resultCapacity;
  if (tooLarge) throw new DesignReviewError('本批评审结论过长，请重新评审并精炼解释；原文与失败记录保留');
  stage.result = structuredClone(result); stage.error = undefined;
  scheduleFollowups(run);
}

/** Rebuild the schedule and every byte-range. Preserve all adverse judgments;
 * only explicitly deferred unread-source questions can be settled by a raw
 * stage covering both the original material and every requested source. */
export function completeDesignReviewRun(run: DesignReviewRun): { input: DesignReviewInput; result: DesignReviewResult } {
  if (run.scheduleVersion !== undefined && ![2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(run.scheduleVersion)) throw new DesignReviewError('未知评审调度版本');
  const expected = createDesignReviewRun(run.input, run.createdAt, run.scheduleVersion ?? 1);
  if ((run.scheduleVersion ?? 1) >= 5) {
    // Validate the original raw results against canonical coverage before using
    // their citations to derive the only allowed follow-up schedule.
    for (const stage of expected.stages.filter(s => s.kind !== 'synthesis')) {
      const result = run.stages.find(s => s.id === stage.id)?.result;
      if (!result) throw new DesignReviewError('原文覆盖或跨批检查未完成，不得形成整体结论');
      acceptDesignReviewStage(expected, stage, result);
    }
  }
  const plan = (r: DesignReviewRun) => r.stages.map(({ id, kind, unitIds, children, followupFor }) => ({ id, kind, unitIds, children, ...(followupFor ? { followupFor } : {}) }));
  if (JSON.stringify(run.units) !== JSON.stringify(expected.units) || JSON.stringify(plan(run)) !== JSON.stringify(plan(expected)) || !run.stages.length || run.stages.some(s => !s.result)) throw new DesignReviewError('原文覆盖或跨批检查未完成，不得形成整体结论');
  for (const stage of run.stages) validateDesignReview(designReviewStageInput(run, stage), stage.result!);
  const rank = { pass: 0, insufficient: 1, revise: 2 };
  const resolutions = (run.scheduleVersion ?? 1) >= 3 ? resolvedDeferrals(run) : [];
  const resolved = new Set(resolutions.map(r => r.checkId));
  const root = run.stages.at(-1)!.result!;
  const checks = Object.keys(run.input.rubric).map(criterion => {
    let selected = root.checks.find(c => c.criterion === criterion)!;
    for (const stage of run.stages) {
      const check = stage.result!.checks.find(c => c.criterion === criterion);
      if (!check) continue; // Dedicated follow-ups evaluate only their original criterion.
      if (check.awaitingSources && resolved.has(`${stage.id}/${criterion}`)) continue;
      if (rank[check.verdict] > rank[selected.verdict]) selected = check;
    }
    // Scoped dispositions stay in the immutable stages and resolution ledger;
    // final checks are again judgments about the complete input.
    const { awaitingSources, resolves, ...finalCheck } = structuredClone(selected);
    return finalCheck;
  });
  const input = { ...run.input, sources: [...designReviewUnitSources(run), ...run.stages.filter(s => s.result).map(s => resultSource(run, s)), ...((run.scheduleVersion ?? 1) >= 3 ? deferrals(run).map(p => p.question) : [])] };
  const blocked = checks.some(c => c.verdict !== 'pass');
  const result = { summary: blocked ? '全部批次已完成，但仍有返修或材料不足项；详见逐项结论。' : root.summary, checks, ...(resolutions.length ? { resolvedDeferrals: resolutions } : {}) };
  validateDesignReview(input, result);
  return { input, result };
}
