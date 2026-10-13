import { randomUUID } from 'node:crypto';
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
  scheduleVersion?: 2 | 3;
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
export function createDesignReviewRun(input: DesignReviewInput, now = new Date().toISOString(), scheduleVersion: 1 | 2 | 3 = 3): DesignReviewRun {
  if (new Set(input.sources.map(s => s.id)).size !== input.sources.length) throw new DesignReviewError('评审来源 ID 重复');
  const units: DesignReviewUnit[] = [];
  const stages: DesignReviewStage[] = [];
  const small = JSON.stringify(input.sources).length <= designReviewCapacity;
  // Two v3 raw batches plus shared context use at most 220k characters,
  // leaving room for the exact questions a cross check must resolve.
  const ordinaryBatchCapacity = scheduleVersion === 3 ? 90_000 : batchCapacity;
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
  for (const unit of units.filter(u => !sharedIds.has(u.id))) {
    if (!small && JSON.stringify([...pending, unit].map(unitSource)).length > ordinaryBatchCapacity) flush();
    pending.push(unit);
  }
  flush();
  const batches = [...stages];
  if (batches.length > 64) throw new DesignReviewError('评审需要超过64个原文批次，请先拆分作品验收阶段；原文未截断，尚未调用模型');
  for (let a = 0; a < batches.length; a++) for (let b = a + 1; b < batches.length; b++) {
    stages.push({ id: `cross-${a + 1}-${b + 1}`, kind: 'cross', label: `跨批检查 ${a + 1} / ${b + 1}`, unitIds: [...new Set([...batches[a].unitIds, ...batches[b].unitIds])], children: [], attempts: 0 });
  }
  // Keep the real planning horizon visible during synthesis. A prior report
  // saying "all 100 chapters need detailed scenes" is not the source plan.
  const overviewUnits = scheduleVersion === 3 ? units.filter(u => u.sourceId === 'plan/overview') : [];
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
  return { id: `design_run_${randomUUID()}`, ...(scheduleVersion >= 2 ? { scheduleVersion: scheduleVersion as 2 | 3 } : {}), input: structuredClone(input), units, stages, status: 'ready', createdAt: now, updatedAt: now };
}

export function designReviewUnitSources(run: DesignReviewRun): DesignReviewSource[] {
  return run.units.map(u => ({ id: u.id, text: run.input.sources.find(s => s.id === u.sourceId)!.text.slice(u.start, u.end) }));
}
const resultSource = (stage: DesignReviewStage): DesignReviewSource => ({ id: `review-result/${stage.id}`, text: JSON.stringify(stage.result, null, 2) });
function deferrals(run: DesignReviewRun, before = run.stages.length) {
  return run.stages.slice(0, before).flatMap(stage => stage.kind === 'synthesis' ? [] : (stage.result?.checks ?? []).filter(check => check.verdict === 'insufficient' && check.awaitingSources?.length).map(check => ({
    id: `${stage.id}/${check.criterion}`, stage, check,
    question: { id: `review-question/${stage.id}/${check.criterion}`, text: JSON.stringify({ criterion: check.criterion, explanation: check.explanation, revisionAdvice: check.revisionAdvice, awaitingSources: check.awaitingSources }, null, 2) },
  })));
}
function coversDeferral(run: DesignReviewRun, stage: DesignReviewStage, pending: ReturnType<typeof deferrals>[number]) {
  return stage.kind !== 'synthesis' && [...pending.stage.unitIds, ...run.units.filter(u => pending.check.awaitingSources!.includes(u.sourceId)).map(u => u.id)].every(id => stage.unitIds.includes(id));
}
function resolvedDeferrals(run: DesignReviewRun, before = run.stages.length) {
  return deferrals(run, before).flatMap(pending => {
    const resolver = run.stages.slice(run.stages.indexOf(pending.stage) + 1, before).find(stage => coversDeferral(run, stage, pending) && stage.result?.checks.some(check => check.criterion === pending.check.criterion && check.verdict === 'pass' && check.resolves?.includes(pending.id)));
    return resolver ? [{ checkId: pending.id, resolvedByStageId: resolver.id }] : [];
  });
}
export function designReviewStageInput(run: DesignReviewRun, stage: DesignReviewStage): DesignReviewInput {
  const stageIndex = run.stages.findIndex(s => s.id === stage.id);
  if (stageIndex < 0) throw new DesignReviewError('评审步骤不属于本任务');
  const rawSources = designReviewUnitSources(run).filter(s => stage.unitIds.includes(s.id));
  const sources = stage.kind === 'synthesis' ? [...stage.children.map(id => {
    const child = run.stages.find(s => s.id === id);
    if (!child?.result) throw new DesignReviewError('前置批次尚未完成');
    return resultSource(child);
  }), ...rawSources] : rawSources;
  if (JSON.stringify(sources).length > designReviewCapacity) throw new DesignReviewError('本批材料超出单次评审容量；未截断原文');
  const coverage: NonNullable<DesignReviewInput['stage']>['coverage'] = run.scheduleVersion === 3 ? {
    mode: stage.kind === 'synthesis' ? 'reports_with_context' : run.units.every(u => stage.unitIds.includes(u.id)) ? 'whole_input' : 'local_sources',
    sourceLengths: Object.fromEntries(run.input.sources.map(s => [s.id, s.text.length])),
  } : undefined;
  if (coverage && stage.kind !== 'synthesis') {
    const pendingChecks: NonNullable<typeof coverage.pendingChecks> = [];
    for (const pending of deferrals(run, stageIndex)) {
      if (!coversDeferral(run, stage, pending)) continue;
      // Do not remove raw material to squeeze in a question. If it cannot fit,
      // this stage cannot authorize a resolution; the unresolved item blocks.
      if (JSON.stringify([...sources, pending.question]).length > designReviewCapacity) continue;
      sources.push(pending.question);
      pendingChecks.push({ id: pending.id, criterion: pending.check.criterion, questionSourceId: pending.question.id, requiredSourceIds: pending.check.awaitingSources!, priorUnitIds: pending.stage.unitIds });
    }
    if (pendingChecks.length) coverage.pendingChecks = pendingChecks;
  }
  if (coverage && stage.kind === 'synthesis') coverage.resolvedDeferrals = resolvedDeferrals(run, stageIndex);
  if (coverage && JSON.stringify(coverage).length > sharedContextCapacity) throw new DesignReviewError('评审范围目录与补读元数据超过容量，请拆分作品验收阶段；目录未截断');
  return { ...structuredClone(run.input), sources, stage: {
    kind: stage.kind, label: stage.label, totalBatches: run.stages.filter(s => s.kind === 'batch').length,
    sourceMap: run.units.filter(u => stage.unitIds.includes(u.id)),
    ...(coverage ? { coverage } : {}),
  } };
}

