import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { acceptDesignReviewStage, completeDesignReviewRun, createDesignReviewRun, designReviewStageInput } from '../novel-service-core/src/design-review-run.ts';
import { designReviewInput, designReviewOverview } from '../novel-service-core/src/design-review.ts';
import { JsonDesignPlanner } from '../packages/planner/src/index.ts';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Persistence omits undefined optional fields; compare their JSON meaning.
const canonical = value => JSON.parse(JSON.stringify(value));
const reviewRuntime = { createDesignReviewRun, acceptDesignReviewStage, designReviewStageInput, JsonDesignPlanner };
function same(actual, expected, message) {
  if (!isDeepStrictEqual(canonical(actual), canonical(expected))) throw new Error(message);
}

/** Validate saved progress against independently supplied design materials.
 * A valid prefix is not a final report. Failed responses and pending stages
 * remain history; only accepted results participate in the reconstructed prefix. */
export function auditDesignReviewPrefix(run, expectedInput, runtime = reviewRuntime) {
  same(run.input, expectedInput, 'Run materials or rubric differ from the selected design');
  if (run.scheduleVersion !== undefined && (!Number.isInteger(run.scheduleVersion) || run.scheduleVersion < 2)) {
    throw new Error('Unknown persisted review schedule version');
  }
  const before = hash(run);
  const rebuilt = runtime.createDesignReviewRun(expectedInput, run.createdAt, run.scheduleVersion ?? 1);
  same(run.units, rebuilt.units, 'Saved progress has different original byte ranges');
  const stagePlan = ({ id, kind, unitIds, children, followupFor }) => ({ id, kind, unitIds, children, ...(followupFor ? { followupFor } : {}) });
  let pending = false, completedStages = 0;
  for (const [index, stored] of run.stages.entries()) {
    if (!stored.result) { pending = true; continue; }
    if (pending) throw new Error('Saved progress skips an unfinished stage');
    const expected = rebuilt.stages[index];
    if (!expected) throw new Error('Saved progress contains an unexpected completed stage');
    same(stagePlan(stored), stagePlan(expected), 'Saved progress differs from the canonical review schedule');
    runtime.acceptDesignReviewStage(rebuilt, expected, stored.result);
    completedStages++;
  }
  // Accepting the final raw batch may add required followups and rebuild the
  // synthesis tree. Compare that derived tail too, even before it is executed.
  same(run.stages.map(stagePlan), rebuilt.stages.map(stagePlan), 'Saved pending stages differ from the reconstructed review schedule');
  if (hash(run) !== before) throw new Error('Progress reconstruction changed the original run');
  return { verification: 'verified', completedStages, totalStages: run.stages.length,
    runSha256: before, formalAcceptance: false,
    limitation: 'Validates saved stage results, citations and pending schedule against the supplied input; does not replay raw model responses or approve incomplete work.' };
}

/** Offline response replay, including repair responses, on the rebuilt schedule.
 * Only saved strings can reach the planner; this function has no model transport.
 * An intact prefix is evidence integrity, never a semantic acceptance decision. */
