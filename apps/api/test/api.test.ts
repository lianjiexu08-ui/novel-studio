import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/server.ts';
import { ChapterWorkflow, InMemoryWorkRepository } from '../../../packages/application/src/index.ts';
import { createEmptyWorldPack } from '../../../novel-service-core/src/world.ts';
import type { ModelProvider } from '../../../novel-service-core/src/core.ts';
import { UsageLedger } from '../../../packages/model-gateway/src/index.ts';
import { approveMinimalPlan, chapterBody, lockMinimalDesign, minimalPlan } from '../../../packages/application/test/fixtures.ts';
import type { BookPlan } from '../../../novel-service-core/src/planning.ts';

const writer: ModelProvider = {
  generateChapter: ({ chapterNumber }) => {
    const event = { eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: chapterNumber, storyTime: chapterNumber, evidence: 'paragraph 1' };
    return { content: chapterBody(chapterNumber), proposedEvents: [event], observedEvents: [event] };
  },
};

/** Locks the minimal design and approves a 10-chapter plan, as the author would. */
async function lockDesign(repository: InMemoryWorkRepository, workId: string): Promise<void> {
  const workflow = new ChapterWorkflow(repository, writer);
  await lockMinimalDesign(workflow, workId);
  await approveMinimalPlan(workflow, workId);
}

type Inject = ReturnType<typeof createApiServer>['app']['inject'];

/** Saves, reviews and approves a plan over HTTP; review and approval stay separate calls. */
async function approvePlanViaApi(inject: Inject, workId: string, plan: BookPlan) {
  const overview = (await inject({ method: 'GET', url: `/works/${workId}/plans` })).json();
  const saved = await inject({ method: 'PUT', url: `/works/${workId}/plans`, payload: { plan, baseRevisionId: overview.latest?.id } });
  assert.equal(saved.statusCode, 201, saved.body);
  const planId = saved.json().plan.id;
  const review = await inject({ method: 'POST', url: `/works/${workId}/plans/${planId}/review`, payload: {} });
  assert.equal(review.json().review.passed, true, review.body);
  const approved = await inject({ method: 'POST', url: `/works/${workId}/plans/${planId}/approve`, payload: {} });
  assert.equal(approved.statusCode, 200, approved.body);
  return approved.json().plan;
}

function createPayload(title: string) {
  return {
    title,
    covenant: {
      audience: '喜欢阶段突破很清楚的读者',
      hook: '主角用寿命换一次胜利',
    },
  };
}

function milestoneDesign() {
  const world = {
    id: 'milestone-world', revision: 1, title: '百章世界', summary: '可验证的三卷世界', status: 'locked' as const,
    axioms: [{ id: 'axiom', title: '因果有价', content: '力量有代价', scope: 'all', precedence: 1, status: 'locked' as const }],
    powerSystems: [{ id: 'qi', name: '灵力', source: '天地', unit: '灵力', realmIds: ['r1', 'r2', 'r3'], status: 'locked' as const }],
    realms: [1, 2, 3].map((rank) => ({ id: `r${rank}`, systemId: 'qi', name: `境界${rank}`, rank, prerequisites: [], capabilities: ['修行'], cost: '时间', counters: [], status: 'locked' as const })),
    techniques: [1, 2, 3].map((n) => ({ id: `t${n}`, name: `功法${n}`, kind: 'technique' as const, allowedRealmIds: ['r1', 'r2', 'r3'], effect: '提升', cost: '灵力', limitations: [], counters: [], status: 'locked' as const })),
    artifacts: [1, 2, 3].map((n) => ({ id: `a${n}`, name: `法宝${n}`, tier: `${n}阶`, effect: '增幅', cost: '资源', limitations: [], status: 'locked' as const })),
    resources: [1, 2, 3].map((n) => ({ id: `res${n}`, name: `资源${n}`, unit: '枚', source: '矿脉', scarcity: '有限', status: 'locked' as const })),
    locations: [{ id: 'east', name: '东陆', kind: 'continent' as const, entryConditions: [], status: 'locked' as const }, { id: 'north', name: '北陆', kind: 'continent' as const, entryConditions: [], status: 'locked' as const }, { id: 'west', name: '西陆', kind: 'continent' as const, entryConditions: [], status: 'locked' as const }, { id: 'city', name: '青城', kind: 'city' as const, parentId: 'east', entryConditions: [], status: 'locked' as const }, { id: 'ruin', name: '古遗迹', kind: 'ruin' as const, parentId: 'east', entryConditions: [], status: 'locked' as const }],
    factions: [1, 2, 3].map((n) => ({ id: `f${n}`, name: `势力${n}`, kind: 'sect' as const, locationIds: ['east'], goals: ['存续'], resources: ['res1'], status: 'locked' as const })),
    historicalEvents: [1, 2, 3].map((n) => ({ id: `h${n}`, title: `历史${n}`, storyTime: `${n}百年前`, causes: ['冲突'], consequences: ['变局'], factionIds: ['f1'], status: 'locked' as const })),
    terminology: [{ id: 'term', canonical: '灵力', aliases: ['灵气'], kind: 'other' as const, status: 'locked' as const }], unresolvedQuestions: [], createdAt: new Date().toISOString(),
  };
  const bible = {
    id: 'milestone-bible', revision: 1, worldPackId: world.id, worldPackRevision: world.revision, status: 'locked' as const,
    coreConflict: '界门战争', endingDirection: '封印界门并承担代价',
    characters: [{ id: 'hero', name: '林渊', role: 'protagonist' as const, goal: '守护故乡', identity: '弟子', locationId: 'city', factionId: 'f1', startingRealmId: 'r1' }, { id: 'rival', name: '沈烬', role: 'major' as const, goal: '开启界门', identity: '遗族', locationId: 'east', factionId: 'f2', startingRealmId: 'r2' }],
    relationships: [{ id: 'rel', fromCharacterId: 'hero', toCharacterId: 'rival', kind: 'trust' as const, value: '戒备', locked: false }],
    secrets: [{ id: 'secret', ownerCharacterId: 'rival', title: '遗印', truth: '沈烬携带战争遗印', revealCondition: '界门开启时揭示', status: 'locked' as const }],
    arcBeats: [3, 15, 28, 40, 52, 65, 75, 88, 98].map((plannedChapter, index) => ({ id: `beat-${index + 1}`, arcId: 'arc', characterId: 'hero', kind: 'trigger' as const, plannedChapter, expectedChange: `推进界门主线 ${index + 1}` })),
    promises: [{ id: 'promise', title: '三年之约', promise: '主角必须赴约', payoffCondition: '终卷决战前兑现', plannedChapter: 25, status: 'locked' as const }],
    openThreads: [{ id: 'thread', title: '界门来历', kind: 'mystery' as const, question: '谁建造界门', plannedResolution: '终卷揭示建造者', status: 'locked' as const }],
    arcs: [{ id: 'arc', title: '守护故乡', characterIds: ['hero'], goal: '查清战争', stakes: '三陆存亡', plannedOutcome: '封印界门' }],
    volumes: [1, 2, 3].map((order) => ({ id: `v${order}`, order, title: `第${order}卷`, goal: '推进主线', climax: '卷末决战', endState: '继续前进', plannedChapterCount: order === 1 ? 34 : 33, arcIds: ['arc'] })), chapterPlans: Array.from({ length: 50 }, (_, index) => ({ id: `chapter-plan-${index + 1}`, chapterNumber: index + 1, title: `开篇第${index + 1}章`, purpose: '推进主线', conflict: '界门威胁升级', turningPoint: '获得新线索', endHook: '新的悬念', characterIds: ['hero'], locationIds: ['city'], arcBeatIds: [], requiredEvents: [] })), unresolvedQuestions: [], createdAt: new Date().toISOString(),
  };
  return { world, bible };
}

