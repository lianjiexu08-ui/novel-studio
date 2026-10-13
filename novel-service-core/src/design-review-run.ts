import { randomUUID } from 'node:crypto';
import { DesignReviewError, validateDesignReview, type DesignReviewInput, type DesignReviewResult, type DesignReviewSource } from './design-review.ts';

export const designReviewCapacity = 240_000;
const batchCapacity = 100_000;
const resultCapacity = 40_000;
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
export function createDesignReviewRun(input: DesignReviewInput, now = new Date().toISOString()): DesignReviewRun {
  if (new Set(input.sources.map(s => s.id)).size !== input.sources.length) throw new DesignReviewError('评审来源 ID 重复');
  const units: DesignReviewUnit[] = [];
  const stages: DesignReviewStage[] = [];
  const small = JSON.stringify(input.sources).length <= designReviewCapacity;
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
  let pending: DesignReviewUnit[] = [];
  const flush = () => { if (pending.length) stages.push({ id: `batch-${stages.length + 1}`, kind: 'batch', label: `原文批次 ${stages.length + 1}`, unitIds: pending.map(u => u.id), children: [], attempts: 0 }); pending = []; };
  for (const unit of units) {
    if (!small && JSON.stringify([...pending, unit].map(unitSource)).length > batchCapacity) flush();
    pending.push(unit);
  }
  flush();
  const batches = [...stages];
  if (batches.length > 64) throw new DesignReviewError('评审需要超过64个原文批次，请先拆分作品验收阶段；原文未截断，尚未调用模型');
  for (let a = 0; a < batches.length; a++) for (let b = a + 1; b < batches.length; b++) {
    stages.push({ id: `cross-${a + 1}-${b + 1}`, kind: 'cross', label: `跨批检查 ${a + 1} / ${b + 1}`, unitIds: [...batches[a].unitIds, ...batches[b].unitIds], children: [], attempts: 0 });
  }
  let level = stages.map(s => s.id);
  let sequence = 0;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) { next.push(level[i]); continue; }
      const id = `synthesis-${++sequence}`;
      stages.push({ id, kind: 'synthesis', label: `综合检查 ${sequence}`, unitIds: [], children: level.slice(i, i + 2), attempts: 0 }); next.push(id);
    }
    level = next;
  }
  return { id: `design_run_${randomUUID()}`, input: structuredClone(input), units, stages, status: 'ready', createdAt: now, updatedAt: now };
}

export function designReviewUnitSources(run: DesignReviewRun): DesignReviewSource[] {
  return run.units.map(u => ({ id: u.id, text: run.input.sources.find(s => s.id === u.sourceId)!.text.slice(u.start, u.end) }));
}
const resultSource = (stage: DesignReviewStage): DesignReviewSource => ({ id: `review-result/${stage.id}`, text: JSON.stringify(stage.result, null, 2) });
export function designReviewStageInput(run: DesignReviewRun, stage: DesignReviewStage): DesignReviewInput {
  const sources = stage.kind === 'synthesis' ? stage.children.map(id => {
    const child = run.stages.find(s => s.id === id);
    if (!child?.result) throw new DesignReviewError('前置批次尚未完成');
    return resultSource(child);
  }) : designReviewUnitSources(run).filter(s => stage.unitIds.includes(s.id));
  if (JSON.stringify(sources).length > designReviewCapacity) throw new DesignReviewError('本批材料超出单次评审容量；未截断原文');
  return { ...structuredClone(run.input), sources, stage: {
    kind: stage.kind, label: stage.label, totalBatches: run.stages.filter(s => s.kind === 'batch').length,
    sourceMap: run.units.filter(u => stage.unitIds.includes(u.id)),
  } };
}

export function acceptDesignReviewStage(run: DesignReviewRun, stage: DesignReviewStage, result: DesignReviewResult): void {
  const input = designReviewStageInput(run, stage);
  validateDesignReview(input, result);
  if (JSON.stringify(result).length > resultCapacity) throw new DesignReviewError('本批评审结论过长，请重新评审并精炼解释；原文与失败记录保留');
  stage.result = structuredClone(result); stage.error = undefined;
}

/** Rebuild the expected schedule, verify every byte-range, and retain the worst
 * verdict for each criterion even if a later model tries to erase an earlier issue. */
export function completeDesignReviewRun(run: DesignReviewRun): { input: DesignReviewInput; result: DesignReviewResult } {
  const expected = createDesignReviewRun(run.input, run.createdAt);
  const plan = (r: DesignReviewRun) => r.stages.map(({ id, kind, unitIds, children }) => ({ id, kind, unitIds, children }));
  if (JSON.stringify(run.units) !== JSON.stringify(expected.units) || JSON.stringify(plan(run)) !== JSON.stringify(plan(expected)) || !run.stages.length || run.stages.some(s => !s.result)) throw new DesignReviewError('原文覆盖或跨批检查未完成，不得形成整体结论');
  for (const stage of run.stages) validateDesignReview(designReviewStageInput(run, stage), stage.result!);
  const rank = { pass: 0, insufficient: 1, revise: 2 };
  const root = run.stages.at(-1)!.result!;
  const checks = Object.keys(run.input.rubric).map(criterion => {
    let selected = root.checks.find(c => c.criterion === criterion)!;
    for (const stage of run.stages) {
      const check = stage.result!.checks.find(c => c.criterion === criterion)!;
      if (rank[check.verdict] > rank[selected.verdict]) selected = check;
    }
    return structuredClone(selected);
  });
  const input = { ...run.input, sources: [...designReviewUnitSources(run), ...run.stages.filter(s => s.result).map(resultSource)] };
  const blocked = checks.some(c => c.verdict !== 'pass');
  const result = { summary: blocked ? '全部批次已完成，但仍有返修或材料不足项；详见逐项结论。' : root.summary, checks };
  validateDesignReview(input, result);
  return { input, result };
}
