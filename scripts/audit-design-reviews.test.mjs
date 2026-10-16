import test from 'node:test';
import assert from 'node:assert/strict';
import { Work } from '../novel-service-core/src/core.ts';
import { createPlanRevision } from '../novel-service-core/src/planning.ts';
import { createDesignReviewRun, acceptDesignReviewStage, designReviewStageInput, completeDesignReviewRun } from '../novel-service-core/src/design-review-run.ts';
import { designReviewAreas, designReviewInput, recordDesignReview } from '../novel-service-core/src/design-review.ts';
import { minimalWorldPack, minimalStoryBible, minimalPlan, fixtureDesignReview } from '../packages/application/test/fixtures.ts';
import { auditDesignReviews, auditDesignReviewPrefix, replayDesignReviewPrefix, replayDesignReviewRecord } from './audit-design-reviews.mjs';
import { prepareDesignReviewEvidence } from '../packages/planner/src/design-review-evidence.ts';
import { JsonDesignPlanner } from '../packages/planner/src/index.ts';

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
  assert.equal(result.areas[0].progress.verification, 'verified');
  assert.equal(result.areas[0].progress.formalAcceptance, false);
});

function partialFixture() {
  const f = fixture();
  const input = designReviewInput(f.work, 'story', f.planId);
  input.sources.push(...['a', 'b', 'c'].map(id => ({ id: `test/${id}`, text: `${id}原文依据`.repeat(18_000) })));
  const run = createDesignReviewRun(input);
  assert.ok(run.stages.length > 1);
  const first = run.stages[0];
  acceptDesignReviewStage(run, first, fixtureDesignReview(designReviewStageInput(run, first)));
  run.stages[1].failures = [{ at: '2026-10-16T00:00:00Z', error: 'interrupted response', modelResponses: ['not valid JSON'] }];
  run.status = 'failed';
  return { run, input };
}

test('validates a partial accepted prefix while preserving failed responses and pending work', () => {
  const { run, input } = partialFixture(), before = JSON.stringify(run);
  const result = auditDesignReviewPrefix(run, input);
  assert.equal(result.verification, 'verified');
  assert.equal(result.completedStages, 1);
  assert.equal(result.formalAcceptance, false);
  assert.equal(JSON.stringify(run), before);
});

async function responseFixture() {
  const { input } = partialFixture(), run = createDesignReviewRun(input), stage = run.stages[0];
  const request = designReviewStageInput(run, stage), prepared = prepareDesignReviewEvidence(request);
  const output = { ...fixtureDesignReview(request), requestId: prepared.requestId };
  output.checks = output.checks.map(check => ({ ...check, evidence: [{ fragmentId: prepared.sources[0].fragments[0].id }] }));
  Object.assign(output.checks[0], { verdict: 'revise', revisionAdvice: '保留原始返修结论' });
  const responses = [JSON.stringify({ ...output, checks: output.checks.slice(1) }), JSON.stringify(output)];
  let calls = 0;
  const { modelResponses, ...result } = await new JsonDesignPlanner({ complete: async () => responses[calls++] }).reviewDesignContent(request);
  acceptDesignReviewStage(run, stage, result); stage.modelResponses = modelResponses;
  run.stages[1].failures = [{ at: '2026-10-16T00:00:00Z', error: 'transport interrupted', modelResponses: ['unfinished'] }];
  return { run, input };
}

test('offline replay retains repairs, negative verdicts and pending failures without making model calls', async () => {
  const { run, input } = await responseFixture(), before = JSON.stringify(run);
  const result = await replayDesignReviewPrefix(run, input);
  assert.equal(result.responsesReplayed, 2);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].checks[0].verdict, 'revise');
  assert.equal(result.failures.length, 1);
  assert.equal(result.modelCalls, 0);
  assert.equal(result.formalAcceptance, false);
  assert.equal(JSON.stringify(run), before);
});

async function completedResponseFixture() {
  const { work, planId } = fixture();
  const input = designReviewInput(work, 'world', planId), run = createDesignReviewRun(input);
  assert.equal(run.stages.length, 1);
  const stage = run.stages[0], request = designReviewStageInput(run, stage);
  const prepared = prepareDesignReviewEvidence(request), output = { ...fixtureDesignReview(request), requestId: prepared.requestId };
  output.checks = output.checks.map(check => ({ ...check, evidence: [{ fragmentId: prepared.sources[0].fragments[0].id }] }));
  Object.assign(output.checks[0], { verdict: 'revise', revisionAdvice: '保留返修结论，不能改成通过标签' });
  const { modelResponses, ...result } = await new JsonDesignPlanner({ complete: async () => JSON.stringify(output) }).reviewDesignContent(request);
  acceptDesignReviewStage(run, stage, result); stage.modelResponses = modelResponses;
  const rebuilt = completeDesignReviewRun(run), report = recordDesignReview(work, rebuilt.input, rebuilt.result);
  report.runId = run.id; run.reportId = report.id; run.status = 'completed';
  return { input, run, report };
}

test('record replay validates a full negative report without approving or changing it', async () => {
  const f = await completedResponseFixture(), before = JSON.stringify(f);
  const result = await replayDesignReviewRecord(f.run, f.input, f.report);
  assert.equal(result.reportVerification, 'verified');
  assert.equal(result.reportStatus, 'needs_revision');
  assert.equal(result.formalAcceptance, false);
  assert.equal(result.modelCalls, 0);
  assert.equal(JSON.stringify(f), before);
});