function milestoneChapterEvents(chapterNumber: number) {
  const events: Array<{ eventType: string; subjectId: string; predicate: string; value: unknown; evidence?: string }> = [{ eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: chapterNumber }];
  if (chapterNumber === 100) {
    events.push(
      { eventType: 'secret_reveal', subjectId: 'secret', predicate: 'revealed', value: true, evidence: '遗印真相揭示' },
      { eventType: 'promise_payoff', subjectId: 'promise', predicate: 'status', value: { status: 'paid' }, evidence: '三年之约兑现' },
      { eventType: 'thread_resolution', subjectId: 'thread', predicate: 'status', value: { status: 'resolved' }, evidence: '界门来历揭晓' },
      { eventType: 'arc_progress', subjectId: 'arc', predicate: 'status', value: { status: 'resolved' }, evidence: '主线决战完成' },
      { eventType: 'volume_progress', subjectId: 'v3', predicate: 'status', value: { status: 'resolved' }, evidence: '终卷完成' },
    );
  }
  if (chapterNumber === 34) events.push({ eventType: 'volume_progress', subjectId: 'v1', predicate: 'status', value: { status: 'resolved' }, evidence: '第一卷完成' });
  if (chapterNumber === 67) events.push({ eventType: 'volume_progress', subjectId: 'v2', predicate: 'status', value: { status: 'resolved' }, evidence: '第二卷完成' });
  if (chapterNumber === 150) events.push({ eventType: 'volume_progress', subjectId: 'v1', predicate: 'status', value: { status: 'resolved' }, evidence: '扩展第一卷完成' });
  if (chapterNumber === 300) events.push({ eventType: 'volume_progress', subjectId: 'v2', predicate: 'status', value: { status: 'resolved' }, evidence: '扩展第二卷完成' });
  return events;
}

test('local API runs create -> generate -> check -> adopt -> outbox', async () => {
  const repository = new InMemoryWorkRepository();
  const { app } = createApiServer({ repository, provider: writer });
  try {
    assert.deepEqual((await app.inject({ method: 'GET', url: '/health' })).json(), { ok: true });

    const created = await app.inject({ method: 'POST', url: '/works', payload: createPayload('API 玄幻试作') });
    assert.equal(created.statusCode, 201);
    const work = created.json();
    assert.ok(work.id);
    assert.equal(work.covenant.hook, '主角用寿命换一次胜利');
    assert.equal(work.covenant.genre, 'xuanhuan');

    const patched = await app.inject({
      method: 'PATCH', url: `/works/${work.id}`,
      payload: { title: work.title, covenant: { ...work.covenant, avoid: '不要后宫' } },
    });
    assert.equal(patched.statusCode, 200);
    assert.equal(patched.json().stateRevision, 0);
    assert.equal(patched.json().covenant.avoid, '不要后宫');

    const notReady = await app.inject({ method: 'GET', url: `/works/${work.id}/chapters/1/readiness` });
    assert.equal(notReady.json().ready, false);
    assert.deepEqual(notReady.json().blockers.map((blocker: { code: string }) => blocker.code), ['CANON_NOT_READY', 'PLAN_NOT_APPROVED']);
    const refused = await app.inject({ method: 'POST', url: `/works/${work.id}/chapters/1/generate`, payload: {} });
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().error.code, 'CANON_NOT_READY');

    await lockDesign(repository, work.id);
    const readiness = await app.inject({ method: 'GET', url: `/works/${work.id}/chapters/1/readiness` });
    assert.equal(readiness.json().ready, true);
    assert.deepEqual(readiness.json().requiredChecks, ['deterministic_rules', 'canon_consistency', 'observed_events', 'chapter_length']);

    const generated = await app.inject({ method: 'POST', url: `/works/${work.id}/chapters/1/generate`, payload: { runId: 'api-run-1' } });
    assert.equal(generated.statusCode, 201);
    const candidate = generated.json().candidate;
    assert.equal(candidate.status, 'candidate');
    assert.equal(candidate.origin, 'model');
    assert.equal(candidate.stale, false);
    assert.equal(candidate.contentHash.length, 64);
    assert.match(candidate.content, /第1章/);
    assert.ok(candidate.proposedEvents.length > 0);

    const unchecked = await app.inject({ method: 'POST', url: `/works/${work.id}/candidates/${candidate.id}/adopt`, payload: { expectedStateRevision: 0 } });
    assert.equal(unchecked.statusCode, 409);
    assert.equal(unchecked.json().error.code, 'REQUIRED_CHECK_FAILED');

    const checked = await app.inject({ method: 'POST', url: `/works/${work.id}/candidates/${candidate.id}/check` });
    assert.equal(checked.statusCode, 200);
    assert.ok(checked.json().candidate.checks.every((check: { status: string; policyVersion: string }) => check.status === 'passed' && check.policyVersion === 'chapter-policy-v2'));
    assert.equal(checked.json().candidate.checks.length, 4);

    const adopted = await app.inject({ method: 'POST', url: `/works/${work.id}/candidates/${candidate.id}/adopt`, payload: { expectedStateRevision: 0 } });
    assert.equal(adopted.statusCode, 200);
    assert.equal(adopted.json().outbox.length, 3);

    const outbox = await app.inject({ method: 'GET', url: `/works/${work.id}/outbox` });
    assert.equal(outbox.json().events.length, 3);
    const history = await app.inject({ method: 'GET', url: `/works/${work.id}/state/1` });
    assert.equal(history.statusCode, 200);
    assert.equal(history.json().events.length, 1);
    assert.equal(history.json().quality.contextManifest.chapterNumber, 1);
    assert.equal(history.json().quality.checkCoverage.passed, 4);
    assert.equal(history.json().quality.candidate.status, 'adopted');
  } finally {
    await app.close();
  }
});

