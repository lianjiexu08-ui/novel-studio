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
  plannedKnowledgeAt,
} from '../src/world.ts';

test('secret knowledge plans use per-character disjoint intervals and never fill a gap with future truth', () => {
  const world = reviewedWorld();
  const bible = reviewedBible(world.id, world.revision);
  const base = { characterId: 'hero', certainty: 'suspects' as const, belief: '怀疑遗印来源', trigger: '发现残片', consequence: '追查持有人', forbiddenInferences: ['不能断言持有人是敌人'] };
  bible.secrets![0].knowledgeStages = [
    { ...base, sinceChapter: 2, untilChapter: 3 },
    { ...base, sinceChapter: 5, certainty: 'confirmed', belief: '证词确认遗印归属' },
    { ...base, characterId: 'rival', sinceChapter: 1, certainty: 'confirmed' },
  ];
  assert.equal(validateStoryBible(bible, world).ready, true);
  assert.equal(plannedKnowledgeAt(bible, 3).find((stage) => stage.characterId === 'hero')?.certainty, 'suspects');
  assert.equal(plannedKnowledgeAt(bible, 4).find((stage) => stage.characterId === 'hero'), undefined);
  assert.equal(plannedKnowledgeAt(bible, 5).find((stage) => stage.characterId === 'hero')?.certainty, 'confirmed');
  bible.secrets![0].knowledgeStages[1].sinceChapter = 3;
  assert.match(validateStoryBible(bible, world).errors.join(';'), /knowledge stages overlap/);
  bible.secrets![0].knowledgeStages[1].sinceChapter = 5;
  bible.secrets![0].knowledgeStages[1].characterId = 'missing';
  assert.match(validateStoryBible(bible, world).errors.join(';'), /knowledge references unknown character/);
  bible.secrets![0].knowledgeStages[1].untilChapter = 4;
  assert.match(validateStoryBible(bible, world).errors.join(';'), /knowledge has an invalid chapter interval/);
});

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
    secrets: [{ id: 'secret-1', ownerCharacterId: 'rival', title: '战争遗印', truth: '沈烬携带战争遗印', revealCondition: '界门开启时揭示', status: 'reviewed' }],
    arcBeats: [{ id: 'beat-1', arcId: 'arc-1', characterId: 'hero', kind: 'trigger', plannedChapter: 3, expectedChange: '决定调查界门' }],
    promises: [{ id: 'promise-1', title: '三年之约', promise: '主角必须赴约', payoffCondition: '第三卷决战前兑现', plannedChapter: 25, status: 'reviewed' }],
    openThreads: [{ id: 'thread-1', title: '界门来历', kind: 'mystery', question: '谁建造界门', plannedResolution: '终卷揭示建造者', status: 'reviewed' }],
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

test('deferring a blocking question cannot bypass review, lock or generation', () => {
  const world = lockWorldPack(reviewedWorld());
  const bible = lockStoryBible(reviewedBible(world.id, world.revision), world);
  for (const document of [world, bible]) {
    document.unresolvedQuestions.push({ id: 'power-conflict', question: '重复燃寿违背冷却规则', blocking: true, status: 'deferred' });
  }
  assert.throws(() => reviewWorldPack({ ...world, status: 'proposed' }), /blocking world pack questions/);
  assert.throws(() => lockWorldPack({ ...world, status: 'reviewed' }), /blocking world pack questions/);
  assert.throws(() => reviewStoryBible({ ...bible, status: 'proposed' }, world), /blocking story questions/);
  assert.throws(() => lockStoryBible({ ...bible, status: 'reviewed' }, world), /blocking story questions/);
  const gate = chapterGenerationGate(world, bible);
  assert.equal(gate.ready, false);
  assert.ok(gate.errors.some((error) => error.includes('blocking world pack questions')));
  assert.ok(gate.errors.some((error) => error.includes('blocking story questions')));
});

