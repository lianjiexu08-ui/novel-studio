import test from 'node:test';
import assert from 'node:assert/strict';
import { AdoptionBlocked, characterStateAt, LockedConstraintError, NovelService, passChecker, unavailableChecker } from '../src/core.ts';
import type { ModelProvider } from '../src/core.ts';
import { lockStoryBible, lockWorldPack } from '../src/world.ts';
import type { StoryBible } from '../src/world.ts';

const provider: ModelProvider = {
  generateChapter: ({ chapterNumber, context }) => {
    const power = Number([...context.includedEventIds].length) + chapterNumber;
    const event = { eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: power, storyTime: chapterNumber, evidence: `paragraph ${chapterNumber}` };
    return { content: `第${chapterNumber}章：主角突破。`, proposedEvents: [event], observedEvents: [event] };
  },
};

test('candidate events stay isolated until adoption', () => {
  const service = new NovelService(provider);
  const work = service.createWork('玄幻试作');
  const candidate = service.generateCandidate(work.id, 1, 'run-1');
  assert.equal(work.events.size, 0);
  service.runChecks(work.id, candidate.id, [passChecker]);
  service.adoptCandidate(work.id, candidate.id);
  assert.equal(work.events.size, 1);
  assert.equal(work.states.get('hero|power')?.value, 1);
});

test('unavailable required checker blocks adoption', () => {
  const service = new NovelService(provider);
  const work = service.createWork('质量门');
  const candidate = service.generateCandidate(work.id, 1);
  service.runChecks(work.id, candidate.id, [passChecker, unavailableChecker]);
  assert.throws(() => service.adoptCandidate(work.id, candidate.id), AdoptionBlocked);
  assert.equal(work.versions.size, 0);
});

test('locked relationship cannot be changed by a candidate', () => {
  let relationshipId = '';
  const lockedProvider: ModelProvider = {
    generateChapter: () => ({ content: '关系变化', proposedEvents: [{ eventType: 'relationship_change', subjectId: relationshipId, predicate: 'value', value: '敌对' }], observedEvents: [{ eventType: 'relationship_change', subjectId: relationshipId, predicate: 'value', value: '敌对' }] }),
  };
  const service = new NovelService(lockedProvider);
  const work = service.createWork('锁定关系');
  const relationship = service.addRelationship(work.id, { fromCharacterId: 'a', toCharacterId: 'b', kind: 'identity', value: '兄妹', locked: false });
  relationshipId = relationship.id;
  service.lockRelationship(work.id, relationship.id);
  const candidate = service.generateCandidate(work.id, 1);
  service.runChecks(work.id, candidate.id, [passChecker]);
  assert.throws(() => service.adoptCandidate(work.id, candidate.id), LockedConstraintError);
});

test('early edit invalidates later context and rebuilds active state', () => {
  const service = new NovelService(provider);
  const work = service.createWork('版本失效');
  service.runUntil(work.id, 4, [passChecker], 'run-4');
  assert.equal(work.adoptedVersions().length, 4);
  service.editAdoptedChapter(work.id, 2, '第二章修订', [passChecker]);
  assert.equal(work.currentVersion(2)?.content, '第二章修订');
  assert.equal(work.currentVersion(3), undefined);
  assert.deepEqual(work.impacts[0].affectedChapterNumbers, [3, 4]);
  assert.equal(service.contextFor(work, 4).adoptedVersionIds.length, 2);
});

test('content-only early edits preserve the edited chapter fact ledger', () => {
  const service = new NovelService(provider);
  const work = service.createWork('编辑事实');
  service.runUntil(work.id, 2, [passChecker], 'edit-facts');
  assert.equal(work.states.get('hero|power')?.value, 3);
  service.editAdoptedChapter(work.id, 1, '第一章重写但事件未重新抽取', [passChecker]);
  assert.equal([...work.events.values()].filter((event) => event.active).length, 1);
  assert.equal(work.states.get('hero|power')?.value, 1);
  assert.equal(work.currentVersion(2), undefined);
});

test('run checkpoint is idempotent for a completed run', () => {
  const service = new NovelService(provider);
  const work = service.createWork('恢复');
  const first = service.runUntil(work.id, 3, [passChecker], 'same-run');
  const ids = [...work.versions.values()].map((version) => version.id);
  const second = service.runUntil(work.id, 3, [passChecker], 'same-run');
  assert.equal(first.phase, 'complete');
  assert.equal(second.phase, 'complete');
  assert.deepEqual([...work.versions.values()].map((version) => version.id), ids);
});

test('author constraint edits stale a generated candidate without changing story revision', () => {
  const service = new NovelService(provider);
  const work = service.createWork('约束版本');
  const candidate = service.generateCandidate(work.id, 1, 'constraint-run');
  service.runChecks(work.id, candidate.id, [passChecker]);
  work.constraintRevision += 1;
  assert.equal(work.stateRevision, 0);
  assert.throws(() => service.adoptCandidate(work.id, candidate.id), /stale/);
});