test('without a configured model the API refuses formal chapters and isolates demo candidates', async () => {
  const repository = new InMemoryWorkRepository();
  const { app } = createApiServer({ repository });
  try {
    const work = (await app.inject({ method: 'POST', url: '/works', payload: createPayload('演示') })).json();
    await lockDesign(repository, work.id);
    const readiness = (await app.inject({ method: 'GET', url: `/works/${work.id}/chapters/1/readiness` })).json();
    assert.equal(readiness.modelConfigured, false);
    assert.deepEqual(readiness.blockers.map((blocker: { code: string }) => blocker.code), ['MODEL_NOT_CONFIGURED']);
    const formal = await app.inject({ method: 'POST', url: `/works/${work.id}/chapters/1/generate`, payload: {} });
    assert.equal(formal.statusCode, 409);
    assert.equal(formal.json().error.code, 'MODEL_NOT_CONFIGURED');
    assert.ok(formal.json().error.details.blockers[0].nextAction);

    const demo = await app.inject({ method: 'POST', url: `/works/${work.id}/chapters/1/generate`, payload: { mode: 'demo' } });
    assert.equal(demo.statusCode, 201);
    assert.equal(demo.json().candidate.origin, 'demo');
    const candidateId = demo.json().candidate.id;
    await app.inject({ method: 'POST', url: `/works/${work.id}/candidates/${candidateId}/check` });
    const adopt = await app.inject({ method: 'POST', url: `/works/${work.id}/candidates/${candidateId}/adopt`, payload: { expectedStateRevision: 0 } });
    assert.equal(adopt.statusCode, 409);
    assert.equal(adopt.json().error.code, 'DEMO_CANDIDATE_NOT_ADOPTABLE');
    assert.equal((await app.inject({ method: 'GET', url: `/works/${work.id}` })).json().stateRevision, 0);
    assert.equal((await app.inject({ method: 'GET', url: `/works/${work.id}/outbox` })).json().events.length, 0);
  } finally {
    await app.close();
  }
});

test('a later chapter cannot be generated before earlier chapters are adopted', async () => {
  const repository = new InMemoryWorkRepository();
  const { app } = createApiServer({ repository, provider: writer });
  try {
    const work = (await app.inject({ method: 'POST', url: '/works', payload: createPayload('跳章') })).json();
    await lockDesign(repository, work.id);
    const skipped = await app.inject({ method: 'POST', url: `/works/${work.id}/chapters/3/generate`, payload: {} });
    assert.equal(skipped.statusCode, 409);
    assert.equal(skipped.json().error.code, 'CHAPTER_PREREQUISITE_MISSING');
    assert.match(skipped.json().error.details.blockers[0].message, /1, 2/);
  } finally {
    await app.close();
  }
});

test('multi-chapter runs and milestones are disabled unless explicitly enabled', async () => {
  const repository = new InMemoryWorkRepository();
  const { app } = createApiServer({ repository, provider: writer, allowBatchRuns: false });
  try {
    const work = (await app.inject({ method: 'POST', url: '/works', payload: createPayload('不许批量') })).json();
    for (const url of [`/works/${work.id}/runs`, `/works/${work.id}/milestones/100/start`, `/works/${work.id}/milestones/450/start`]) {
      const response = await app.inject({ method: 'POST', url, payload: { targetChapter: 3 } });
      assert.equal(response.statusCode, 409, url);
      assert.equal(response.json().error.code, 'BATCH_RUNS_DISABLED', url);
    }
    assert.equal((await repository.get(work.id))?.worldPack, undefined, 'a disabled milestone must not touch the design');
  } finally {
    await app.close();
  }
});

test('local API rejects adoption when the state revision is stale', async () => {
  const repository = new InMemoryWorkRepository();
  const { app } = createApiServer({ repository, provider: writer });
  try {
    const work = (await app.inject({ method: 'POST', url: '/works', payload: createPayload('版本检查') })).json();
    await lockDesign(repository, work.id);
    const candidate = (await app.inject({ method: 'POST', url: `/works/${work.id}/chapters/1/generate`, payload: {} })).json().candidate;
    await app.inject({ method: 'POST', url: `/works/${work.id}/candidates/${candidate.id}/check` });
    const result = await app.inject({ method: 'POST', url: `/works/${work.id}/candidates/${candidate.id}/adopt`, payload: { expectedStateRevision: 99 } });
    assert.equal(result.statusCode, 409);
    assert.equal(result.json().error.code, 'STALE_CANDIDATE');
  } finally {
    await app.close();
  }
});

test('state API exposes chapter-scoped character knowledge', async () => {
  const event = { eventType: 'knowledge_belief', subjectId: 'hero', predicate: 'rival_identity', value: { subjectId: 'rival', belief: '对手来自北陆' }, evidence: '正文揭示身份' };
  const repository = new InMemoryWorkRepository();
  const { app } = createApiServer({ repository, provider: { generateChapter: () => ({ content: `认知变化 ${chapterBody(1)}`, proposedEvents: [event], observedEvents: [event] }) } });
  try {
    const work = (await app.inject({ method: 'POST', url: '/works', payload: createPayload('认知复查') })).json();
    await lockDesign(repository, work.id);
    const candidate = (await app.inject({ method: 'POST', url: `/works/${work.id}/chapters/1/generate`, payload: {} })).json().candidate;
    await app.inject({ method: 'POST', url: `/works/${work.id}/candidates/${candidate.id}/check` });
    await app.inject({ method: 'POST', url: `/works/${work.id}/candidates/${candidate.id}/adopt`, payload: { expectedStateRevision: 0 } });
    const state = await app.inject({ method: 'GET', url: `/works/${work.id}/state/1` });
    assert.equal(state.statusCode, 200);
    assert.equal(state.json().knowledgeStates[0].subjectId, 'rival');
    assert.equal(state.json().knowledgeStates[0].belief, '对手来自北陆');
  } finally {
    await app.close();
  }
});

test('local API maps invalid payloads to VALIDATION_FAILED and unknown works to NOT_FOUND', async () => {
  const { app } = createApiServer({ repository: new InMemoryWorkRepository() });
  try {
    const invalid = await app.inject({ method: 'POST', url: '/works', payload: { title: '  ' } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error.code, 'VALIDATION_FAILED');

    const missingCovenant = await app.inject({ method: 'POST', url: '/works', payload: { title: '只有书名' } });
    assert.equal(missingCovenant.statusCode, 400);
    assert.equal(missingCovenant.json().error.code, 'VALIDATION_FAILED');

    const missing = await app.inject({ method: 'GET', url: '/works/work_missing' });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, 'NOT_FOUND');
  } finally {
    await app.close();
  }
});

