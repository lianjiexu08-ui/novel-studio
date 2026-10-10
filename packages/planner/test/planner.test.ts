import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { JsonDesignPlanner, OpenAICompatibleChapterProvider, PlanningParseError } from '../src/index.ts';
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
  const planner = new JsonDesignPlanner({ complete: async () => JSON.stringify(response) });
  const world = await planner.generateWorldPack({ title: '试作', covenant });
  assert.equal(world.powerSystems[0].realmIds[0], 'r');
});

test('planner rejects non-JSON model output', async () => {
  const planner = new JsonDesignPlanner({ complete: async () => 'not json' });
  await assert.rejects(() => planner.generateWorldPack({ title: '试作', covenant }), PlanningParseError);
});

test('planner rejects a story bible that cannot support the 100-chapter milestone', async () => {
  const response = {
    id: 'bible-1', revision: 1, worldPackId: 'world-1', worldPackRevision: 1, status: 'proposed',
    coreConflict: '界门战争', endingDirection: '付出代价封印界门',
    characters: [{ id: 'hero', name: '主角', role: 'protagonist', goal: '守护故乡', identity: '弟子' }],
    relationships: [{ id: 'rel', fromCharacterId: 'hero', toCharacterId: 'rival', kind: 'trust', value: '戒备', locked: false }],
    secrets: [{ id: 'secret', ownerCharacterId: 'hero', title: '遗印', truth: '主角体内有遗印', revealCondition: '第 40 章揭示', status: 'proposed' }], arcBeats: [{ id: 'beat', arcId: 'arc', characterId: 'hero', kind: 'trigger', plannedChapter: 2, expectedChange: '决定修行' }], promises: [{ id: 'promise', title: '三年之约', promise: '主角必须赴约', payoffCondition: '第 30 章兑现', status: 'proposed' }], openThreads: [{ id: 'thread', title: '界门来历', kind: 'mystery', question: '谁建造界门', plannedResolution: '终卷揭示', status: 'proposed' }], arcs: [{ id: 'arc', title: '守护', characterIds: ['hero'], goal: '成长', stakes: '故乡', plannedOutcome: '封印' }],
    volumes: [1, 2, 3].map((order) => ({ id: 'v' + order, order, title: '第' + order + '卷', goal: '推进', climax: '决战', endState: '继续', plannedChapterCount: order === 1 ? 34 : 33, arcIds: ['arc'] })),
    unresolvedQuestions: [], createdAt: new Date().toISOString(),
  };
  const planner = new JsonDesignPlanner({ complete: async () => JSON.stringify(response) });
  const bible = await planner.generateStoryBible({ title: '试作', covenant, worldPack: createEmptyWorldPack('九霄') });
  assert.equal(bible.volumes.length, 3);
  assert.equal(bible.volumes.reduce((sum, volume) => sum + volume.plannedChapterCount, 0), 100);

  const tooShort = new JsonDesignPlanner({ complete: async () => JSON.stringify({ ...response, volumes: [response.volumes[0]] }) });
  await assert.rejects(() => tooShort.generateStoryBible({ title: '试作', covenant, worldPack: createEmptyWorldPack('九霄') }), PlanningParseError);
});