test('a new run resumes after the highest contiguous adopted chapter', () => {
  const service = new NovelService(provider);
  const work = service.createWork('续写游标');
  service.runUntil(work.id, 3, [passChecker], 'first-run');
  const checkpoint = service.runUntil(work.id, 5, [passChecker], 'second-run');
  assert.equal(checkpoint.nextChapter, 6);
  assert.deepEqual(work.adoptedVersions().map((version) => version.chapterNumber), [1, 2, 3, 4, 5]);
});

test('character facts can be queried as of a story chapter', () => {
  const service = new NovelService(provider);
  const work = service.createWork('状态回放');
  service.runUntil(work.id, 3, [passChecker], 'state-at');
  assert.equal(characterStateAt(work, 'hero', 'power', 1)?.value, 1);
  assert.equal(characterStateAt(work, 'hero', 'power', 2)?.value, 3);
  assert.equal(characterStateAt(work, 'hero', 'power', 3)?.value, 5);
  assert.equal(characterStateAt(work, 'hero', 'power', 0), undefined);
});

test('chapter candidates bind to the locked world pack and story bible revisions', () => {
  const world = {
    id: 'world_core', revision: 1, title: '九霄', summary: '三界', status: 'reviewed' as const,
    axioms: [{ id: 'axiom', title: '因果有价', content: '力量必须支付代价', scope: 'all', precedence: 1, status: 'reviewed' as const }], powerSystems: [{ id: 'system', name: '灵力', source: '天地', unit: '灵气', realmIds: ['realm'], status: 'reviewed' as const }],
    realms: [{ id: 'realm', systemId: 'system', name: '炼气', rank: 1, prerequisites: [], capabilities: ['引气'], cost: '时间', counters: [], status: 'reviewed' as const }],
    techniques: [{ id: 'technique', name: '引气诀', kind: 'cultivation' as const, allowedRealmIds: ['realm'], effect: '引气', cost: '时间', limitations: [], counters: [], status: 'reviewed' as const }], artifacts: [{ id: 'artifact', name: '青云剑', tier: '一阶', effect: '增幅', cost: '灵石', limitations: [], status: 'reviewed' as const }], resources: [{ id: 'resource', name: '灵石', unit: '枚', source: '矿脉', scarcity: '常见', status: 'reviewed' as const }], locations: [{ id: 'home', name: '青州', kind: 'continent' as const, entryConditions: [], status: 'reviewed' as const }],
    factions: [{ id: 'sect', name: '青云宗', kind: 'sect' as const, locationIds: ['home'], goals: ['守护青州'], resources: [], status: 'reviewed' as const }],
    historicalEvents: [{ id: 'history', title: '立宗', storyTime: '百年前', causes: ['动荡'], consequences: ['建宗'], factionIds: ['sect'], status: 'reviewed' as const }], terminology: [{ id: 'term', canonical: '灵气', aliases: [], kind: 'other' as const, status: 'reviewed' as const }], unresolvedQuestions: [], createdAt: new Date().toISOString(),
  };
  const lockedWorld = lockWorldPack(world);
  const bible: StoryBible = {
    id: 'bible_core', revision: 1, worldPackId: lockedWorld.id, worldPackRevision: lockedWorld.revision, status: 'reviewed',
    coreConflict: '宗门存亡', endingDirection: '守住家园', characters: [{ id: 'hero', name: '林渊', role: 'protagonist', goal: '守护青州', identity: '弟子', locationId: 'home', factionId: 'sect', startingRealmId: 'realm' }, { id: 'hero2', name: '苏晚', role: 'major', goal: '查明真相', identity: '弟子', locationId: 'home', factionId: 'sect', startingRealmId: 'realm' }],
    relationships: [{ id: 'rel', fromCharacterId: 'hero', toCharacterId: 'hero2', kind: 'trust', value: '同门', locked: false }], arcs: [{ id: 'arc', title: '守城', characterIds: ['hero'], goal: '成长', stakes: '宗门存亡', plannedOutcome: '守住宗门' }], volumes: [{ id: 'v1', order: 1, title: '入门', goal: '成长', climax: '守城', endState: '入筑基', plannedChapterCount: 10, arcIds: ['arc'] }], unresolvedQuestions: [], createdAt: new Date().toISOString(),
  };
  const lockedBible = lockStoryBible(bible, lockedWorld);
  const service = new NovelService(provider);
  const work = service.createWork('门禁验证');
  service.setWorldPack(work.id, lockedWorld);
  service.setStoryBible(work.id, lockedBible);
  const candidate = service.generateCandidate(work.id, 1, 'locked-design');
  assert.equal(candidate.generatedAgainstWorldPackRevision, lockedWorld.revision);
  assert.equal(candidate.generatedAgainstStoryBibleRevision, lockedBible.revision);
});