test('settings API keeps characters, locked relationships and plot nodes under author control', async () => {
  const { app } = createApiServer({ repository: new InMemoryWorkRepository() });
  try {
    const work = (await app.inject({ method: 'POST', url: '/works', payload: createPayload('设定') })).json();
    const base = `/works/${work.id}`;
    const master = (await app.inject({ method: 'POST', url: `${base}/characters`, payload: { name: '玄机子', role: 'major' } })).json();
    const hero = (await app.inject({ method: 'POST', url: `${base}/characters`, payload: { name: '林渊', aliases: ['渊哥'], role: 'protagonist' } })).json();
    assert.equal(hero.role, 'protagonist');

    const clash = await app.inject({ method: 'POST', url: `${base}/characters`, payload: { name: '渊哥' } });
    assert.equal(clash.statusCode, 409);
    assert.equal(clash.json().error.code, 'CONFLICT');

    const bond = (await app.inject({
      method: 'POST', url: `${base}/relationships`,
      payload: { fromCharacterId: master.id, toCharacterId: hero.id, kind: '师徒', value: '亲传' },
    })).json();
    assert.equal(bond.layer, 'objective');
    await app.inject({ method: 'PATCH', url: `${base}/relationships/${bond.id}`, payload: { locked: true } });
    const blocked = await app.inject({ method: 'PATCH', url: `${base}/relationships/${bond.id}`, payload: { value: '反目' } });
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.json().error.code, 'LOCKED_CONSTRAINT');

    const inUse = await app.inject({ method: 'DELETE', url: `${base}/characters/${hero.id}` });
    assert.equal(inUse.json().error.code, 'CONFLICT');

    await app.inject({ method: 'POST', url: `${base}/world-rules`, payload: { category: 'power', title: '境界', content: '炼气、筑基' } });
    const node = (await app.inject({ method: 'POST', url: `${base}/plot-nodes`, payload: { level: 'volume', title: '三年之约', targetChapter: 30 } })).json();
    assert.equal(node.realization.status, 'unrealized');

    const bible = (await app.inject({ method: 'GET', url: `${base}/bible` })).json();
    assert.equal(bible.characters.length, 2);
    assert.equal(bible.relationships[0].locked, true);
    assert.equal(bible.worldRules.length, 1);
    assert.equal(bible.plotNodes.length, 1);
    assert.equal((await app.inject({ method: 'GET', url: base })).json().stateRevision, 0);

    const missing = await app.inject({ method: 'PATCH', url: `${base}/characters/character_missing`, payload: { goal: 'x' } });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('local API enforces bearer auth when a token is configured', async () => {
  const { app } = createApiServer({ repository: new InMemoryWorkRepository(), authToken: 'secret' });
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
    const denied = await app.inject({ method: 'POST', url: '/works', payload: { title: '鉴权' } });
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.json().error.code, 'UNAUTHORIZED');
    const allowed = await app.inject({
      method: 'POST', url: '/works', payload: createPayload('鉴权'),
      headers: { authorization: 'Bearer secret' },
    });
    assert.equal(allowed.statusCode, 201);
  } finally {
    await app.close();
  }
});

