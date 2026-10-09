import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStoryBible, parseWorldPack } from '../src/index.ts';

const createdAt = '2026-10-10T00:00:00.000Z';

test('world pack contract accepts structured power, geography and faction data', () => {
  const world = parseWorldPack({
    id: 'world-1', revision: 1, title: '九霄界', summary: '玄幻世界', status: 'reviewed', createdAt,
    axioms: [{ id: 'axiom-1', title: '灵魂可渡', content: '灵魂可在特定仪式下转移', scope: 'global', precedence: 100, status: 'reviewed' }],
    powerSystems: [{ id: 'qi', name: '灵气体系', source: '天地灵气', unit: '灵力', realmIds: ['qi-1'], status: 'reviewed' }],
    realms: [{ id: 'qi-1', systemId: 'qi', name: '炼气', rank: 1, prerequisites: [], capabilities: ['感知'], cost: '时间', counters: [], status: 'reviewed' }],
    techniques: [], artifacts: [], resources: [], locations: [{ id: 'east', name: '东陆', kind: 'continent', entryConditions: [], status: 'reviewed' }],
    factions: [{ id: 'sect', name: '青云宗', kind: 'sect', locationIds: ['east'], goals: ['守护'], resources: ['灵石'], status: 'reviewed' }],
    historicalEvents: [], terminology: [], unresolvedQuestions: [],
  });
  assert.equal(world.powerSystems[0].realmIds[0], 'qi-1');
});

test('story bible contract requires a conflict and positive volume size', () => {
  assert.throws(() => parseStoryBible({
    id: 'bible-1', revision: 1, worldPackId: 'world-1', worldPackRevision: 1, status: 'proposed', coreConflict: '', endingDirection: '', characters: [], relationships: [], arcs: [],
    volumes: [{ id: 'vol-1', order: 1, title: '第一卷', goal: '', climax: '', endState: '', plannedChapterCount: 0, arcIds: [] }], unresolvedQuestions: [], createdAt,
  }));
});