export async function replayDesignReviewPrefix(run, expectedInput, runtime = reviewRuntime) {
  const prefix = auditDesignReviewPrefix(run, expectedInput, runtime), before = hash(run);
  const rebuilt = runtime.createDesignReviewRun(expectedInput, run.createdAt, run.scheduleVersion ?? 1);
  const records = [];
  for (const stage of run.stages) {
    if (!stage.result) break;
    const next = rebuilt.stages.find(s => !s.result);
    if (!next || next.id !== stage.id) throw new Error('Response replay differs from the canonical schedule');
    if (!Array.isArray(stage.modelResponses) || !stage.modelResponses.length || stage.modelResponses.some(r => typeof r !== 'string')) {
      throw new Error(`Missing original model responses: ${stage.id}`);
    }
    const input = runtime.designReviewStageInput(rebuilt, next);
    same(input, runtime.designReviewStageInput(run, stage), 'Replayed stage material differs from saved material');
    let calls = 0;
    const planner = new runtime.JsonDesignPlanner({ complete: async () => {
      if (calls >= stage.modelResponses.length) throw new Error(`Saved responses exhausted: ${stage.id}`);
      return stage.modelResponses[calls++];
    } });
    const { modelResponses, ...result } = await planner.reviewDesignContent(input);
    if (calls !== stage.modelResponses.length) throw new Error(`Unused saved responses: ${stage.id}`);
    same(modelResponses, stage.modelResponses, 'Replay changed the original response sequence');
    same(result, stage.result, 'Saved conclusions differ from original model responses');
    runtime.acceptDesignReviewStage(rebuilt, next, result);
    records.push({ stageId: stage.id, kind: stage.kind, stageSha256: hash(stage), inputSha256: hash(input),
      responsesReplayed: calls, checks: result.checks.map(({ criterion, verdict, awaitingSources, resolves }) =>
        ({ criterion, verdict, ...(awaitingSources ? { awaitingSources } : {}), ...(resolves ? { resolves } : {}) })) });
  }
  if (hash(run) !== before) throw new Error('Response replay changed the original run');
  return { ...prefix, responseReplay: 'verified', responsesReplayed: records.reduce((sum, r) => sum + r.responsesReplayed, 0), records,
    failures: run.stages.flatMap(stage => (stage.failures ?? []).map(failure => ({ stageId: stage.id, failureSha256: hash(failure) }))),
    modelCalls: 0, formalAcceptance: false,
    limitation: 'Replays saved responses, repairs, citations and conclusions against independently supplied materials. Pending work, semantic quality, blocker disposition and prose acceptance remain separate.' };
}

/** Check one persisted task against independent original materials and its
 * complete report, including provenance and status. Never infer acceptance
 * from a report label or a caller-supplied input hash alone. */
export async function replayDesignReviewRecord(run, expectedInput, report, runtime = { ...reviewRuntime, completeDesignReviewRun }) {
  const prefix = await replayDesignReviewPrefix(run, expectedInput, runtime);
  if (run.status !== 'completed') {
    if (report || run.reportId) throw new Error('Incomplete review must not have a final report');
    return { ...prefix, reportVerification: 'not_completed' };
  }
  if (!report || run.reportId !== report.id || report.runId !== run.id) throw new Error('Report and completed run are not mutually linked');
  const rebuilt = runtime.completeDesignReviewRun(run);
  const { id, area, inputHash, scope, sources, status, createdAt, runId, ...result } = report;
  same({ area, inputHash, scope }, { area: expectedInput.area, inputHash: expectedInput.inputHash, scope: expectedInput.scope }, 'Report design binding differs from original materials');
  same(sources, rebuilt.input.sources, 'Report source envelope differs from reconstructed evidence');
  same(result, rebuilt.result, 'Report conclusions differ from reconstructed batch findings');
  const expectedStatus = rebuilt.result.checks.some(check => check.verdict === 'revise') ? 'needs_revision'
    : rebuilt.result.checks.some(check => check.verdict === 'insufficient') ? 'inconclusive' : 'passed';
  if (status !== expectedStatus) throw new Error('Report status contradicts reconstructed findings');
  return { ...prefix, reportVerification: 'verified', reportSha256: hash(report), reportStatus: status };
}

/** Read-only integrity audit, not a second model opinion or approval action.
 * Only the latest review for each area of the explicitly selected plan counts.
 * Rebuild every completed batch and citation before trusting its final report. */
