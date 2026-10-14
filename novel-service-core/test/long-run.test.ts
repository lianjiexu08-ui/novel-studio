import test from 'node:test';
import assert from 'node:assert/strict';
import { closureCoverageFor, NovelService, passChecker, qualityAuditFor } from '../src/core.ts';
import { lockStoryBible, lockWorldPack } from '../src/world.ts';
import { fixtureDesignReview, minimalPlan } from '../../packages/application/test/fixtures.ts';
import { designReviewAreas, designReviewInput, recordDesignReview } from '../src/design-review.ts';
import { createDesignReviewRun } from '../src/design-review-run.ts';
import type { EventDraft, Work } from '../src/core.ts';
import { createPlanRevision, planContentHash } from '../src/planning.ts';
import type { StoryBible, WorldPack } from '../src/world.ts';

const provider = {
  generateChapter: ({ chapterNumber }: { chapterNumber: number }) => {
    const event = { eventType: 'character_state', subjectId: 'hero', predicate: 'power', value: chapterNumber, storyTime: chapterNumber, evidence: 'paragraph 1' };
    const events: EventDraft[] = [event];
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
    resources: [1, 2, 3].map((n) => ({ id: `resource-${n}`, name: `灵石${n}`, unit: '枚', source: '矿脉', scarcity: '常见', usage: { effect: '为低阶阵盘补充灵力，不增加寿命', requirements: ['先验明纯度并装入兼容阵盘'], cost: '每次供能消耗一枚，耗尽化灰', limitations: ['不能直接吞服，也不替代突破所需修行'] }, status: 'reviewed' as const })),
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
    chapterPlans: Array.from({ length: 50 }, (_, index) => ({ id: `chapter-plan-${index + 1}`, chapterNumber: index + 1, title: `开篇第${index + 1}章`, purpose: '推进主线', conflict: '界门威胁升级', turningPoint: '获得新线索', endHook: '新的悬念', characterIds: ['hero'], locationIds: ['sect-city'], arcBeatIds: [], requiredEvents: [] })),
    unresolvedQuestions: [], createdAt: new Date().toISOString(),
  };
  return { world, bible: lockStoryBible(bibleDraft, world) };
}

/** Explicit test doubles for the approved plan and four content reviews. */
function reviewedPlan(work: Work) {
  const plan = minimalPlan(100, { volumeSize: 34, outlined: 100 });
  let start = 1;
  plan.volumes = work.storyBible!.volumes.map((volume, index) => {
    const result = { ...plan.volumes[index], id: volume.id, startChapter: start, endChapter: start + volume.plannedChapterCount - 1 };
    start = result.endChapter + 1;
    return result;
  });
  for (const chapter of plan.chapters) chapter.volumeId = plan.volumes.find(v => v.startChapter <= chapter.chapterNumber && v.endChapter >= chapter.chapterNumber)!.id;
  const revision = createPlanRevision(work, plan, { source: 'author' });
  revision.status = 'approved'; work.activePlanId = revision.id;
  for (const area of designReviewAreas) {
    const input = designReviewInput(work, area);
    recordDesignReview(work, input, fixtureDesignReview(input));
  }
  return revision;
}

test('direct generation and adoption cannot bypass unfinished long-form design reviews', async () => {
  let calls = 0;
  const service = new NovelService({ generateChapter: input => { calls += 1; return provider.generateChapter(input); } });
  const work = service.createWork('底层入口同样先审设计');
  const design = lockedDesign();
  service.setWorldPack(work.id, design.world); service.setStoryBible(work.id, design.bible);
  const plan = reviewedPlan(work);
  const pending = service.generateCandidate(work.id, 1, 'pending-before-review');
  service.runChecks(work.id, pending.id, [passChecker]);
  const baseline = calls;
  const reports = [...work.designContentReviews];
  const input = designReviewInput(work, 'story');
  const assertBlocked = async () => {
    assert.throws(() => service.generateCandidate(work.id, 1, 'new-sync'), /内容评审/);
    await assert.rejects(() => service.generateCandidateAsync(work.id, 1, 'new-async'), /内容评审/);
    assert.throws(() => service.runUntil(work.id, 1, [passChecker], 'new-run'), /内容评审/);
    assert.throws(() => service.adoptCandidate(work.id, pending.id), /内容评审/);
    assert.equal(calls, baseline, 'blocked design must not spend a writer call');
    assert.equal(work.candidates.size, 1);
    assert.equal(work.versions.size, 0); assert.equal(work.events.size, 0);
  };
  work.designContentReviews.clear(); await assertBlocked();
  for (const [id, report] of reports) work.designContentReviews.set(id, report);
  const run = createDesignReviewRun(input); work.designReviewRuns.set(run.id, run); await assertBlocked();
  work.designReviewRuns.delete(run.id);
  const originalTitle = work.title; work.title += '修改'; await assertBlocked(); work.title = originalTitle;
  const result = fixtureDesignReview(input);
  Object.assign(result.checks.find(c => c.criterion === 'growth')!, {
    verdict: 'revise', explanation: '只有远期秘术而无近期可达目标', revisionAdvice: '补全近期行动和阶段回报',
  });
  recordDesignReview(work, input, result); await assertBlocked();
  assert.equal(plan.status, 'approved', 'structural approval cannot override a negative content review');
});

