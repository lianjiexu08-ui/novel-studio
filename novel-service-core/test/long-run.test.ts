import test from 'node:test';
import assert from 'node:assert/strict';
import { closureCoverageFor, NovelService, passChecker } from '../src/core.ts';
import { lockStoryBible, lockWorldPack } from '../src/world.ts';
import type { StoryBible, WorldPack } from '../src/world.ts';

const provider = {
  generateChapter: ({ chapterNumber }: { chapterNumber: number }) => {
    const event = { eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: chapterNumber, storyTime: chapterNumber, evidence: 'paragraph 1' };
    const events = [event];
    if (chapterNumber === 90) events.push({ eventType: 'secret_reveal', subjectId: 'secret', predicate: 'revealed', value: true, evidence: '战争遗印真相揭示' });
    if (chapterNumber === 95) events.push({ eventType: 'thread_resolution', subjectId: 'thread', predicate: 'status', value: { status: 'resolved' }, evidence: '界门来历得到解释' });
    if (chapterNumber === 98) events.push({ eventType: 'promise_payoff', subjectId: 'promise', predicate: 'status', value: { status: 'paid' }, evidence: '三年之约兑现' });
    if (chapterNumber === 100) events.push({ eventType: 'arc_progress', subjectId: 'arc', predicate: 'status', value: { status: 'resolved' }, evidence: '共同封印界门' });
    if (chapterNumber === 30) events.push({ eventType: 'volume_progress', subjectId: 'vol-1', predicate: 'status', value: { status: 'resolved' }, evidence: '东陆危机完成' });
    if (chapterNumber === 65) events.push({ eventType: 'volume_progress', subjectId: 'vol-2', predicate: 'status', value: { status: 'resolved' }, evidence: '诸域争锋完成' });
    if (chapterNumber === 100) events.push({ eventType: 'volume_progress', subjectId: 'vol-3', predicate: 'status', value: { status: 'resolved' }, evidence: '界门终局完成' });
    return { content: `第${chapterNumber}章：主角继续推进主线。`, proposedEvents: events, observedEvents: events };
  },
};

