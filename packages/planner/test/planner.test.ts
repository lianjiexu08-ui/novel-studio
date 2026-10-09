import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonDesignPlanner, PlanningParseError } from '../src/index.ts';

const covenant = { entryMode: 'expand' as const, genre: 'xuanhuan' as const, substyle: '宗门成长', audience: '长篇玄幻读者', hook: '以代价换力量', mustKeep: '', lockedNotes: '', avoid: '', targetLength: '百万字', chapterWords: 2200, updateCadence: '日更' };

test('planner validates structured world pack responses', async () => {
  const planner = new JsonDesignPlanner({ complete: async () => JSON.stringify({
    id: 'world-1', revision: 1, title: '九霄', summary: '三大陆', status: 'proposed',
    axioms: [{ id: 'a', title: '因果', content: '有代价', scope: 'all', precedence: 1, status: 'proposed' }],
    powerSystems: [{ id: 'p', name: '灵力', source: '天地', unit: '灵力', realmIds: ['r'], status: 'proposed' }],
    realms: [{ id: 'r', systemId: 'p', name: '炼气', rank: 1, prerequisites: [], capabilities: ['引气'], cost: '时间', counters: [], status: 'proposed' }],
    techniques: [{ id: 't', name: '引气诀', kind: 'cultivation', allowedRealmIds: ['r'], effect: '引气', cost: '灵力', limitations: [], counters: [], status: 'proposed' }],
    artifacts: [{ id: 'i', name: '灵剑', tier: '一阶', effect: '增幅', cost: '灵石', limitations: [], status: 'proposed' }],
    resources: [{ id: 'res', name: '灵石', unit: '枚', source: '矿脉', scarcity: '常见', status: 'proposed' }],
    locations: [{ id: 'l', name: '东陆', kind: 'continent', entryConditions: [], status: 'proposed' }],
    factions: [{ id: 'f', name: '宗门', kind: 'sect', locationIds: ['l'], goals: ['守护'], resources: ['res'], status: 'proposed' }],
    historicalEvents: [{ id: 'h', title: '立宗', storyTime: '百年前', causes: ['动荡'], consequences: ['建宗'], factionIds: ['f'], status: 'proposed' }],
    terminology: [{ id: 'term', canonical: '灵气', aliases: [], kind: 'other', status: 'proposed' }], unresolvedQuestions: [], createdAt: new Date().toISOString(),
  }) });
  const world = await planner.generateWorldPack({ title: '试作', covenant });
  assert.equal(world.powerSystems[0].realmIds[0], 'r');
});

test('planner rejects non-JSON model output', async () => {
  const planner = new JsonDesignPlanner({ complete: async () => 'not json' });
  await assert.rejects(() => planner.generateWorldPack({ title: '试作', covenant }), PlanningParseError);
});