test('a new design review blocks direct adoption and chapter replacement while preserving adopted history', () => {
  const design = lockedDesign(), service = new NovelService(provider), work = service.createWork('复评不得绕过采纳');
  service.setWorldPack(work.id, design.world); service.setStoryBible(work.id, design.bible); reviewedPlan(work);
  const first = service.generateCandidate(work.id, 1, 'first');
  service.runChecks(work.id, first.id, [passChecker]);
  const version = service.adoptCandidate(work.id, first.id);
  const pending = service.generateCandidate(work.id, 2, 'pending');
  service.runChecks(work.id, pending.id, [passChecker]);
  const before = JSON.stringify({ versions: [...work.versions], events: [...work.events], state: work.stateRevision });
  const run = createDesignReviewRun(designReviewInput(work, 'world')); work.designReviewRuns.set(run.id, run);
  assert.throws(() => service.adoptCandidate(work.id, pending.id), /内容评审/);
  assert.throws(() => service.editAdoptedChapter(work.id, 1, '改写后的正文', [passChecker]), /内容评审/);
  assert.equal(service.adoptCandidate(work.id, first.id), version, 'an idempotent retry only reads the already adopted version');
  assert.equal(JSON.stringify({ versions: [...work.versions], events: [...work.events], state: work.stateRevision }), before);
});