test('relationship stages require disjoint bounded intervals and causal commitments', () => {
  const world = lockWorldPack(reviewedWorld());
  const bible = reviewedBible(world.id, world.revision);
  const relationship = bible.relationships[0];
  relationship.sinceChapter = 3;
  relationship.untilChapter = 12;
  relationship.stages = [
    { sinceChapter: 3, untilChapter: 7, value: '试探', cause: '调查暗桩', cost: '承担嫌疑' },
    { sinceChapter: 8, untilChapter: 12, value: '结盟', cause: '交换情报', cost: '共同承担清算' },
  ];
  assert.equal(validateStoryBible(bible, world).ready, true);
  relationship.stages[0].untilChapter = 8;
  assert.match(validateStoryBible(bible, world).errors.join(';'), /stages overlap/);
  relationship.stages[0].untilChapter = 7;
  relationship.stages[1].untilChapter = undefined;
  assert.match(validateStoryBible(bible, world).errors.join(';'), /exceeds its relationship interval/);
  relationship.stages[1].untilChapter = 12;
  relationship.stages[1].cause = '';
  assert.match(validateStoryBible(bible, world).errors.join(';'), /value, cause and cost/);
});

test('staged resource aliases resolve by name rather than a shared numeric suffix', async () => {
  const { normalizeFactionResources } = await import('../src/world.ts');
  const world = reviewedWorld();
  world.resources[0].id = 'res_09';
  world.resources.push({ ...world.resources[0], id: 'res_01', name: '玄铁' });
  world.terminology.push({ id: 'term_res_01', canonical: '灵石', aliases: [], kind: 'resource', status: 'proposed' });
  world.factions[0].resources = ['term_res_01', 'term_missing'];
  const normalized = normalizeFactionResources(world);
  assert.deepEqual(normalized.factions[0].resources, ['res_09', 'term_missing']);
  assert.deepEqual(world.factions[0].resources, ['term_res_01', 'term_missing']);
  assert.match(validateWorldPack(normalized).errors.join(';'), /term_missing/);
  world.resources.push({ ...world.resources[0], id: 'duplicate-name' });
  assert.equal(normalizeFactionResources(world).factions[0].resources[0], 'term_res_01');
});

test('assets must use a declared tier when their ladder is present', () => {
  const world = reviewedWorld();
  world.tierLadders = [{ id: 'artifact-tiers', kind: 'artifact', name: '法宝品阶', levels: ['凡器', '灵器'], rule: '高阶需要更多灵力', status: 'proposed' }];
  assert.match(validateWorldPack(world).errors.join(';'), /tier 一阶 is not/);
  world.artifacts[0].tier = '灵器';
  assert.equal(validateWorldPack(world).ready, true);
});

test('conflicting canonical and alias declarations block world review without merging definitions', async () => {
  const { worldTerminologyConflicts, resolveWorldResource } = await import('../src/world.ts');
  const world = reviewedWorld();
  world.resources.push({ ...world.resources[0], id: 'currency', name: '诸天通宝' });
  world.terminology.push(
    { id: 'original', canonical: '诸天通宝', aliases: ['万象金母', '天道金元'], kind: 'resource', status: 'reviewed' },
    { id: 'duplicate', canonical: '万象商币', aliases: ['诸天通宝', '万象金母'], kind: 'resource', status: 'reviewed' },
  );
  const before = JSON.stringify(world);
  assert.deepEqual(worldTerminologyConflicts(world).map(conflict => conflict.label), ['诸天通宝', '万象金母']);
  assert.equal(validateWorldPack(world).ready, false);
  assert.throws(() => reviewWorldPack({ ...world, status: 'proposed' }), /conflicting canonical names/);
  assert.throws(() => lockWorldPack(world), /conflicting canonical names/);
  assert.equal(JSON.stringify(world), before);
  // Current unique entity lookup does not imply the glossary is consistent,
  // nor does this conflict prove an actual double payment has happened.
  for (const name of ['诸天通宝', '万象商币', '万象金母', '天道金元']) assert.equal(resolveWorldResource(world, name)?.id, 'currency');
  world.terminology = world.terminology.filter(term => term.id !== 'duplicate');
  world.terminology.find(term => term.id === 'original')!.aliases.push('万象商币');
  assert.equal(validateWorldPack(world).ready, true);
  for (const name of ['诸天通宝', '万象商币', '万象金母', '天道金元']) assert.equal(resolveWorldResource(world, name)?.id, 'currency');
});