test('design API saves and locks the world pack before the story bible', async () => {
  const { app } = createApiServer({
    repository: new InMemoryWorkRepository(),
    provider: {
      generateChapter: ({ chapterNumber }) => {
        const events: Array<{ eventType: string; subjectId: string; predicate: string; value: unknown }> = [{ eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: chapterNumber }];
        if (chapterNumber === 10) events.push(
          { eventType: 'arc_progress', subjectId: 'arc', predicate: 'status', value: { status: 'resolved' } },
          { eventType: 'volume_progress', subjectId: 'v1', predicate: 'status', value: { status: 'resolved' } },
        );
        return { content: chapterBody(chapterNumber), proposedEvents: events, observedEvents: events };
      },
    },
  });
  try {
    const work = (await app.inject({ method: 'POST', url: '/works', payload: createPayload('世界包门禁') })).json();
    const base = `/works/${work.id}`;
    const worldPack = {
      id: 'world_api', revision: 1, title: '九霄界', summary: '三界玄幻', status: 'reviewed',
      axioms: [{ id: 'axiom', title: '因果有价', content: '力量必须支付代价', scope: 'all', precedence: 1, status: 'reviewed' }], powerSystems: [{ id: 'system', name: '灵力', source: '天地', unit: '灵气', realmIds: ['realm'], status: 'reviewed' }],
      realms: [{ id: 'realm', systemId: 'system', name: '炼气', rank: 1, prerequisites: [], capabilities: ['引气'], cost: '时间', counters: [], status: 'reviewed' }],
      techniques: [{ id: 'technique', name: '引气诀', kind: 'cultivation', allowedRealmIds: ['realm'], effect: '引气', cost: '时间', limitations: [], counters: [], status: 'reviewed' }], artifacts: [{ id: 'artifact', name: '青云剑', tier: '一阶', effect: '增幅', cost: '灵石', limitations: [], status: 'reviewed' }], resources: [{ id: 'resource', name: '灵石', unit: '枚', source: '矿脉', scarcity: '常见', status: 'reviewed' }], locations: [{ id: 'home', name: '青州', kind: 'continent', entryConditions: [], status: 'reviewed' }],
      factions: [{ id: 'sect', name: '青云宗', kind: 'sect', locationIds: ['home'], goals: ['守护青州'], resources: [], status: 'reviewed' }],
      historicalEvents: [{ id: 'history', title: '立宗', storyTime: '百年前', causes: ['动荡'], consequences: ['建宗'], factionIds: ['sect'], status: 'reviewed' }], terminology: [{ id: 'term', canonical: '灵气', aliases: [], kind: 'other', status: 'reviewed' }], unresolvedQuestions: [], createdAt: new Date().toISOString(),
    };
    const savedWorld = await app.inject({ method: 'PUT', url: `${base}/world-pack`, payload: { ...worldPack, status: 'locked' } });
    assert.equal(savedWorld.statusCode, 200);
    assert.equal(savedWorld.json().worldPack.status, 'proposed');
    assert.equal((await app.inject({ method: 'POST', url: `${base}/world-pack/lock`, payload: {} })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: `${base}/world-pack/review`, payload: {} })).json().worldPack.status, 'reviewed');
    const lockedWorld = (await app.inject({ method: 'POST', url: `${base}/world-pack/lock`, payload: {} })).json().worldPack;
    assert.equal(lockedWorld.status, 'locked');
    const storyBible = {
      id: 'bible_api', revision: 1, worldPackId: lockedWorld.id, worldPackRevision: lockedWorld.revision, status: 'reviewed',
      coreConflict: '宗门存亡', endingDirection: '守住家园',
      characters: [{ id: 'hero', name: '林渊', role: 'protagonist', goal: '守护青州', identity: '弟子', locationId: 'home', factionId: 'sect', startingRealmId: 'realm' }, { id: 'rival', name: '苏晚', role: 'major', goal: '查明真相', identity: '弟子', locationId: 'home', factionId: 'sect', startingRealmId: 'realm' }],
      relationships: [{ id: 'rel', fromCharacterId: 'hero', toCharacterId: 'rival', kind: 'trust', value: '同门', locked: false }], arcs: [{ id: 'arc', title: '守城', characterIds: ['hero'], goal: '成长', stakes: '宗门存亡', plannedOutcome: '守住宗门' }], volumes: [{ id: 'v1', order: 1, title: '入门', goal: '成长', climax: '守城', endState: '入筑基', plannedChapterCount: 10, arcIds: ['arc'] }],
      unresolvedQuestions: [], createdAt: new Date().toISOString(),
    };
    const savedBible = await app.inject({ method: 'PUT', url: `${base}/story-bible`, payload: { ...storyBible, status: 'locked' } });
    assert.equal(savedBible.statusCode, 200);
    assert.equal(savedBible.json().storyBible.status, 'proposed');
    assert.equal((await app.inject({ method: 'POST', url: `${base}/story-bible/lock`, payload: {} })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: `${base}/story-bible/review`, payload: {} })).json().storyBible.status, 'reviewed');
    const lockedBible = (await app.inject({ method: 'POST', url: `${base}/story-bible/lock`, payload: {} })).json().storyBible;
    assert.equal(lockedBible.status, 'locked');
    const initialState = await app.inject({ method: 'GET', url: `${base}/state/1` });
    assert.equal(initialState.json().relationships[0].id, 'rel');
    assert.equal(initialState.json().relationships[0].value, '同门');
    const blockedByPlan = await app.inject({ method: 'POST', url: `${base}/chapters/1/generate`, payload: {} });
    assert.equal(blockedByPlan.json().error.code, 'PLAN_NOT_APPROVED');
    await approvePlanViaApi(app.inject.bind(app), work.id, minimalPlan(10));
    let stateRevision = 0;
    for (let chapterNumber = 1; chapterNumber <= 10; chapterNumber += 1) {
      const generated = await app.inject({ method: 'POST', url: `${base}/chapters/${chapterNumber}/generate`, payload: { runId: `manuscript-run:${chapterNumber}` } });
      assert.equal(generated.statusCode, 201, generated.body);
      const candidate = generated.json().candidate;
      await app.inject({ method: 'POST', url: `${base}/candidates/${candidate.id}/check` });
      const adopted = await app.inject({ method: 'POST', url: `${base}/candidates/${candidate.id}/adopt`, payload: { expectedStateRevision: stateRevision } });
      assert.equal(adopted.statusCode, 200);
      stateRevision += 1;
    }
    const finalized = await app.inject({ method: 'POST', url: `${base}/manuscripts/finalize`, payload: {} });
    assert.equal(finalized.statusCode, 200);
    assert.equal(finalized.json().manuscript.chapterCount, 10);
    assert.equal(finalized.json().manuscript.status, 'final');
    assert.ok(finalized.json().manuscript.wordCount > 0);
    assert.equal(finalized.json().manuscript.targetWordCount, 2200 * 10);
    assert.ok(finalized.json().manuscript.lengthCoverage > 0);
    assert.equal(finalized.json().manuscript.contentHash.length, 64);
    const exported = await app.inject({ method: 'GET', url: `${base}/manuscripts/${finalized.json().manuscript.id}/export` });
    assert.equal(exported.statusCode, 200);
    assert.equal(exported.json().work.id, work.id);
    assert.equal(exported.json().worldPack.id, lockedWorld.id);
    assert.equal(exported.json().storyBible.id, lockedBible.id);
    assert.ok(exported.json().designHistory.length >= 4);
    assert.equal(exported.json().closureCoverage.ready, true);
    assert.equal(exported.json().chapters.length, 10);
    assert.equal(exported.json().chapters[0].chapterNumber, 1);
    const design = (await app.inject({ method: 'GET', url: `${base}/design` })).json();
    assert.equal(design.worldPack.status, 'locked');
    assert.equal(design.storyBible.status, 'locked');
    assert.ok(design.constraintRevision >= 4);
    const designHistory = (await app.inject({ method: 'GET', url: `${base}/design/history` })).json();
    assert.ok(designHistory.revisions.some((revision: { kind: string; status: string }) => revision.kind === 'world_pack' && revision.status === 'locked'));
    assert.ok(designHistory.revisions.some((revision: { kind: string; status: string }) => revision.kind === 'story_bible' && revision.status === 'locked'));
    assert.equal((await app.inject({ method: 'GET', url: `${base}/manuscripts` })).json().manuscripts.length, 1);
  } finally {
    await app.close();
  }
});

test('design generation route stores a proposed world pack from the planner', async () => {
  const { app } = createApiServer({
    repository: new InMemoryWorkRepository(),
    designProvider: {
      generateWorldPack: async () => ({ ...createEmptyWorldPack('模型生成世界'), status: 'locked' as const, lockedAt: new Date().toISOString() }),
      generateStoryBible: async () => { throw new Error('not used'); },
    },
  });
  try {
    const work = (await app.inject({ method: 'POST', url: '/works', payload: createPayload('规划器接入') })).json();
    const response = await app.inject({ method: 'POST', url: `/works/${work.id}/design/generate`, payload: { stage: 'world_pack' } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().worldPack.status, 'proposed');
    assert.equal((await app.inject({ method: 'GET', url: `/works/${work.id}/design` })).json().worldPack.title, '模型生成世界');
  } finally {
    await app.close();
  }
});

test('run API commits a resumable checkpoint one chapter at a time', async () => {
  const repository = new InMemoryWorkRepository();
  const { app } = createApiServer({ repository, provider: writer, allowBatchRuns: true });
  try {
    const work = (await app.inject({ method: 'POST', url: '/works', payload: createPayload('连续生成') })).json();
    await lockDesign(repository, work.id);
    const run = await app.inject({ method: 'POST', url: `/works/${work.id}/runs`, payload: { targetChapter: 3, runId: 'api-continuous' } });
    assert.equal(run.statusCode, 200);
    assert.equal(run.json().checkpoint.nextChapter, 4);
    const checkpoints = await app.inject({ method: 'GET', url: `/works/${work.id}/runs` });
    assert.equal(checkpoints.statusCode, 200);
    assert.equal(checkpoints.json().checkpoints[0].phase, 'complete');
  } finally {
    await app.close();
  }
});

test('run API can launch a background run and expose its checkpoint', async () => {
  const repository = new InMemoryWorkRepository();
  const { app } = createApiServer({ repository, provider: writer, allowBatchRuns: true });
  try {
    const work = (await app.inject({ method: 'POST', url: '/works', payload: createPayload('后台连续生成') })).json();
    await lockDesign(repository, work.id);
    const started = await app.inject({ method: 'POST', url: `/works/${work.id}/runs`, payload: { targetChapter: 2, runId: 'background-run', background: true } });
    assert.equal(started.statusCode, 202);
    assert.equal(started.json().runId, 'background-run');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const status = await app.inject({ method: 'GET', url: `/works/${work.id}/runs` });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().checkpoints[0].nextChapter, 3);
  } finally {
    await app.close();
  }
});