export function auditDesignReviews(work, planId) {
  if (!work.plans.has(planId)) throw new Error('Selected plan does not exist');
  const overview = designReviewOverview(work, planId);
  if (!overview.inputHash) throw new Error('Selected plan cannot be reviewed against the current design');
  const areas = overview.areas.map(area => {
    const run = [...work.designReviewRuns.values()].findLast(run => run.input.area === area.area && run.input.inputHash === overview.inputHash);
    const report = work.designContentReviews.get(area.reportId);
    const row = {
      area: area.area, status: area.status, runId: run?.id, reportId: report?.id,
      completedStages: run?.stages.filter(stage => stage.result).length ?? 0,
      totalStages: run?.stages.length ?? 0,
      retainedFailures: run?.stages.reduce((sum, stage) => sum + (stage.failures?.length ?? 0), 0) ?? 0,
    };
    if (run && run.status !== 'completed') {
      try {
        return { ...row, verification: 'not_completed', progress: auditDesignReviewPrefix(run, designReviewInput(work, area.area, planId)) };
      } catch (error) {
        return { ...row, verification: 'invalid', error: error instanceof Error ? error.message : String(error) };
      }
    }
    if (!report || report.inputHash !== overview.inputHash) return { ...row, verification: 'missing' };
    if (!run) return { ...row, verification: 'unverifiable', error: 'No completed batch run; a report label alone is insufficient' };
    try {
      if (run.reportId !== report.id || report.runId !== run.id) throw new Error('Report and completed run are not mutually linked');
      same(run.input, designReviewInput(work, area.area, planId), 'Run materials or rubric differ from the selected design');
      const before = hash(run);
      const rebuilt = completeDesignReviewRun(run);
      if (hash(run) !== before) throw new Error('Reconstruction changed the original run');
      const { id, area: reportArea, inputHash, scope, sources, status, createdAt, runId, ...result } = report;
      same({ area: reportArea, inputHash, scope }, { area: run.input.area, inputHash: run.input.inputHash, scope: run.input.scope }, 'Report design binding differs from its run');
      same(sources, rebuilt.input.sources, 'Report source envelope differs from reconstructed evidence');
      same(result, rebuilt.result, 'Report conclusions differ from reconstructed batch findings');
      const expectedStatus = rebuilt.result.checks.some(check => check.verdict === 'revise') ? 'needs_revision'
        : rebuilt.result.checks.some(check => check.verdict === 'insufficient') ? 'inconclusive' : 'passed';
      if (status !== expectedStatus) throw new Error('Report status contradicts reconstructed findings');
      return { ...row, verification: 'verified', runSha256: before, reportSha256: hash(report),
        sourceEnvelopeSha256: hash(sources), checks: result.checks.map(({ criterion, verdict }) => ({ criterion, verdict })),
        resolvedDeferrals: result.resolvedDeferrals ?? [] };
    } catch (error) {
      return { ...row, verification: 'invalid', error: error instanceof Error ? error.message : String(error) };
    }
  });
  return {
    observedAt: new Date().toISOString(), workId: work.id, planId,
    planRevision: work.plans.get(planId).revision, inputHash: overview.inputHash,
    status: areas.some(area => area.verification === 'invalid') ? 'invalid'
      : areas.every(area => area.verification === 'verified' && area.status === 'passed') ? 'verified_design_pass' : 'not_accepted',
    limitation: 'Verifies saved evidence and report integrity only; does not approve the plan, resolve blockers, or validate prose quality.',
    areas,
  };
}

async function main() {
  const { values } = parseArgs({ options: { 'work-id': { type: 'string' }, 'plan-id': { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('DATABASE_URL=... node --experimental-strip-types scripts/audit-design-reviews.mjs --work-id ID --plan-id ID [--output FILE]\nRead-only. Exit 0: verified design pass; 2: incomplete/unaccepted; 1: invalid evidence or execution error.');
    return;
  }
  if (!values['work-id'] || !values['plan-id'] || !process.env.DATABASE_URL) throw new Error('Explicit DATABASE_URL, --work-id and --plan-id are required');
  // Import persistence only for the CLI, not for pure fixture tests. One short
  // read transaction prevents mixing versions while a reviewer is committing.
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaWorkRepository } = await import('../packages/persistence/src/prisma-repository.ts');
  const prisma = new PrismaClient();
  try {
    const work = await prisma.$transaction(tx => new PrismaWorkRepository(tx).get(values['work-id']), { timeout: 30_000 });
    if (!work) throw new Error('Work does not exist');
    const audit = auditDesignReviews(work, values['plan-id']);
    const json = JSON.stringify(audit, null, 2) + '\n';
    if (values.output) await writeFile(values.output, json, { flag: 'wx' });
    console.log(json);
    process.exitCode = audit.status === 'verified_design_pass' ? 0 : audit.status === 'invalid' ? 1 : 2;
  } finally { await prisma.$disconnect(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