test('terminology conflicts respect kind, exact spelling and retained retired definitions', async () => {
  const { worldTerminologyConflicts } = await import('../src/world.ts');
  const world = reviewedWorld();
  world.terminology.push(
    { id: 'place', canonical: '青龙城', aliases: ['青龙'], kind: 'place', status: 'reviewed' },
    { id: 'person', canonical: '青龙真人', aliases: ['青龙'], kind: 'person', status: 'reviewed' },
    { id: 'same', canonical: '青龙城', aliases: ['青龙', '青龙城'], kind: 'place', status: 'reviewed' },
    { id: 'retired', canonical: '旧青龙城', aliases: ['青龙'], kind: 'place', status: 'deprecated' },
    { id: 'similar', canonical: '青龙郡', aliases: ['青龙郡城'], kind: 'place', status: 'reviewed' },
  );
  assert.deepEqual(worldTerminologyConflicts(world), []);
  world.terminology.find(term => term.id === 'retired')!.status = 'proposed';
  const conflicts = worldTerminologyConflicts(world);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'place'); assert.equal(conflicts[0].label, '青龙');
  assert.deepEqual(conflicts[0].definitions.map(term => term.id), ['place', 'same', 'retired']);
});

test('long-form readiness blocks resources whose names imply undefined powers', async () => {
  const { validateLongFormWorldPack } = await import('../src/world.ts');
  const world = reviewedWorld();
  assert.equal(validateWorldPack(world).ready, true, 'a legacy draft remains editable');
  assert.match(validateLongFormWorldPack(world).errors.join(';'), /requires explicit effect, requirements, cost and limitations/);
  world.resources[0].usage = { effect: '供灵不延寿', requirements: ['放入兼容阵盘'], cost: '耗尽一枚', limitations: ['不可吞服'] };
  assert.ok(!validateLongFormWorldPack(world).errors.some((message) => message.includes('requires explicit effect')));
  world.resources[0].usage.limitations = [];
  assert.match(validateLongFormWorldPack(world).errors.join(';'), /requires explicit effect/);
  world.resources[0].status = 'deprecated';
  assert.ok(!validateLongFormWorldPack(world).errors.some((message) => message.includes('requires explicit effect')));
});

test('shared unresolved questions cannot disagree across world and bible or bypass locked generation', () => {
  const world = lockWorldPack(reviewedWorld());
  const bible = lockStoryBible(reviewedBible(world.id, world.revision), world);
  world.unresolvedQuestions.push({ id: 'gate-question', question: '界门打开后果', blocking: false, status: 'open' });
  bible.unresolvedQuestions.push({ id: 'gate-question', question: '【旧记录】界门打开后果', blocking: false, status: 'resolved' });
  const original = structuredClone({ world, bible });
  assert.match(validateStoryBible(bible, world).errors.join(';'), /gate-question status resolved conflicts with world status open/);
  assert.equal(chapterGenerationGate(world, bible).ready, false, 'locked flags cannot hide a divergent resolution');
  assert.throws(() => reviewStoryBible({ ...bible, status: 'proposed' }, world), /conflicts with world status/);
  assert.throws(() => lockStoryBible({ ...bible, status: 'reviewed' }, world), /conflicts with world status/);
  assert.deepEqual({ world, bible }, original, 'validation does not resolve or reopen historical objects');
  world.unresolvedQuestions[0].status = 'resolved';
  bible.unresolvedQuestions[0].status = 'deferred';
  assert.match(validateStoryBible(bible, world).errors.join(';'), /status deferred conflicts with world status resolved/);
  bible.unresolvedQuestions[0].status = 'resolved';
  bible.unresolvedQuestions[0].blocking = true;
  assert.match(validateStoryBible(bible, world).errors.join(';'), /blocking flag conflicts/);
  bible.unresolvedQuestions[0].blocking = false;
  assert.equal(validateStoryBible(bible, world).ready, true);
  bible.unresolvedQuestions.push({ id: 'story-only', question: '配角的后续选择', blocking: false, status: 'deferred' });
  assert.equal(validateStoryBible(bible, world).ready, true, 'independent story questions need no matching world entry');
});

test('duplicate question ids cannot hide a conflicting resolution within one document', () => {
  const world = reviewedWorld();
  const bible = reviewedBible(world.id, world.revision);
  const question = { id: 'duplicate-question', question: '未核前置', blocking: false, status: 'open' as const };
  world.unresolvedQuestions = [question, { ...question, status: 'resolved' }];
  bible.unresolvedQuestions = [question, { ...question, status: 'resolved' }];
  assert.ok(validateWorldPack(world).errors.includes('world questions has duplicate id duplicate-question'));
  assert.ok(validateStoryBible(bible, world).errors.includes('story questions has duplicate id duplicate-question'));
});
