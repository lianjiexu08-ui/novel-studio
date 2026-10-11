import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { JsonBookPlanner, JsonDesignPlanner, OpenAICompatibleChapterProvider, PlanningParseError } from '../src/index.ts';
import { minimalPlan } from '../../application/test/fixtures.ts';
import { NovelService } from '../../../novel-service-core/src/core.ts';
import { createEmptyWorldPack } from '../../../novel-service-core/src/world.ts';

const covenant = { entryMode: 'expand' as const, genre: 'xuanhuan' as const, substyle: '宗门成长', audience: '长篇玄幻读者', hook: '以代价换力量', mustKeep: '', lockedNotes: '', avoid: '', targetLength: '百万字', chapterWords: 2200, updateCadence: '日更' };

test('network chapter provider performs an independent extraction pass', async () => {
  let calls = 0;
  const event = { eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: 'realm-1', evidence: '正文明确写出境界变化' };
  const server = createServer(async (_request, response) => {
    calls += 1;
    const body = calls === 1
      ? { content: '这一章正文', proposedEvents: [event] }
      : { observedEvents: [event] };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost_usd: 0 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const provider = new OpenAICompatibleChapterProvider(`http://127.0.0.1:${address.port}`, 'test-key', 'test-model', 10, 5_000, true);
    const service = new NovelService(provider);
    const work = service.createWork('独立抽取', covenant);
    const candidate = await service.generateCandidateAsync(work.id, 1, 'extract-run');
    assert.equal(calls, 2);
    assert.deepEqual(candidate.observedEvents, [event]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('network chapter provider promotes audited facts omitted by the writer', async () => {
  let calls = 0;
  const event = { eventType: 'plot_progress', subjectId: 'chapter-1', predicate: 'status', value: { status: 'realized' }, evidence: '正文完成章纲目标' };
  const server = createServer(async (_request, response) => {
    calls += 1;
    const body = calls === 1 ? { content: '这一章正文', proposedEvents: [] } : { observedEvents: [event] };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost_usd: 0 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const provider = new OpenAICompatibleChapterProvider(`http://127.0.0.1:${address.port}`, 'test-key', 'test-model', 10, 5_000, true);
    const service = new NovelService(provider);
    const work = service.createWork('审计补全', covenant);
    const candidate = await service.generateCandidateAsync(work.id, 1, 'audit-run');
    assert.deepEqual(candidate.proposedEvents, [event]);
    assert.deepEqual(candidate.observedEvents, [event]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('network chapter provider rejects truncated JSON instead of saving it as prose', async () => {
  let calls = 0;
  const server = createServer(async (_request, response) => {
    calls += 1;
    // Both the draft and repair responses look like a JSON object but are
    // truncated. They must never be accepted as chapter text.
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: '{"content":"截断正文' } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost_usd: 0 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const provider = new OpenAICompatibleChapterProvider(`http://127.0.0.1:${address.port}`, 'test-key', 'test-model', 10, 5_000, false);
    const service = new NovelService(provider);
    const work = service.createWork('截断章节', covenant);
    await assert.rejects(() => provider.generateChapterAsync({
      work,
      chapterNumber: 1,
      context: {
        workId: work.id, chapterNumber: 1, stateRevision: 0, constraintRevision: 0,
        adoptedVersionIds: [], includedEventIds: [], requiredMaterialStatus: 'complete',
        omittedOptionalMaterial: [], estimatedTokens: 0, contextBudget: 10_000,
        canonHash: 'canon', stateHash: 'state', createdAt: new Date().toISOString(),
      },
    }), /planner JSON is invalid|did not contain a JSON object/);
    assert.equal(calls, 2, 'one repair attempt is made before rejecting malformed output');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('network chapter provider escapes raw controls inside chapter JSON', async () => {
  const server = createServer(async (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    // Deliberately place a literal newline inside the JSON content string.
    response.end(JSON.stringify({ choices: [{ message: { content: '{"content":"第一行\n第二行","proposedEvents":[]}' } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const provider = new OpenAICompatibleChapterProvider(`http://127.0.0.1:${address.port}`, 'test-key', 'test-model', 10, 5_000, false);
    const service = new NovelService(provider);
    const work = service.createWork('控制字符章节', covenant);
    const result = await provider.generateChapterAsync({
      work,
      chapterNumber: 1,
      context: {
        workId: work.id, chapterNumber: 1, stateRevision: 0, constraintRevision: 0,
        adoptedVersionIds: [], includedEventIds: [], requiredMaterialStatus: 'complete',
        omittedOptionalMaterial: [], estimatedTokens: 0, contextBudget: 10_000,
        canonHash: 'canon', stateHash: 'state', createdAt: new Date().toISOString(),
      },
    });
    assert.equal(result.content, '第一行\n第二行');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('planner validates structured world pack responses', async () => {
  const response = {
    id: 'world-1', revision: 1, title: '九霄', summary: '三大陆', status: 'proposed',
    axioms: [{ id: 'a', title: '因果', content: '有代价', scope: 'all', precedence: 1, status: 'proposed' }],
    powerSystems: [{ id: 'p', name: '灵力', source: '天地', unit: '灵力', realmIds: ['r'], status: 'proposed' }],
    realms: ['r', 'r2', 'r3'].map((id, index) => ({ id, systemId: 'p', name: `境界${index + 1}`, rank: index + 1, prerequisites: [], capabilities: ['引气'], cost: '时间', counters: [], status: 'proposed' })),
    techniques: ['t', 't2', 't3'].map((id) => ({ id, name: '引气诀' + id, kind: 'cultivation' as const, allowedRealmIds: ['r'], effect: '引气', cost: '灵力', limitations: [], counters: [], status: 'proposed' as const })),
    artifacts: ['i', 'i2', 'i3'].map((id) => ({ id, name: '灵剑' + id, tier: '一阶', effect: '增幅', cost: '灵石', limitations: [], status: 'proposed' as const })),
    resources: ['res', 'res2', 'res3'].map((id) => ({ id, name: '灵石' + id, unit: '枚', source: '矿脉', scarcity: '常见', status: 'proposed' as const })),
    locations: ['l', 'l2', 'l3'].map((id) => ({ id, name: '东陆' + id, kind: 'continent' as const, entryConditions: [], status: 'proposed' as const })),
    factions: ['f', 'f2', 'f3'].map((id, index) => ({ id, name: '宗门' + id, kind: 'sect' as const, locationIds: ['l'], goals: ['守护' + index], resources: ['res'], status: 'proposed' as const })),
    historicalEvents: ['h', 'h2', 'h3'].map((id) => ({ id, title: '立宗' + id, storyTime: '百年前', causes: ['动荡'], consequences: ['建宗'], factionIds: ['f'], status: 'proposed' as const })),
    terminology: [{ id: 'term', canonical: '灵气', aliases: [], kind: 'other' as const, status: 'proposed' as const }], unresolvedQuestions: [], createdAt: new Date().toISOString(),
  };
  Object.assign(response, {
    tierLadders: ['realm', 'technique', 'artifact', 'resource'].map((kind) => ({ id: `${kind}-tiers`, kind, name: `${kind}等级`, levels: ['一阶', '二阶', '三阶', '四阶', '五阶', '六阶'], rule: '跨级需要对应资源与代价', status: 'proposed' })),
    realms: Array.from({ length: 8 }, (_, index) => ({ id: index === 0 ? 'r' : `r${index + 1}`, systemId: 'p', name: `境界${index + 1}`, rank: index + 1, prerequisites: [], capabilities: ['引气'], cost: '时间', counters: [], status: 'proposed' })),
    techniques: Array.from({ length: 15 }, (_, index) => ({ id: index < 3 ? ['t', 't2', 't3'][index] : `t${index + 1}`, name: `引气诀${index + 1}`, kind: 'cultivation', tier: `${(index % 6) + 1}阶`, allowedRealmIds: ['r'], effect: '引气', cost: '灵力', limitations: [], counters: [], status: 'proposed' })),
    artifacts: Array.from({ length: 12 }, (_, index) => ({ id: index < 3 ? ['i', 'i2', 'i3'][index] : `i${index + 1}`, name: `灵剑${index + 1}`, tier: `${(index % 6) + 1}阶`, effect: '增幅', cost: '灵石', limitations: [], status: 'proposed' })),
    resources: Array.from({ length: 10 }, (_, index) => ({ id: index < 3 ? ['res', 'res2', 'res3'][index] : `res${index + 1}`, name: `灵石${index + 1}`, unit: '枚', source: '矿脉', scarcity: '常见', tier: `${(index % 6) + 1}阶`, status: 'proposed' })),
    locations: Array.from({ length: 9 }, (_, index) => ({ id: index < 3 ? ['l', 'l2', 'l3'][index] : `l${index + 1}`, name: `大陆${index + 1}`, kind: 'continent', entryConditions: [], status: 'proposed' })),
    factions: Array.from({ length: 6 }, (_, index) => ({ id: index < 3 ? ['f', 'f2', 'f3'][index] : `f${index + 1}`, name: `宗门${index + 1}`, kind: 'sect', locationIds: ['l'], goals: [`守护${index}`], resources: ['res'], status: 'proposed' })),
    historicalEvents: Array.from({ length: 10 }, (_, index) => ({ id: index < 3 ? ['h', 'h2', 'h3'][index] : `h${index + 1}`, title: `立宗${index + 1}`, storyTime: '百年前', causes: ['动荡'], consequences: ['建宗'], factionIds: ['f'], status: 'proposed' })),
  });
  const planner = new JsonDesignPlanner({ complete: async () => JSON.stringify(response) });
  const world = await planner.generateWorldPack({ title: '试作', covenant });
  assert.equal(world.powerSystems[0].realmIds[0], 'r');

  const broken = { ...response, axioms: [{ id: 'a', name: '因果', description: '有代价' }] };
  const requests: string[] = [];
  const repairing = new JsonDesignPlanner({ complete: async ({ user }) => { requests.push(user); return JSON.stringify(requests.length === 1 ? broken : response); } });
  const repaired = await repairing.generateWorldPack({ title: '试作', covenant });
  assert.equal(repaired.axioms[0].title, '因果');
  assert.equal(requests.length, 2, 'a malformed world pack gets exactly one repair round');
  const repairRequest = JSON.parse(requests[1]);
  assert.equal(repairRequest.task, 'repair_previous_output');
  assert.match(repairRequest.problems, /axioms\.0\.title/);

  const stubborn = new JsonDesignPlanner({ complete: async () => JSON.stringify(broken) });
  await assert.rejects(() => stubborn.generateWorldPack({ title: '试作', covenant }), (error) => error instanceof PlanningParseError && /axioms\.0\.title/.test(error.message));
});

test('planner rejects non-JSON model output', async () => {
  const planner = new JsonDesignPlanner({ complete: async () => 'not json' });
  await assert.rejects(() => planner.generateWorldPack({ title: '试作', covenant }), PlanningParseError);
});

test('world pack is assembled from dependent stages instead of one giant response', async () => {
  const base = {
    id: 'staged-world', revision: 1, title: '分阶段九霄', summary: '规则先行', status: 'proposed', createdAt: new Date().toISOString(),
    axioms: [{ id: 'axiom', title: '因果有价', content: '力量有代价', scope: 'all', precedence: 1, status: 'proposed' }],
    powerSystems: [{ id: 'power', name: '灵力', source: '天地', unit: '灵力', realmIds: ['realm-1', 'realm-2', 'realm-3', 'realm-4', 'realm-5', 'realm-6', 'realm-7', 'realm-8'], status: 'proposed' }],
    tierLadders: ['realm', 'technique', 'artifact', 'resource'].map((kind) => ({ id: `${kind}-ladder`, kind, name: kind, levels: ['一阶', '二阶', '三阶', '四阶', '五阶', '六阶'], rule: '逐阶支付代价', status: 'proposed' })),
    realms: Array.from({ length: 8 }, (_, i) => ({ id: `realm-${i + 1}`, systemId: 'power', name: `境界${i + 1}`, rank: i + 1, prerequisites: [], capabilities: ['能力'], cost: '代价', counters: [], status: 'proposed' })),
    terminology: [{ id: 'term-qi', canonical: '灵力', aliases: [], kind: 'other', status: 'proposed' }], unresolvedQuestions: [],
  };
  const stages = [
    base,
    { locations: Array.from({ length: 9 }, (_, i) => ({ id: `loc-${i}`, name: `大陆${i}`, kind: 'continent', entryConditions: [], status: 'proposed' })), factions: Array.from({ length: 6 }, (_, i) => ({ id: `fac-${i}`, name: `势力${i}`, kind: 'sect', locationIds: ['loc-0'], goals: ['博弈'], resources: ['resource-0'], status: 'proposed' })), terminology: [], unresolvedQuestions: [] },
    { techniques: Array.from({ length: 15 }, (_, i) => ({ id: `tech-${i}`, name: `功法${i}`, kind: 'technique', tier: '一阶', allowedRealmIds: ['realm-1'], effect: '效果', cost: '代价', limitations: [], counters: [], status: 'proposed' })), artifacts: Array.from({ length: 12 }, (_, i) => ({ id: `artifact-${i}`, name: `法宝${i}`, tier: '一阶', effect: '效果', cost: '代价', limitations: [], status: 'proposed' })), resources: Array.from({ length: 10 }, (_, i) => ({ id: `resource-${i}`, name: `资源${i}`, unit: '枚', source: '矿脉', scarcity: '稀缺', tier: '一阶', status: 'proposed' })), terminology: [], unresolvedQuestions: [] },
    { historicalEvents: Array.from({ length: 10 }, (_, i) => ({ id: `history-${i}`, title: `历史${i}`, storyTime: '远古', causes: ['冲突'], consequences: ['余波'], factionIds: ['fac-0'], status: 'proposed' })), terminology: [], unresolvedQuestions: [] },
  ];
  let calls = 0;
  const planner = new JsonDesignPlanner({ complete: async () => JSON.stringify(stages[calls++]) });
  const world = await planner.generateWorldPack({ title: '分阶段', covenant });
  assert.equal(calls, 4);
  assert.equal(world.factions.length, 6);
  assert.equal(world.techniques.length, 15);
  assert.equal(world.tierLadders?.length, 4);
});

test('planner rejects a story bible that cannot support the 100-chapter milestone', async () => {
  const response = {
    id: 'bible-1', revision: 1, worldPackId: 'world-1', worldPackRevision: 1, status: 'proposed',
    coreConflict: '界门战争', endingDirection: '付出代价封印界门',
    characters: [{ id: 'hero', name: '主角', role: 'protagonist', goal: '守护故乡', identity: '弟子' }],
    relationships: [{ id: 'rel', fromCharacterId: 'hero', toCharacterId: 'rival', kind: 'trust', value: '戒备', locked: false }],
    secrets: [{ id: 'secret', ownerCharacterId: 'hero', title: '遗印', truth: '主角体内有遗印', revealCondition: '第 40 章揭示', status: 'proposed' }], arcBeats: Array.from({ length: 9 }, (_, index) => ({ id: 'beat-' + (index + 1), arcId: 'arc', characterId: 'hero', kind: 'trigger', plannedChapter: [10, 25, 40, 50, 60, 70, 80, 90, 100][index], expectedChange: '主线推进 ' + (index + 1) })), promises: [{ id: 'promise', title: '三年之约', promise: '主角必须赴约', payoffCondition: '第 30 章兑现', status: 'proposed' }], openThreads: [{ id: 'thread', title: '界门来历', kind: 'mystery', question: '谁建造界门', plannedResolution: '终卷揭示', status: 'proposed' }], arcs: [{ id: 'arc', title: '守护', characterIds: ['hero'], goal: '成长', stakes: '故乡', plannedOutcome: '封印' }],
    volumes: [1, 2, 3].map((order) => ({ id: 'v' + order, order, title: '第' + order + '卷', goal: '推进', climax: '决战', endState: '继续', plannedChapterCount: order === 1 ? 34 : 33, arcIds: ['arc'] })),
    chapterPlans: Array.from({ length: 50 }, (_, index) => ({ id: `chapter-plan-${index + 1}`, chapterNumber: index + 1, title: `开篇第${index + 1}章`, purpose: '推进主线', conflict: '界门威胁升级', turningPoint: '获得新线索', endHook: '新的悬念', characterIds: ['hero'], locationIds: [], arcBeatIds: [], requiredEvents: [] })),
    unresolvedQuestions: [], createdAt: new Date().toISOString(),
  };
  const planner = new JsonDesignPlanner({ complete: async () => JSON.stringify(response) });
  const bible = await planner.generateStoryBible({ title: '试作', covenant, worldPack: createEmptyWorldPack('九霄') });
  assert.equal(bible.volumes.length, 3);
  assert.equal(bible.volumes.reduce((sum, volume) => sum + volume.plannedChapterCount, 0), 100);

  const tooShort = new JsonDesignPlanner({ complete: async () => JSON.stringify({ ...response, volumes: [response.volumes[0]] }) });
  await assert.rejects(() => tooShort.generateStoryBible({ title: '试作', covenant, worldPack: createEmptyWorldPack('九霄') }), PlanningParseError);

  const expanding = new JsonDesignPlanner({ complete: async () => JSON.stringify(response) });
  const expanded = await expanding.generateStoryBible({ title: '试作', covenant, worldPack: { ...createEmptyWorldPack('九霄'), id: 'world-1', revision: 2 }, previousStoryBible: response as never });
  assert.equal(expanded.revision, 2);
  const dropped = new JsonDesignPlanner({ complete: async () => JSON.stringify({ ...response, characters: [response.characters[0]] }) });
  const previousWithExtra = { ...response, characters: [...response.characters, { id: 'rival', name: '对手', role: 'major', goal: '', identity: '' }] };
  await assert.rejects(() => dropped.generateStoryBible({ title: '试作', covenant, worldPack: { ...createEmptyWorldPack('九霄'), id: 'world-1' }, previousStoryBible: previousWithExtra as never }), /dropped stable IDs/);
});

test('book planner checks the skeleton scale and that every outline in the group is present', async () => {
  const { chapters, ...skeleton } = minimalPlan(30, { volumeSize: 10, outlined: 30 });
  const base = { title: '试作', covenant, adoptedFacts: { reachedChapter: 0 } };
  const planner = new JsonBookPlanner({ complete: async () => JSON.stringify(skeleton) });
  assert.equal((await planner.generatePlanSkeleton({ ...base, targetChapterCount: 30, volumeCount: 3 })).volumes.length, 3);
  await assert.rejects(() => planner.generatePlanSkeleton({ ...base, targetChapterCount: 450, volumeCount: 3 }), PlanningParseError);

  const prompts: string[] = [];
  const outliner = new JsonBookPlanner({ complete: async ({ user }) => { prompts.push(user); return JSON.stringify({ chapters: chapters.slice(10, 20) }); } });
  const outlines = await outliner.generateChapterOutlines({ ...base, skeleton, from: 11, to: 20, before: chapters.slice(0, 10), after: [] });
  assert.deepEqual(outlines.map((outline) => outline.chapterNumber), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.ok(outlines.every((outline) => outline.source === 'model'));
  assert.equal(JSON.parse(prompts[0]).previousOutlines.length, 10);

  const gappy = new JsonBookPlanner({ complete: async () => JSON.stringify(chapters.slice(10, 19)) });
  await assert.rejects(() => gappy.generateChapterOutlines({ ...base, skeleton, from: 11, to: 20, before: [], after: [] }), /missing chapters 20/);
});
