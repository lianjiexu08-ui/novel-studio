// Record a read-only UI/API observation for the v78 proposed design.
// This script never calls a mutating endpoint and never starts a model run.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:8788';
const workId = 'work_8b6c9133e13d404083ca33acc63f4f61';
const planId = 'plan_a5fff5fb0e5a4dcfb63912107924c2fa';
const get = async path => {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200, `${path} returned ${response.status}`);
  return response.json();
};
const [design, plans, reviews] = await Promise.all([
  get(`/works/${workId}/design`),
  get(`/works/${workId}/plans`),
  get(`/works/${workId}/design/content-reviews?planId=${planId}&view=summary`),
]);
const latest = plans.latest;
assert.ok(latest);
assert.equal(latest.id, planId);
assert.equal(design.worldPack.revision, 41);
assert.equal(design.storyBible.revision, 74);
assert.equal(latest.revision, 78);
assert.equal(latest.status, 'proposed');
assert.equal(plans.active.revision, 10);
assert.equal(reviews.selectedPlan.id, planId);
assert.equal(reviews.selectedPlan.status, 'proposed');
assert.equal(reviews.ready, false);
assert.deepEqual(reviews.areas.map(item => item.status), ['outdated', 'outdated', 'outdated', 'outdated']);

const evidence = {
  verified: true,
  observedAt: new Date().toISOString(),
  url: `http://127.0.0.1:5180/#/works/${workId}/design`,
  qualityUrl: `http://127.0.0.1:5180/#/works/${workId}/quality`,
  workId,
  planId,
  design: {
    worldPackRevision: design.worldPack.revision,
    storyBibleRevision: design.storyBible.revision,
    latestPlanRevision: latest.revision,
    latestPlanStatus: latest.status,
    approvedPlanRevision: plans.active.revision,
    proseGenerationBlocked: true,
    visibleText: [
      '当前世界观 v41 · 故事圣经 v74 · 最新计划 v78 · 批准计划 v10',
      'World Pack · v41 · 待审核',
      'Story Bible · v74 · 待审核',
      '正文生产尚未开放',
    ],
  },
  quality: {
    selectedPlanRevision: reviews.selectedPlan.revision,
    selectedPlanStatus: reviews.selectedPlan.status,
    ready: reviews.ready,
    areas: reviews.areas.map(item => ({ area: item.area, status: item.status })),
    visibleText: [
      '计划 v78 · 待批准提案',
      '世界、势力与历史 · 设计已变，需重评',
      '力量、功法与法宝 · 设计已变，需重评',
      '人物、关系与认知 · 设计已变，需重评',
      '主线、分卷与章纲 · 设计已变，需重评',
    ],
  },
  modelCalls: 0,
  productionWrites: 0,
  formalAcceptance: false,
  proseGenerated: false,
  limitation: 'Read-only UI/API observation; four v78 content reviews still need to run and pass before approval.',
};
const output = 'docs/audits/2026-10-23-design77-budget-repair-v2-ui.json';
fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', flush: true });
console.log(JSON.stringify({ verified: true, planRevision: latest.revision, ready: reviews.ready, areas: reviews.areas, formalAcceptance: false }));