test('100-chapter milestone endpoint starts from locked design and reaches a final checkpoint', async () => {
  const design = milestoneDesign();
  const { app } = createApiServer({
    repository: new InMemoryWorkRepository(),
    allowBatchRuns: true,
    provider: { generateChapter: ({ chapterNumber }) => { const events = milestoneChapterEvents(chapterNumber); return { content: chapterBody(chapterNumber), proposedEvents: events, observedEvents: events }; } },
    designProvider: { generateWorldPack: async () => design.world, generateStoryBible: async () => design.bible },
  });
  try {
    const work = (await app.inject({ method: 'POST', url: '/works', payload: createPayload('一键百章') })).json();
    const unplanned = await app.inject({ method: 'POST', url: `/works/${work.id}/milestones/100/start`, payload: {} });
    assert.equal(unplanned.json().error.code, 'PLAN_NOT_APPROVED', 'the design is prepared but no run starts without an author-approved plan');
    await approvePlanViaApi(app.inject.bind(app), work.id, minimalPlan(100, { volumeSize: 34, outlined: 100 }));
    const started = await app.inject({ method: 'POST', url: `/works/${work.id}/milestones/100/start`, payload: {} });
    assert.equal(started.statusCode, 202, started.body);
    assert.equal(started.json().milestone.targetChapter, 100);
    const planned = await app.inject({ method: 'GET', url: `/works/${work.id}/state/1` });
    assert.equal(planned.json().arcStates[0].status, 'planned');
    assert.equal(planned.json().secretStates[0].revealed, false);
    assert.equal(planned.json().promiseStates[0].status, 'open');
    assert.equal(planned.json().threadStates[0].status, 'open');
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const status = await app.inject({ method: 'GET', url: `/works/${work.id}/runs` });
      if (status.json().checkpoints[0]?.nextChapter === 101) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const status = await app.inject({ method: 'GET', url: `/works/${work.id}/runs` });
    assert.equal(status.json().checkpoints[0].nextChapter, 101);
    const finalized = await app.inject({ method: 'POST', url: `/works/${work.id}/manuscripts/finalize`, payload: {} });
    assert.equal(finalized.statusCode, 200);
    assert.equal(finalized.json().manuscript.chapterCount, 100);
    assert.ok(finalized.json().manuscript.targetWordCount > finalized.json().manuscript.wordCount);
  } finally {
    await app.close();
  }
});