test('the first long-form milestone runs three volumes and freezes a 100-chapter manuscript', () => {
  const design = lockedDesign();
  const service = new NovelService(provider);
  const work = service.createWork('三卷百章验收');
  service.setWorldPack(work.id, design.world);
  service.setStoryBible(work.id, design.bible);
  reviewedPlan(work);
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

test('quality audit reports structural story gaps before expansion', () => {
  const design = lockedDesign();
  const service = new NovelService(provider);
  const work = service.createWork('质量审计验收');
  service.setWorldPack(work.id, design.world);
  service.setStoryBible(work.id, design.bible);
  const audit = qualityAuditFor(work);
  assert.equal(audit.status, 'blocked');
  assert.ok(audit.findings.some((finding) => finding.id === 'story-opening-beats'));
  assert.equal(audit.counts.characters, 2);
  assert.equal(audit.scope.storyBibleTargetChapterCount, 100);
});

test('closure coverage can be scoped to the manuscript design revision', () => {
  const design = lockedDesign();
  const service = new NovelService(provider);
  const work = service.createWork('版本范围验收');
  service.setWorldPack(work.id, design.world);
  service.setStoryBible(work.id, design.bible);
  const originalRevision = work.storyBible!.revision;
  const expanded = { ...work.storyBible!, revision: originalRevision + 1, volumes: [...work.storyBible!.volumes, { id: 'vol-4', order: 4, title: '后续', goal: '扩展', climax: '扩展', endState: '扩展', plannedChapterCount: 20, arcIds: ['arc'] }] };
  work.storyBible = expanded;
  work.recordDesignRevision('story_bible', expanded);
  assert.equal(closureCoverageFor(work, 100, { storyBibleRevision: originalRevision }).expected.volumes, 3);
  assert.equal(closureCoverageFor(work, 100).expected.volumes, 4);
});

test('written chapters do not substitute for explicit closure evidence', () => {
  const design = lockedDesign();
  const service = new NovelService(provider);
  const work = service.createWork('不能用已写完代替已收束');
  service.setWorldPack(work.id, design.world);
  service.setStoryBible(work.id, design.bible);
  reviewedPlan(work);
  service.runUntil(work.id, 100, [passChecker], 'closure-evidence');
  for (const version of work.adoptedVersions()) work.events.set(`plot-${version.id}`, {
    id: `plot-${version.id}`, workId: work.id, chapterVersionId: version.id, chapterNumber: version.chapterNumber,
    eventType: 'plot_progress', subjectId: `chapter-${version.chapterNumber}`, predicate: 'status', value: { status: 'realized' }, evidence: '章纲已完成', active: true,
  });
  for (const event of work.events.values()) if (event.eventType === 'volume_progress' || event.eventType === 'arc_progress') event.value = { status: 'active' };
  assert.equal(work.adoptedVersions().length, 100);
  assert.equal(closureCoverageFor(work, 100).ready, false);
  assert.throws(() => service.finalizeManuscript(work.id), /closure gate blocked/);
  assert.equal(closureCoverageFor(work, 100, { storyBibleRevision: 999 }).ready, false);
});

test('manuscript closure is isolated from later design and event activity changes', () => {
  const design = lockedDesign();
  const service = new NovelService(provider);
  const work = service.createWork('成稿证据范围');
  service.setWorldPack(work.id, design.world);
  service.setStoryBible(work.id, design.bible);
  reviewedPlan(work);
  service.runUntil(work.id, 100, [passChecker], 'frozen-evidence');
  const manuscript = service.finalizeManuscript(work.id);
  for (const event of work.events.values()) event.active = false;
  work.storyBible = { ...design.bible, revision: 99, secrets: [{ ...design.bible.secrets![0], id: 'future-secret' }] };
  assert.equal(closureCoverageFor(work, 100).ready, false);
  assert.equal(closureCoverageFor(work, 100, manuscript).ready, true);
});

test('finalization rechecks current design reviews and preserves the existing manuscript on rejection', () => {
  const design = lockedDesign(), service = new NovelService(provider), work = service.createWork('最终稿不能绕过复评');
  service.setWorldPack(work.id, design.world); service.setStoryBible(work.id, design.bible);
  const plan = reviewedPlan(work);
  service.runUntil(work.id, 100, [passChecker], 'final-review-gate');
  plan.status = 'proposed';
  assert.throws(() => service.finalizeManuscript(work.id), /approved plan/);
  plan.status = 'approved';
  const original = service.finalizeManuscript(work.id);
  const before = JSON.stringify([...work.manuscripts]);
  const reports = [...work.designContentReviews];
  const rejected = (pattern = /content review|内容评审/) => {
    assert.throws(() => service.finalizeManuscript(work.id), pattern);
    assert.equal(JSON.stringify([...work.manuscripts]), before);
    assert.equal(original.status, 'final');
  };
  plan.status = 'proposed'; rejected(/approved plan/); plan.status = 'approved';
  const worldRevision = plan.worldPackRevision;
  plan.worldPackRevision = -1; rejected(/approved plan/); plan.worldPackRevision = worldRevision;
  const end = plan.plan.volumes[0].endChapter;
  plan.plan.volumes[0].endChapter -= 1; rejected(/plan gate blocked/); plan.plan.volumes[0].endChapter = end;
  work.designContentReviews.clear(); rejected();
  for (const [id, report] of reports) work.designContentReviews.set(id, report);
  const input = designReviewInput(work, 'power'), result = fixtureDesignReview(input);
  result.checks[0] = { ...result.checks[0], verdict: 'revise', explanation: '测试复评发现不可支付的功法成本', revisionAdvice: '先修复并重新评审' };
  const negative = recordDesignReview(work, input, result); rejected();
  work.designContentReviews.delete(negative.id);
  const run = createDesignReviewRun(input); work.designReviewRuns.set(run.id, run); rejected();
  work.designReviewRuns.delete(run.id);
  work.title += '（新约定）'; rejected();
  work.title = '最终稿不能绕过复评';
  const final = service.finalizeManuscript(work.id);
  assert.equal(final.revision, original.revision + 1);
  assert.equal(original.status, 'superseded');
});

test('finalization rejects old-design or untraceable prose without changing an existing manuscript', () => {
  const design = lockedDesign(), service = new NovelService(provider), work = service.createWork('成稿逐章来源');
  service.setWorldPack(work.id, design.world); service.setStoryBible(work.id, design.bible);
  const plan = reviewedPlan(work);
  service.runUntil(work.id, 100, [passChecker], 'source-book');
  service.finalizeManuscript(work.id);
  const before = JSON.stringify([...work.manuscripts]);
  const version = work.currentVersion(1)!, candidate = work.candidates.get(version.sourceCandidateId!)!;
  const rejected = () => {
    assert.throws(() => service.finalizeManuscript(work.id), /chapter provenance|章节来源/);
    assert.equal(JSON.stringify([...work.manuscripts]), before);
  };
  const source = version.sourceCandidateId;
  version.sourceCandidateId = undefined; rejected(); version.sourceCandidateId = source;
  const content = version.content; version.content += '未经评审的改动'; rejected(); version.content = content;
  const candidateVersion = candidate.adoptedVersionId;
  candidate.adoptedVersionId = 'different-version'; rejected(); candidate.adoptedVersionId = candidateVersion;
  const sourcePlan = candidate.planRevisionId;
  candidate.planRevisionId = undefined; rejected(); candidate.planRevisionId = sourcePlan;
  const bible = work.storyBible!;
  work.storyBible = { ...bible, characters: bible.characters.map((character, index) => index ? character : { ...character, goal: '与旧稿不同的核心目标' }) };
  for (const area of designReviewAreas) {
    const input = designReviewInput(work, area); recordDesignReview(work, input, fixtureDesignReview(input));
  }
  rejected(); work.storyBible = bible;
  work.worldPack!.revision += 1; work.storyBible!.worldPackRevision = work.worldPack!.revision;
  plan.worldPackRevision = work.worldPack!.revision;
  for (const area of designReviewAreas) {
    const input = designReviewInput(work, area); recordDesignReview(work, input, fixtureDesignReview(input));
  }
  rejected();
  assert.equal(candidate.generatedAgainstWorldPackRevision, design.world.revision - 1, 'new design approval cannot relabel old prose');
});

test('finalization permits additive rolling outlines but rejects changed earlier story content', () => {
  const design = lockedDesign(), service = new NovelService(provider), work = service.createWork('滚动章纲成稿');
  service.setWorldPack(work.id, design.world); service.setStoryBible(work.id, design.bible);
  const original = reviewedPlan(work), fullPlan = structuredClone(original.plan);
  original.plan.chapters = original.plan.chapters.slice(0, 50);
  original.contentHash = planContentHash(original.plan);
  for (const area of designReviewAreas) {
    const input = designReviewInput(work, area); recordDesignReview(work, input, fixtureDesignReview(input));
  }
  service.runUntil(work.id, 50, [passChecker], 'first-half');
  const expanded = createPlanRevision(work, fullPlan, { source: 'author', baseRevisionId: original.id });
  original.status = 'superseded'; expanded.status = 'approved'; work.activePlanId = expanded.id;
  for (const area of designReviewAreas) {
    const input = designReviewInput(work, area); recordDesignReview(work, input, fixtureDesignReview(input));
  }
  service.runUntil(work.id, 100, [passChecker], 'second-half');
  const manuscript = service.finalizeManuscript(work.id);
  assert.equal(manuscript.chapterCount, 100);
  const before = JSON.stringify([...work.manuscripts]);
  const changed = structuredClone(expanded.plan);
  changed.chapters[0].summary = '改变第一章的行动与结果';
  const replacement = createPlanRevision(work, changed, { source: 'author', baseRevisionId: expanded.id });
  expanded.status = 'superseded'; replacement.status = 'approved'; work.activePlanId = replacement.id;
  for (const area of designReviewAreas) {
    const input = designReviewInput(work, area); recordDesignReview(work, input, fixtureDesignReview(input));
  }
  assert.throws(() => service.finalizeManuscript(work.id), /chapter provenance|章节来源/);
  assert.equal(JSON.stringify([...work.manuscripts]), before);
});

test('audit checks actual volume ranges and keeps deferred questions visible', () => {
  const design = lockedDesign();
  const service = new NovelService(provider);
  const work = service.createWork('卷数相同也不能忽略范围');
  service.setWorldPack(work.id, design.world);
  service.setStoryBible(work.id, design.bible);
  work.worldPack!.unresolvedQuestions.push({ id: 'later', question: '资源从哪里来？', blocking: false, status: 'deferred' });
  const plan = minimalPlan(100, { volumeSize: 34, outlined: 100 });
  plan.volumes.forEach((volume, index) => { volume.id = design.bible.volumes[index].id; });
  const revision = createPlanRevision(work, plan, { source: 'author' });
  revision.status = 'approved'; work.activePlanId = revision.id;
  const audit = qualityAuditFor(work);
  assert.equal(plan.volumeCount, design.bible.volumes.length);
  assert.ok(audit.findings.some((finding) => finding.id === 'plan-volume-range-vol-1'));
  assert.ok(audit.findings.some((finding) => finding.id === 'world-open-questions'));
  assert.equal(audit.narrativeQuality, 'not_assessed');
  work.worldPack!.unresolvedQuestions[0].blocking = true;
  assert.ok(qualityAuditFor(work).findings.some((finding) => finding.id === 'world-question-later' && finding.severity === 'error'));
});
