import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { acceptDesignReviewStage, completeDesignReviewRun, createDesignReviewRun } from '../novel-service-core/src/design-review-run.ts';
import { designReviewInput, designReviewOverview } from '../novel-service-core/src/design-review.ts';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Persistence omits undefined optional fields; compare their JSON meaning.
const canonical = value => JSON.parse(JSON.stringify(value));
function same(actual, expected, message) {
  if (!isDeepStrictEqual(canonical(actual), canonical(expected))) throw new Error(message);
}

/** Validate saved progress against independently supplied design materials.
 * A valid prefix is not a final report. Failed responses and pending stages
 * remain history; only accepted results participate in the reconstructed prefix. */
export function auditDesignReviewPrefix(run, expectedInput) {
  same(run.input, expectedInput, 'Run materials or rubric differ from the selected design');
  if (run.scheduleVersion !== undefined && (!Number.isInteger(run.scheduleVersion) || run.scheduleVersion < 2)) {
    throw new Error('Unknown persisted review schedule version');
  }
  const before = hash(run);
  const rebuilt = createDesignReviewRun(expectedInput, run.createdAt, run.scheduleVersion ?? 1);
  same(run.units, rebuilt.units, 'Saved progress has different original byte ranges');
  const stagePlan = ({ id, kind, unitIds, children, followupFor }) => ({ id, kind, unitIds, children, ...(followupFor ? { followupFor } : {}) });
  let pending = false, completedStages = 0;
  for (const [index, stored] of run.stages.entries()) {
    if (!stored.result) { pending = true; continue; }
    if (pending) throw new Error('Saved progress skips an unfinished stage');
    const expected = rebuilt.stages[index];
    if (!expected) throw new Error('Saved progress contains an unexpected completed stage');
    same(stagePlan(stored), stagePlan(expected), 'Saved progress differs from the canonical review schedule');
    acceptDesignReviewStage(rebuilt, expected, stored.result);
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