for (const [name, corrupt, message] of [
  ['substituted source with unchanged hash', f => { f.run.input.sources[0].text += '替换的原文'; }, /materials or rubric/],
  ['changed scope', f => { f.report.scope.planRevision++; }, /binding/],
  ['changed input hash', f => { f.report.inputHash = 'foreign'; }, /binding/],
  ['false pass label', f => { f.report.status = 'passed'; }, /status contradicts/],
  ['foreign run link', f => { f.report.runId = 'foreign'; }, /mutually linked/],
  ['changed resolution metadata', f => { f.report.resolvedDeferrals = [{ checkId: 'fake', resolvedByStageId: 'fake' }]; }, /conclusions/],
  ['unexpected report property', f => { f.report.unverifiedApproval = true; }, /conclusions/],
  ['unused extra response', f => { f.run.stages[0].modelResponses.push('{}'); }, /Unused saved responses/],
]) test(`record replay rejects ${name} without rewriting evidence`, async () => {
  const f = await completedResponseFixture(); corrupt(f);
  const before = JSON.stringify(f);
  await assert.rejects(() => replayDesignReviewRecord(f.run, f.input, f.report), message);
  assert.equal(JSON.stringify(f), before);
});

test('record replay keeps partial work incomplete and rejects an attached final report', async () => {
  const { run, input } = await responseFixture();
  assert.equal((await replayDesignReviewRecord(run, input)).reportVerification, 'not_completed');
  await assert.rejects(() => replayDesignReviewRecord(run, input, { id: 'unexpected' }), /Incomplete review/);
  run.reportId = 'unexpected';
  await assert.rejects(() => replayDesignReviewRecord(run, input), /Incomplete review/);
});

for (const [name, corrupt] of [
  ['missing original responses', stage => { delete stage.modelResponses; }],
  ['changed original response', stage => { stage.modelResponses[1] = '{}'; }],
  ['unused extra response', stage => { stage.modelResponses.push(stage.modelResponses[1]); }],
  ['rewritten accepted explanation', stage => { stage.result.checks[0].explanation = '重写后仍是合法格式'; }],
  ['removed initial repair response', stage => { stage.modelResponses.shift(); stage.modelResponses.push('{}'); }],
]) test(`offline replay rejects ${name}`, async () => {
  const { run, input } = await responseFixture(); corrupt(run.stages[0]);
  const before = JSON.stringify(run);
  await assert.rejects(() => replayDesignReviewPrefix(run, input));
  assert.equal(JSON.stringify(run), before);
});

for (const [name, corrupt] of [
  ['fabricated accepted citation', run => { run.stages[0].result.checks[0].evidence[0].quote = '并不存在的引文XYZ'; }],
  ['skipped unfinished step', run => { run.stages[2].result = structuredClone(run.stages[0].result); }],
  ['altered source range', run => { run.units[0].end--; }],
  ['deleted pending stage', run => { run.stages.pop(); }],
  ['altered pending stage', run => { run.stages.at(-1).children = []; }],
  ['substituted input', run => { run.input.sources[0].text += '改写'; }],
  ['explicit legacy version', run => { run.scheduleVersion = 1; }],
  ['null schedule version', run => { run.scheduleVersion = null; }],
  ['unsupported schedule version', run => { run.scheduleVersion = 999; }],
]) {
  test(`partial progress rejects ${name} without modifying evidence`, () => {
    const { run, input } = partialFixture(); corrupt(run);
    const before = JSON.stringify(run);
    assert.throws(() => auditDesignReviewPrefix(run, input));
    assert.equal(JSON.stringify(run), before);
  });
}

test('reconstructs dynamically required followups before validating the pending tail', () => {
  const { input } = partialFixture(), run = createDesignReviewRun(input);
  const first = run.stages[0], request = designReviewStageInput(run, first);
  const missing = input.sources.find(s => !request.stage.sourceMap.some(m => m.sourceId === s.id));
  assert.ok(missing);
  const result = fixtureDesignReview(request);
  result.checks[0] = { ...result.checks[0], verdict: 'insufficient', revisionAdvice: '核对待补原文与已给安排', awaitingSources: [missing.id] };
  acceptDesignReviewStage(run, first, result);
  for (const stage of [...run.stages].filter(s => s.kind !== 'synthesis' && !s.result)) {
    acceptDesignReviewStage(run, stage, fixtureDesignReview(designReviewStageInput(run, stage)));
  }
  assert.ok(run.stages.some(s => s.followupFor));
  assert.equal(auditDesignReviewPrefix(run, input).verification, 'verified');
  const modified = structuredClone(run);
  modified.stages = modified.stages.filter(s => !s.followupFor);
  assert.throws(() => auditDesignReviewPrefix(modified, input), /pending stages/);
});

test('a running label cannot conceal corrupt saved evidence from the overall audit', () => {
  const f = fixture(), { run } = f.reviews.world;
  run.status = 'running';
  run.stages[0].result.checks[0].evidence[0].quote = '不存在的原文证据XYZ';
  const before = snapshot(f.work), result = audit(f);
  assert.equal(result.status, 'invalid');
  assert.equal(result.areas[0].verification, 'invalid');
  assert.equal(snapshot(f.work), before);
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
