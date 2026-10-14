import test from 'node:test';
import assert from 'node:assert/strict';
import { Work } from '../novel-service-core/src/core.ts';
import { createPlanRevision } from '../novel-service-core/src/planning.ts';
import { createDesignReviewRun, acceptDesignReviewStage, designReviewStageInput, completeDesignReviewRun } from '../novel-service-core/src/design-review-run.ts';
import { designReviewAreas, designReviewInput, recordDesignReview } from '../novel-service-core/src/design-review.ts';
import { minimalWorldPack, minimalStoryBible, minimalPlan, fixtureDesignReview } from '../packages/application/test/fixtures.ts';
import { auditDesignReviews } from './audit-design-reviews.mjs';

function finish(work, planId, area, verdict = 'pass') {
  const run = createDesignReviewRun(designReviewInput(work, area, planId));
  for (const stage of run.stages) {
    const input = designReviewStageInput(run, stage), result = fixtureDesignReview(input);
    if (verdict === 'revise') result.checks[0] = { ...result.checks[0], verdict, revisionAdvice: '补足来源' };
    acceptDesignReviewStage(run, stage, result);
  }
  const rebuilt = completeDesignReviewRun(run), report = recordDesignReview(work, rebuilt.input, rebuilt.result);
  report.runId = run.id; run.reportId = report.id; run.status = 'completed';
  work.designReviewRuns.set(run.id, run);
  return { run, report };
}
function fixture() {
  const work = new Work('只读验收夹具');
  work.worldPack = minimalWorldPack(); work.storyBible = minimalStoryBible(work.worldPack);
  const plan = createPlanRevision(work, minimalPlan(), { source: 'author' });
  const reviews = Object.fromEntries(designReviewAreas.map(area => [area, finish(work, plan.id, area)]));
  return { work, planId: plan.id, reviews };
}
const snapshot = work => JSON.stringify(work, (_, value) => value instanceof Map ? [...value] : value);
const audit = ({ work, planId }) => auditDesignReviews(work, planId);

test('reconstructs saved reports without changing plan, evidence, failures or history', () => {
  const f = fixture();
  f.reviews.world.run.stages[0].failures = [{ at: '2026-10-15T00:00:00Z', error: 'connection failed' }];
  // Match persisted JSON, including absent optional fields.
  for (const [id, run] of f.work.designReviewRuns) f.work.designReviewRuns.set(id, JSON.parse(JSON.stringify(run)));
  const before = snapshot(f.work), result = audit(f);
  assert.equal(result.status, 'verified_design_pass');
  assert.equal(result.areas[0].retainedFailures, 1);
  assert.ok(result.areas.every(area => area.verification === 'verified'));
  assert.equal(f.work.plans.get(f.planId).status, 'proposed');
  assert.equal(snapshot(f.work), before);
});

test('does not accept old passes while a newer review is incomplete', () => {
  const f = fixture(), run = createDesignReviewRun(designReviewInput(f.work, 'world', f.planId));
  run.status = 'failed'; f.work.designReviewRuns.set(run.id, run);
  const result = audit(f);
  assert.equal(result.status, 'not_accepted');
  assert.equal(result.areas[0].verification, 'not_completed');
  assert.equal(result.areas[0].status, 'interrupted');
});

test('a verified negative report is evidence of needed revision, not acceptance', () => {
  const f = fixture(); finish(f.work, f.planId, 'world', 'revise');
  const result = audit(f);
  assert.equal(result.status, 'not_accepted');
  assert.equal(result.areas[0].verification, 'verified');
  assert.equal(result.areas[0].status, 'needs_revision');
});

test('changed design makes saved reports outdated even if their pass labels remain', () => {
  const f = fixture(); f.work.worldPack.summary += '新规则';
  const result = audit(f);
  assert.equal(result.status, 'not_accepted');
  assert.ok(result.areas.every(area => area.status === 'outdated' && area.verification === 'missing'));
});

for (const [name, corrupt] of [
  ['missing raw stage', ({ run }) => { run.stages.splice(0, 1); }],
  ['fabricated original citation', ({ run }) => { run.stages[0].result.checks[0].evidence[0].quote = '不存在的原文证据XYZ'; }],
  ['substituted original materials with unchanged input hash', ({ run }) => { run.input.sources[0].text += '伪造材料'; }],
  ['rewritten report conclusion', ({ report }) => { report.checks[0].explanation = '已重写'; }],
  ['rewritten report source envelope', ({ report }) => { report.sources[0].text += '改写'; }],
  ['incorrect report scope', ({ report }) => { report.scope.planRevision++; }],
  ['incorrect report status', ({ report }) => { report.status = 'needs_revision'; }],
  ['foreign run link', ({ report }) => { report.runId = 'another-run'; }],
]) {
  test(`rejects ${name}`, () => {
    const f = fixture(); corrupt(f.reviews.world);
    const before = snapshot(f.work), result = audit(f);
    assert.equal(result.status, 'invalid');
    assert.equal(result.areas[0].verification, 'invalid');
    assert.equal(snapshot(f.work), before);
  });
}

test('legacy reports without batch evidence cannot receive reconstructed acceptance', () => {
  const f = fixture(); f.work.designReviewRuns.clear();
  assert.equal(audit(f).status, 'not_accepted');
  assert.ok(audit(f).areas.every(area => area.verification === 'unverifiable'));
});

test('requires an explicit existing, reviewable plan', () => {
  const f = fixture();
  assert.throws(() => auditDesignReviews(f.work, 'missing'), /does not exist/);
  f.work.plans.get(f.planId).status = 'superseded';
  assert.throws(() => audit(f), /cannot be reviewed/);
});
