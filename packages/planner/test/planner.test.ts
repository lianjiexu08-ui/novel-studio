import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonDesignPlanner, PlanningParseError } from '../src/index.ts';
import { createEmptyWorldPack } from '../../../novel-service-core/src/world.ts';

const covenant = { entryMode: 'expand' as const, genre: 'xuanhuan' as const, substyle: '宗门成长', audience: '长篇玄幻读者', hook: '以代价换力量', mustKeep: '', lockedNotes: '', avoid: '', targetLength: '百万字', chapterWords: 2200, updateCadence: '日更' };

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
    secrets: [], arcBeats: [], promises: [{ id: 'promise', title: '三年之约', promise: '主角必须赴约', payoffCondition: '第 30 章兑现', status: 'proposed' }], openThreads: [{ id: 'thread', title: '界门来历', kind: 'mystery', question: '谁建造界门', plannedResolution: '终卷揭示', status: 'proposed' }], arcs: [{ id: 'arc', title: '守护', characterIds: ['hero'], goal: '成长', stakes: '故乡', plannedOutcome: '封印' }],
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