export function acceptDesignReviewStage(run: DesignReviewRun, stage: DesignReviewStage, result: DesignReviewResult): void {
  const input = designReviewStageInput(run, stage);
  validateDesignReview(input, result);
  const tooLarge = run.scheduleVersion === 3
    ? JSON.stringify([resultSource({ ...stage, result })]).length > scopedResultSourceCapacity
    : JSON.stringify(result).length > resultCapacity;
  if (tooLarge) throw new DesignReviewError('本批评审结论过长，请重新评审并精炼解释；原文与失败记录保留');
  stage.result = structuredClone(result); stage.error = undefined;
}

/** Rebuild the schedule and every byte-range. Preserve all adverse judgments;
 * only explicitly deferred unread-source questions can be settled by a raw
 * stage covering both the original material and every requested source. */
export function completeDesignReviewRun(run: DesignReviewRun): { input: DesignReviewInput; result: DesignReviewResult } {
  if (run.scheduleVersion !== undefined && run.scheduleVersion !== 2 && run.scheduleVersion !== 3) throw new DesignReviewError('未知评审调度版本');
  const expected = createDesignReviewRun(run.input, run.createdAt, run.scheduleVersion ?? 1);
  const plan = (r: DesignReviewRun) => r.stages.map(({ id, kind, unitIds, children }) => ({ id, kind, unitIds, children }));
  if (JSON.stringify(run.units) !== JSON.stringify(expected.units) || JSON.stringify(plan(run)) !== JSON.stringify(plan(expected)) || !run.stages.length || run.stages.some(s => !s.result)) throw new DesignReviewError('原文覆盖或跨批检查未完成，不得形成整体结论');
  for (const stage of run.stages) validateDesignReview(designReviewStageInput(run, stage), stage.result!);
  const rank = { pass: 0, insufficient: 1, revise: 2 };
  const resolutions = run.scheduleVersion === 3 ? resolvedDeferrals(run) : [];
  const resolved = new Set(resolutions.map(r => r.checkId));
  const root = run.stages.at(-1)!.result!;
  const checks = Object.keys(run.input.rubric).map(criterion => {
    let selected = root.checks.find(c => c.criterion === criterion)!;
    for (const stage of run.stages) {
      const check = stage.result!.checks.find(c => c.criterion === criterion)!;
      if (check.awaitingSources && resolved.has(`${stage.id}/${criterion}`)) continue;
      if (rank[check.verdict] > rank[selected.verdict]) selected = check;
    }
    // Scoped dispositions stay in the immutable stages and resolution ledger;
    // final checks are again judgments about the complete input.
    const { awaitingSources, resolves, ...finalCheck } = structuredClone(selected);
    return finalCheck;
  });
  const input = { ...run.input, sources: [...designReviewUnitSources(run), ...run.stages.filter(s => s.result).map(resultSource), ...(run.scheduleVersion === 3 ? deferrals(run).map(p => p.question) : [])] };
  const blocked = checks.some(c => c.verdict !== 'pass');
  const result = { summary: blocked ? '全部批次已完成，但仍有返修或材料不足项；详见逐项结论。' : root.summary, checks, ...(resolutions.length ? { resolvedDeferrals: resolutions } : {}) };
  validateDesignReview(input, result);
  return { input, result };
}
