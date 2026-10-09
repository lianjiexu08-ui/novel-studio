import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chapterGenerationGate,
  createEmptyWorldPack,
  lockStoryBible,
  lockWorldPack,
  reviewStoryBible,
  reviewWorldPack,
  type StoryBible,
  validateStoryBible,
  validateWorldPack,
} from '../src/world.ts';

function reviewedWorld() {
  const world = createEmptyWorldPack('九霄界', '有九个界域的玄幻世界');
  world.status = 'reviewed';
  world.axioms.push({ id: 'axiom', title: '因果有价', content: '力量必须支付代价', scope: 'all', precedence: 1, status: 'reviewed' });
  world.powerSystems.push({ id: 'qi', name: '灵气体系', source: '天地灵气', unit: '灵力', realmIds: ['qi-1', 'qi-2'], status: 'reviewed' });
  world.realms.push(
    { id: 'qi-1', systemId: 'qi', name: '炼气', rank: 1, prerequisites: [], capabilities: ['感知灵气'], cost: '修炼时间', counters: [], status: 'reviewed' },
    { id: 'qi-2', systemId: 'qi', name: '筑基', rank: 2, prerequisites: ['qi-1'], capabilities: ['御器'], cost: '筑基资源', counters: [], status: 'reviewed' },
  );
  world.locations.push({ id: 'east', name: '东陆', kind: 'continent', entryConditions: [], status: 'reviewed' });
  world.factions.push({ id: 'sect', name: '青云宗', kind: 'sect', locationIds: ['east'], goals: ['守护东陆'], resources: ['灵石'], status: 'reviewed' });
  world.techniques.push({ id: 'sword', name: '青云剑诀', kind: 'technique', allowedRealmIds: ['qi-1', 'qi-2'], effect: '御剑', cost: '灵力', limitations: [], counters: [], status: 'reviewed' });
  world.artifacts.push({ id: 'sword-artifact', name: '青云剑', tier: '一阶', effect: '增幅御剑', cost: '灵石', limitations: [], status: 'reviewed' });
  world.resources.push({ id: 'spirit-stone', name: '灵石', unit: '枚', source: '矿脉', scarcity: '常见', status: 'reviewed' });
  world.historicalEvents.push({ id: 'founding', title: '青云宗立宗', storyTime: '三百年前', causes: ['界域动荡'], consequences: ['建立宗门'], factionIds: ['sect'], status: 'reviewed' });
  world.terminology.push({ id: 'term-qi', canonical: '灵气', aliases: ['天地灵气'], kind: 'other', status: 'reviewed' });
  return world;
}

function reviewedBible(worldPackId: string, worldPackRevision: number): StoryBible {
  return {
    id: 'bible-1', revision: 1, worldPackId, worldPackRevision, status: 'reviewed', coreConflict: '主角必须阻止界域战争', endingDirection: '战争结束但需要付出代价',
    characters: [
      { id: 'hero', name: '林渊', role: 'protagonist', goal: '保护故乡', identity: '青云宗外门弟子', factionId: 'sect', locationId: 'east', startingRealmId: 'qi-1' },
      { id: 'rival', name: '沈烬', role: 'major', goal: '夺取界门', identity: '未知', factionId: 'sect', locationId: 'east', startingRealmId: 'qi-2' },
    ],
    relationships: [{ id: 'rel-1', fromCharacterId: 'hero', toCharacterId: 'rival', kind: 'trust', value: '互相戒备', locked: false }],
    arcs: [{ id: 'arc-1', title: '守护故乡', characterIds: ['hero'], goal: '理解代价', stakes: '故乡存亡', plannedOutcome: '主动承担代价' }],
    volumes: [{ id: 'vol-1', order: 1, title: '东陆风云', goal: '发现界门阴谋', climax: '宗门大战', endState: '踏入界门', plannedChapterCount: 30, arcIds: ['arc-1'] }],
    unresolvedQuestions: [], createdAt: new Date().toISOString(),
  };
}

test('world pack validates references before it can be locked', () => {
  const world = reviewedWorld();
  assert.equal(validateWorldPack(world).ready, true);
  const locked = lockWorldPack(world);
  assert.equal(locked.status, 'locked');
  assert.equal(locked.revision, 2);
});

test('review transitions a proposed design only after structural validation', () => {
  const world = reviewedWorld();
  world.status = 'proposed';
  const reviewed = reviewWorldPack(world);
  assert.equal(reviewed.status, 'reviewed');
  assert.equal(reviewed.revision, world.revision + 1);
  const bible = reviewedBible(reviewed.id, reviewed.revision);
  bible.status = 'proposed';
  const reviewedBiblePack = reviewStoryBible(bible, reviewed);
  assert.equal(reviewedBiblePack.status, 'reviewed');
  assert.equal(reviewedBiblePack.revision, bible.revision + 1);
});

test('world pack rejects location cycles and unknown power references', () => {
  const world = reviewedWorld();
  world.locations.push({ id: 'a', name: '甲', kind: 'region', parentId: 'b', entryConditions: [], status: 'reviewed' });
  world.locations.push({ id: 'b', name: '乙', kind: 'region', parentId: 'a', entryConditions: [], status: 'reviewed' });
  world.techniques[0].allowedRealmIds.push('missing');
  const result = validateWorldPack(world);
  assert.equal(result.ready, false);
  assert.ok(result.errors.some((error) => error.includes('parent cycle')));
  assert.ok(result.errors.some((error) => error.includes('unknown realm')));
});

test('story bible cannot lock before the world pack is locked', () => {
  const world = reviewedWorld();
  const bible = reviewedBible(world.id, 1);
  assert.equal(validateStoryBible(bible, world).ready, true);
  assert.throws(() => lockStoryBible(bible, world), /world pack must be locked/);
});

test('chapter generation requires matching locked world and story bible revisions', () => {
  const world = lockWorldPack(reviewedWorld());
  const bible = lockStoryBible(reviewedBible(world.id, world.revision), world);
  assert.equal(chapterGenerationGate(world, bible, 'vol-1').ready, true);
  const staleBible = { ...bible, worldPackRevision: world.revision - 1 };
  assert.equal(chapterGenerationGate(world, staleBible, 'vol-1').ready, false);
  assert.ok(chapterGenerationGate(world, staleBible, 'vol-1').errors.some((error) => error.includes('current world pack revision')));
});

test('chapter generation revalidates locked design data instead of trusting status flags', () => {
  const world = createEmptyWorldPack('空壳', '伪造的锁定包');
  world.status = 'locked';
  const bible: StoryBible = {
    id: 'fake-bible', revision: 1, worldPackId: world.id, worldPackRevision: world.revision, status: 'locked',
    coreConflict: '冲突', endingDirection: '结局', characters: [{ id: 'hero', name: '主角', role: 'protagonist', goal: '活下去', identity: '凡人' }],
    relationships: [{ id: 'rel', fromCharacterId: 'hero', toCharacterId: 'hero', kind: 'belief', value: '自己', locked: false }], arcs: [{ id: 'arc', title: '求生', characterIds: ['hero'], goal: '活下去', stakes: '性命', plannedOutcome: '活下去' }],
    volumes: [{ id: 'v1', order: 1, title: '开端', goal: '求生', climax: '逃生', endState: '启程', plannedChapterCount: 10, arcIds: ['arc'] }], unresolvedQuestions: [], createdAt: new Date().toISOString(),
  };
  const result = chapterGenerationGate(world, bible);
  assert.equal(result.ready, false);
  assert.ok(result.errors.some((error) => error.includes('world pack requires')));
  assert.ok(result.errors.some((error) => error.includes('cannot connect a character to itself')));
});