test('450-chapter expansion resumes after the first hundred chapters', async () => {
  const design = milestoneDesign();
  let previousBibleForExpansion: unknown;
  const fullBible = {
    ...design.bible,
    id: 'full-bible',
    volumes: [1, 2, 3].map((order) => ({ ...design.bible.volumes[order - 1], plannedChapterCount: 150 })),
    arcBeats: [...(design.bible.arcBeats ?? []), ...[125, 175, 225, 275, 325, 375, 425].map((plannedChapter, index) => ({ id: `expansion-beat-${index + 1}`, arcId: 'arc', characterId: 'hero', kind: 'choice' as const, plannedChapter, expectedChange: `扩展主线推进 ${index + 1}` }))],
  };
  const { app } = createApiServer({
    repository: new InMemoryWorkRepository(),
    allowBatchRuns: true,
    provider: { generateChapter: ({ chapterNumber }) => { const events = milestoneChapterEvents(chapterNumber); return { content: chapterBody(chapterNumber), proposedEvents: events, observedEvents: events }; } },
    designProvider: {
      generateWorldPack: async () => design.world,
      generateStoryBible: async ({ chapterTarget, previousStoryBible }) => {
        if (chapterTarget === 450) previousBibleForExpansion = previousStoryBible;
        return chapterTarget === 450 ? fullBible : design.bible;
      },
    },
  });
  try {
    const work = (await app.inject({ method: 'POST', url: '/works', payload: createPayload('扩展百万字') })).json();
    await app.inject({ method: 'POST', url: `/works/${work.id}/milestones/100/start`, payload: {} });
    await approvePlanViaApi(app.inject.bind(app), work.id, minimalPlan(100, { volumeSize: 34, outlined: 100 }));
    const first = await app.inject({ method: 'POST', url: `/works/${work.id}/milestones/100/start`, payload: {} });
    assert.equal(first.statusCode, 202, first.body);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const status = await app.inject({ method: 'GET', url: `/works/${work.id}/runs` });
      if (status.json().checkpoints.some((checkpoint: { runId: string; nextChapter: number }) => checkpoint.runId === first.json().runId && checkpoint.nextChapter === 101)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const firstManuscript = await app.inject({ method: 'POST', url: `/works/${work.id}/manuscripts/finalize`, payload: {} });
    assert.equal(firstManuscript.statusCode, 200);
    assert.equal(firstManuscript.json().manuscript.chapterCount, 100);
    const outdated = await app.inject({ method: 'POST', url: `/works/${work.id}/milestones/450/start`, payload: {} });
    assert.equal(outdated.json().error.code, 'PLAN_OUTDATED', 'expanding the story bible requires re-approving the plan');
    await approvePlanViaApi(app.inject.bind(app), work.id, minimalPlan(450, { volumeSize: 150, outlined: 450 }));
    const started = await app.inject({ method: 'POST', url: `/works/${work.id}/milestones/450/start`, payload: {} });
    assert.equal(started.statusCode, 202, started.body);
    assert.equal(started.json().milestone.targetChapter, 450);
    assert.equal((previousBibleForExpansion as typeof design.bible).id, design.bible.id);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const status = await app.inject({ method: 'GET', url: `/works/${work.id}/runs` });
      if (status.json().checkpoints.some((checkpoint: { runId: string; nextChapter: number }) => checkpoint.runId === started.json().runId && checkpoint.nextChapter === 451)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const status = await app.inject({ method: 'GET', url: `/works/${work.id}/runs` });
    assert.equal(status.json().checkpoints.find((checkpoint: { runId: string }) => checkpoint.runId === started.json().runId).nextChapter, 451);
    assert.equal((await app.inject({ method: 'GET', url: `/works/${work.id}/design` })).json().storyBible.volumes.reduce((sum, volume) => sum + volume.plannedChapterCount, 0), 450);
    const finalManuscript = await app.inject({ method: 'POST', url: `/works/${work.id}/manuscripts/finalize`, payload: {} });
    assert.equal(finalManuscript.statusCode, 200);
    assert.equal(finalManuscript.json().manuscript.chapterCount, 450);
    assert.ok(finalManuscript.json().manuscript.targetWordCount > finalManuscript.json().manuscript.wordCount);
  } finally {
    await app.close();
  }
});

test('API rulings clear only overridable checks and run controls report stable errors', async () => {
  const shortWriter: ModelProvider = {
    generateChapter: ({ chapterNumber }) => {
      const event = { eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: chapterNumber, storyTime: chapterNumber, evidence: 'paragraph 1' };
      return { content: `短章 ${chapterNumber}`, proposedEvents: [event], observedEvents: [event] };
    },
  };
  const repository = new InMemoryWorkRepository();
  const { app } = createApiServer({ repository, provider: shortWriter, ledger: new UsageLedger(5), allowBatchRuns: true });
  try {
    const work = (await app.inject({ method: 'POST', url: '/works', payload: createPayload('裁决接口') })).json();
    await lockDesign(repository, work.id);
    const generated = await app.inject({ method: 'POST', url: `/works/${work.id}/chapters/1/generate`, payload: {} });
    assert.equal(generated.statusCode, 201, generated.body);
    const candidateId = generated.json().candidate.id;
    const checked = (await app.inject({ method: 'POST', url: `/works/${work.id}/candidates/${candidateId}/check`, payload: {} })).json().candidate;
    const length = checked.checks.find((check: { checker: string }) => check.checker === 'chapter_length');
    assert.equal(length.status, 'failed');
    assert.equal(length.contentHash, checked.contentHash);
    const refused = await app.inject({ method: 'POST', url: `/works/${work.id}/candidates/${candidateId}/adopt`, payload: { expectedStateRevision: 0 } });
    assert.equal(refused.json().error.code, 'REQUIRED_CHECK_FAILED');

    const other = checked.checks.find((check: { checker: string }) => check.checker !== 'chapter_length');
    const notAllowed = await app.inject({ method: 'POST', url: `/works/${work.id}/candidates/${candidateId}/rulings`, payload: { checkId: other.id, reason: '误报', evidence: '第一段' } });
    assert.equal(notAllowed.statusCode, 409);
    assert.equal(notAllowed.json().error.code, 'RULING_NOT_ALLOWED');
    const ruled = await app.inject({ method: 'POST', url: `/works/${work.id}/candidates/${candidateId}/rulings`, payload: { checkId: length.id, reason: '楔子本就短', evidence: '本章是楔子' } });
    assert.equal(ruled.statusCode, 201, ruled.body);
    assert.equal(ruled.json().candidate.rulings.length, 1);
    const adopted = await app.inject({ method: 'POST', url: `/works/${work.id}/candidates/${candidateId}/adopt`, payload: { expectedStateRevision: 0 } });
    assert.equal(adopted.statusCode, 200, adopted.body);

    const unknownRun = await app.inject({ method: 'POST', url: `/works/${work.id}/runs/nope/pause`, payload: {} });
    assert.equal(unknownRun.json().error.code, 'NOT_FOUND');
    const refusedRun = await app.inject({ method: 'POST', url: `/works/${work.id}/runs`, payload: { targetChapter: 2, runId: 'short-run' } });
    assert.equal(refusedRun.json().error.code, 'REQUIRED_CHECK_FAILED');
    const cancelled = await app.inject({ method: 'POST', url: `/works/${work.id}/runs/short-run/cancel`, payload: {} });
    assert.equal(cancelled.json().checkpoint.phase, 'cancelled');
    assert.equal(cancelled.json().checkpoint.leaseToken, undefined, 'fencing tokens never leave the server');
    assert.equal((await app.inject({ method: 'POST', url: `/works/${work.id}/runs`, payload: { targetChapter: 2, runId: 'short-run' } })).json().error.code, 'RUN_CANCELLED');
    assert.equal((await app.inject({ method: 'POST', url: `/works/${work.id}/runs`, payload: { targetChapter: 3, runId: 'short-run' } })).json().error.code, 'IDEMPOTENCY_CONFLICT');

    const usage = (await app.inject({ method: 'GET', url: '/usage' })).json();
    assert.equal(usage.calls, 0, 'the injected test provider does not bill the ledger');
    assert.equal(usage.costKnown, true);
  } finally {
    await app.close();
  }
});

test('plan API: overview, next-chapter brief, brief confirmation, entities and covenant impact', async () => {
  const repository = new InMemoryWorkRepository();
  const { app } = createApiServer({ repository, provider: writer });
  try {
    const work = (await app.inject({ method: 'POST', url: '/works', payload: createPayload('计划接口') })).json();
    const base = `/works/${work.id}`;
    const empty = (await app.inject({ method: 'GET', url: `${base}/plans` })).json();
    assert.equal(empty.active, undefined);
    assert.equal(typeof empty.planningConfigured, 'boolean');
    if (!empty.planningConfigured) {
      const refused = await app.inject({ method: 'POST', url: `${base}/plans/generate`, payload: { targetChapterCount: 30, volumeCount: 3 } });
      assert.equal(refused.json().error.code, 'PLANNER_NOT_CONFIGURED');
    }

    await lockDesign(repository, work.id);
    const overview = (await app.inject({ method: 'GET', url: `${base}/plans` })).json();
    assert.equal(overview.active.status, 'approved');
    assert.equal(overview.realization.nodes.length, 10);
    const stale = await app.inject({ method: 'PUT', url: `${base}/plans`, payload: { plan: minimalPlan(10) } });
    assert.equal(stale.json().error.code, 'PLAN_CONFLICT');
    const unknown = await app.inject({ method: 'POST', url: `${base}/plans/plan_missing/approve`, payload: {} });
    assert.equal(unknown.json().error.code, 'NOT_FOUND');

    const next = (await app.inject({ method: 'GET', url: `${base}/next-chapter` })).json();
    assert.equal(next.chapterNumber, 1);
    assert.deepEqual(next.blockers, []);
    assert.equal(next.brief.brief.outlineId, 'chapter-1');
    const confirmed = await app.inject({ method: 'POST', url: `${base}/chapters/1/brief/confirm`, payload: { location: '演武场' } });
    assert.equal(confirmed.statusCode, 201, confirmed.body);
    assert.equal((await app.inject({ method: 'GET', url: `${base}/chapters/1/brief` })).json().brief.brief.location, '演武场');
    const candidate = (await app.inject({ method: 'POST', url: `${base}/chapters/1/generate`, payload: {} })).json().candidate;
    assert.equal(candidate.planRevisionId, overview.active.id);
    assert.equal(candidate.brief.location, '演武场');

    const entities = (await app.inject({ method: 'GET', url: `${base}/entities` })).json();
    assert.ok(entities.entities.some((entity: { name: string }) => entity.name === '林渊'));
    const patched = await app.inject({ method: 'PATCH', url: base, payload: { ...createPayload('计划接口'), covenant: { ...createPayload('x').covenant, readingExperience: '爽快' }, authorText: '要爽' } });
    assert.equal(patched.statusCode, 200, patched.body);
    assert.deepEqual(patched.json().impact.staleCandidateIds, [candidate.id]);
    const history = (await app.inject({ method: 'GET', url: `${base}/covenant/history` })).json();
    assert.equal(history.revisions.at(-1).authorText, '要爽');
    const afterCovenant = (await app.inject({ method: 'GET', url: `${base}/chapters/1/readiness` })).json();
    assert.equal(afterCovenant.ready, true, 'a covenant edit flags the plan for re-check but does not revoke approval');
  } finally {
    await app.close();
  }
});

test('model settings are stored on this machine, take effect immediately, and the key is never returned', async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createServer } = await import('node:http');
  const directory = mkdtempSync(join(tmpdir(), 'novel-settings-'));
  const file = join(directory, 'model-settings.json');
  const secret = 'sk-test-secret-value';
  let authorization = '';
  const upstream = createServer((request, response) => {
    authorization = String(request.headers.authorization ?? '');
    response.writeHead(200, { 'content-type': 'application/json' });
    if (request.url?.includes('/models')) response.end(JSON.stringify({ data: [{ id: 'writer-b' }, { id: 'planner-a' }] }));
    else response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address();
  if (!address || typeof address !== 'object') throw new Error('upstream did not bind');
  const endpoint = `http://127.0.0.1:${address.port}`;
  const { app } = createApiServer({
    repository: new InMemoryWorkRepository(),
    manageModelSettings: true,
    modelSettingsPath: file,
    writeProcessEnvironment: false,
  });
  const payload = { name: '本地', endpoint, apiKey: secret, planningModel: 'planner-a', writingModel: 'writer-b', timeoutMs: 20_000, independentExtraction: true };
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/settings/model' })).json().configured, false);
    const saved = await app.inject({ method: 'PUT', url: '/settings/model', payload });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().configured, true);
    assert.equal(saved.json().planningConfigured, true);
    assert.equal(saved.json().channels[0].apiKeyHint, 'alue');
    assert.equal(saved.body.includes(secret), false);
    assert.equal((await app.inject({ method: 'GET', url: '/settings/model' })).body.includes(secret), false);
    const channelId = saved.json().savedId as string;

    const kept = await app.inject({ method: 'PUT', url: '/settings/model', payload: { ...payload, id: channelId, apiKey: undefined, writingModel: '' } });
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).channels[0].apiKey, secret, 'an empty key field keeps the stored key');
    assert.equal(kept.json().channels[0].writingModel, '');

    const otherKey = 'sk-other-channel-key1';
    const second = await app.inject({ method: 'PUT', url: '/settings/model', payload: { name: '备用', endpoint: 'http://example.invalid', apiKey: otherKey, planningModel: 'other-model', writingModel: '', timeoutMs: 20_000, independentExtraction: true } });
    const stored = JSON.parse(readFileSync(file, 'utf8')) as { activeId: string; channels: Array<{ id: string; name: string; apiKey: string }> };
    assert.equal(stored.channels.length, 2);
    assert.equal(stored.activeId, channelId, 'saving another channel does not replace the one in use');
    assert.equal(stored.channels.find((channel) => channel.name === '本地')?.apiKey, secret);
    assert.equal(stored.channels.find((channel) => channel.name === '备用')?.apiKey, otherKey);
    assert.equal(stored.channels.find((channel) => channel.name === '备用')?.fallback, true, 'a new channel is a backup by default');
    assert.equal(second.json().channels.find((channel: { name: string }) => channel.name === '备用')?.fallback, true);
    assert.equal(second.body.includes(secret), false);
    assert.equal(second.body.includes(otherKey), false);

    const switched = await app.inject({ method: 'POST', url: '/settings/model/activate', payload: { id: stored.channels.find((channel) => channel.name === '备用')?.id } });
    assert.equal(switched.json().activeId, stored.channels.find((channel) => channel.name === '备用')?.id);
    assert.equal(switched.json().configured, true);
    const back = await app.inject({ method: 'POST', url: '/settings/model/activate', payload: { id: channelId } });
    assert.equal(back.json().activeId, channelId);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).channels.length, 2, 'switching keeps both channels');

    const probed = await app.inject({ method: 'POST', url: '/settings/model/test', payload: { endpoint, apiKey: secret, timeoutMs: 20_000 } });
    assert.equal(probed.json().ok, true, probed.body);
    assert.match(probed.json().message, /2 个模型/);
    const tested = await app.inject({ method: 'POST', url: '/settings/model/test', payload: { ...payload, id: channelId } });
    assert.equal(tested.json().ok, true, tested.body);
    assert.equal(tested.body.includes(secret), false);
    assert.equal(authorization, `Bearer ${secret}`);
    const listed = await app.inject({ method: 'POST', url: '/settings/model/models', payload });
    assert.deepEqual(listed.json().models, ['planner-a', 'writer-b']);

    const work = (await app.inject({ method: 'POST', url: '/works', payload: createPayload('接入后') })).json();
    const readiness = (await app.inject({ method: 'GET', url: `/works/${work.id}/chapters/1/readiness` })).json();
    assert.equal(readiness.modelConfigured, true);
    assert.equal(readiness.blockers.some((blocker: { code: string }) => blocker.code === 'MODEL_NOT_CONFIGURED'), false);
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});