function lockedDesign(): { world: WorldPack; bible: StoryBible } {
  const draft: WorldPack = {
    id: 'world-long', revision: 1, title: '九霄长篇世界', summary: '三大陆、九境界与宗门帝国并立', status: 'reviewed',
    axioms: [{ id: 'axiom', title: '因果有价', content: '力量必须支付代价', scope: 'all', precedence: 1, status: 'reviewed' }],
    powerSystems: [{ id: 'qi', name: '灵力体系', source: '天地灵气', unit: '灵力', realmIds: ['qi1', 'qi2', 'qi3'], status: 'reviewed' }],
    realms: [
      { id: 'qi1', systemId: 'qi', name: '炼气', rank: 1, prerequisites: [], capabilities: ['感知灵气'], cost: '修炼时间', counters: [], status: 'reviewed' },
      { id: 'qi2', systemId: 'qi', name: '筑基', rank: 2, prerequisites: ['qi1'], capabilities: ['御器'], cost: '筑基资源', counters: ['炼气'], status: 'reviewed' },
      { id: 'qi3', systemId: 'qi', name: '金丹', rank: 3, prerequisites: ['qi2'], capabilities: ['神识'], cost: '雷劫', counters: ['筑基'], status: 'reviewed' },
    ],
    techniques: [1, 2, 3].map((n) => ({ id: `tech-${n}`, name: `青云剑诀${n}`, kind: 'technique' as const, allowedRealmIds: ['qi1', 'qi2'], effect: '御剑', cost: '灵力', limitations: ['需要剑器'], counters: [], status: 'reviewed' as const })),
    artifacts: [1, 2, 3].map((n) => ({ id: `artifact-${n}`, name: `青云剑${n}`, tier: `${n}阶`, effect: '增幅御剑', cost: '灵石', limitations: ['不可离主'], status: 'reviewed' as const })),
    resources: [1, 2, 3].map((n) => ({ id: `resource-${n}`, name: `灵石${n}`, unit: '枚', source: '矿脉', scarcity: '常见', status: 'reviewed' as const })),
    locations: [{ id: 'east', name: '东陆', kind: 'continent', entryConditions: [], status: 'reviewed' }, { id: 'north', name: '北陆', kind: 'continent', entryConditions: [], status: 'reviewed' }, { id: 'west', name: '西陆', kind: 'continent', entryConditions: [], status: 'reviewed' }, { id: 'sect-city', name: '青云城', kind: 'city', parentId: 'east', entryConditions: [], status: 'reviewed' }],
    factions: [1, 2, 3].map((n) => ({ id: `faction-${n}`, name: `青云势力${n}`, kind: 'sect' as const, locationIds: ['east', 'sect-city'], goals: ['守护东陆'], resources: ['resource-1'], status: 'reviewed' as const })),
    historicalEvents: [1, 2, 3].map((n) => ({ id: `history-${n}`, title: `界门战争${n}`, storyTime: `${300 - n * 10}年前`, causes: ['势力争夺'], consequences: ['界门封印'], factionIds: ['faction-1'], status: 'reviewed' as const })),
    terminology: [{ id: 'term', canonical: '灵气', aliases: ['天地灵气'], kind: 'other', status: 'reviewed' }],
    unresolvedQuestions: [], createdAt: new Date().toISOString(),
  };
  const world = lockWorldPack(draft);
  const bibleDraft: StoryBible = {
    id: 'bible-long', revision: 1, worldPackId: world.id, worldPackRevision: world.revision, status: 'reviewed',
    coreConflict: '主角必须阻止界门战争重启', endingDirection: '封印界门并承担失去力量的代价',
    characters: [
      { id: 'hero', name: '林渊', role: 'protagonist', goal: '守护故乡', identity: '青云宗弟子', locationId: 'sect-city', factionId: 'faction-1', startingRealmId: 'qi1' },
      { id: 'rival', name: '沈烬', role: 'major', goal: '打开界门', identity: '战争遗族', locationId: 'east', factionId: 'faction-1', startingRealmId: 'qi2' },
    ],
    relationships: [{ id: 'relationship', fromCharacterId: 'hero', toCharacterId: 'rival', kind: 'trust', value: '互相戒备', locked: false }],
    secrets: [{ id: 'secret', ownerCharacterId: 'rival', title: '战争遗印', truth: '沈烬携带战争遗印', revealCondition: '界门开启时揭示', status: 'reviewed' }],
    arcBeats: [3, 15, 28, 40, 52, 65, 75, 88, 98].map((plannedChapter, index) => ({ id: `beat-${index + 1}`, arcId: 'arc', characterId: 'hero', kind: 'trigger' as const, plannedChapter, expectedChange: `推进界门主线 ${index + 1}` })),
    promises: [{ id: 'promise', title: '三年之约', promise: '主角必须赴约', payoffCondition: '第三卷决战前兑现', plannedChapter: 25, status: 'reviewed' }],
    openThreads: [{ id: 'thread', title: '界门来历', kind: 'mystery', question: '谁建造界门', plannedResolution: '终卷揭示建造者', status: 'reviewed' }],
    arcs: [{ id: 'arc', title: '守护故乡', characterIds: ['hero', 'rival'], goal: '理解战争真相', stakes: '三大陆存亡', plannedOutcome: '共同封印界门' }],
    volumes: [
      { id: 'vol-1', order: 1, title: '东陆风云', goal: '发现界门异动', climax: '青云城守城战', endState: '主角筑基', plannedChapterCount: 30, arcIds: ['arc'] },
      { id: 'vol-2', order: 2, title: '诸域争锋', goal: '查清战争遗产', climax: '三宗会盟破裂', endState: '主角结丹', plannedChapterCount: 35, arcIds: ['arc'] },
      { id: 'vol-3', order: 3, title: '界门终局', goal: '阻止战争重启', climax: '界门决战', endState: '封印界门', plannedChapterCount: 35, arcIds: ['arc'] },
    ],
    unresolvedQuestions: [], createdAt: new Date().toISOString(),
  };
  return { world, bible: lockStoryBible(bibleDraft, world) };
}

test('the first long-form milestone runs three volumes and freezes a 100-chapter manuscript', () => {
  const design = lockedDesign();
  const service = new NovelService(provider);
  const work = service.createWork('三卷百章验收');
  service.setWorldPack(work.id, design.world);
  service.setStoryBible(work.id, design.bible);
  const checkpoint = service.runUntil(work.id, 100, [passChecker], 'three-volume-run');
  assert.equal(checkpoint.phase, 'complete');
  assert.equal(checkpoint.nextChapter, 101);
  assert.equal(work.adoptedVersions().length, 100);
  const manuscript = service.finalizeManuscript(work.id);
  assert.equal(manuscript.chapterCount, 100);
  assert.equal(manuscript.chapterVersionIds.length, 100);
  assert.ok(manuscript.wordCount > 0);
  assert.equal(manuscript.targetWordCount, work.covenant.chapterWords * 100);
  assert.equal(manuscript.lengthCoverage, manuscript.wordCount / manuscript.targetWordCount);
  assert.equal(manuscript.contentHash.length, 64);
});

test('closure coverage blocks a long-form design with unresolved seeds', () => {
  const design = lockedDesign();
  const service = new NovelService(provider);
  const work = service.createWork('未收束验收');
  work.storyBible = design.bible;
  const coverage = closureCoverageFor(work, 100);
  assert.equal(coverage.ready, false);
  assert.equal(coverage.expected.volumes, 3);
  assert.equal(coverage.expected.secrets, 1);
  assert.match(coverage.errors.join('; '), /secret .*no reveal|promise .*remains open|thread .*no resolved|arc .*no resolved/);
});
