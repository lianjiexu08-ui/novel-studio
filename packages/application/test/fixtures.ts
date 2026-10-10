import { defaultCovenant } from '../../../novel-service-core/src/core.ts';
import type { CreativeCovenant, Work } from '../../../novel-service-core/src/core.ts';
import type { StoryBible, WorldPack } from '../../../novel-service-core/src/world.ts';
import type { BookPlan, ChapterOutline, PlanRevision, VolumePlan } from '../../../novel-service-core/src/planning.ts';
import type { ChapterWorkflow } from '../src/index.ts';

export function readyCovenant(overrides: Partial<CreativeCovenant> = {}): CreativeCovenant {
  return { ...defaultCovenant(), audience: '喜欢阶段突破很清楚的读者', hook: '主角用寿命换一次胜利', ...overrides };
}

/** Long enough to pass the chapter length check for the default 2200-word covenant. */
export function chapterBody(chapterNumber: number): string {
  return `第${chapterNumber}章 ${'灵气在经脉里缓慢流转，'.repeat(160)}`;
}

export function minimalWorldPack(): WorldPack {
  return {
    id: 'world_fixture', revision: 1, title: '九霄界', summary: '三界玄幻', status: 'reviewed',
    axioms: [{ id: 'axiom', title: '因果有价', content: '力量必须支付代价', scope: 'all', precedence: 1, status: 'reviewed' }],
    powerSystems: [{ id: 'system', name: '灵力', source: '天地', unit: '灵气', realmIds: ['realm'], status: 'reviewed' }],
    realms: [{ id: 'realm', systemId: 'system', name: '炼气', rank: 1, prerequisites: [], capabilities: ['引气'], cost: '时间', counters: [], status: 'reviewed' }],
    techniques: [{ id: 'technique', name: '引气诀', kind: 'cultivation', allowedRealmIds: ['realm'], effect: '引气', cost: '时间', limitations: [], counters: [], status: 'reviewed' }],
    artifacts: [{ id: 'artifact', name: '青云剑', tier: '一阶', effect: '增幅', cost: '灵石', limitations: [], status: 'reviewed' }],
    resources: [{ id: 'resource', name: '灵石', unit: '枚', source: '矿脉', scarcity: '常见', status: 'reviewed' }],
    locations: [{ id: 'home', name: '青州', kind: 'continent', entryConditions: [], status: 'reviewed' }],
    factions: [{ id: 'sect', name: '青云宗', kind: 'sect', locationIds: ['home'], goals: ['守护青州'], resources: [], status: 'reviewed' }],
    historicalEvents: [{ id: 'history', title: '立宗', storyTime: '百年前', causes: ['动荡'], consequences: ['建宗'], factionIds: ['sect'], status: 'reviewed' }],
    terminology: [{ id: 'term', canonical: '灵气', aliases: [], kind: 'other', status: 'reviewed' }],
    unresolvedQuestions: [], createdAt: new Date().toISOString(),
  } as WorldPack;
}

export function minimalStoryBible(worldPack: WorldPack): StoryBible {
  return {
    id: 'bible_fixture', revision: 1, worldPackId: worldPack.id, worldPackRevision: worldPack.revision, status: 'reviewed',
    coreConflict: '宗门存亡', endingDirection: '守住家园',
    characters: [
      { id: 'hero', name: '林渊', role: 'protagonist', goal: '守护青州', identity: '弟子', locationId: 'home', factionId: 'sect', startingRealmId: 'realm' },
      { id: 'rival', name: '苏晚', role: 'major', goal: '查明真相', identity: '弟子', locationId: 'home', factionId: 'sect', startingRealmId: 'realm' },
    ],
    relationships: [{ id: 'rel', fromCharacterId: 'hero', toCharacterId: 'rival', kind: 'trust', value: '同门', locked: false }],
    arcs: [{ id: 'arc', title: '守城', characterIds: ['hero'], goal: '成长', stakes: '宗门存亡', plannedOutcome: '守住宗门' }],
    volumes: [{ id: 'v1', order: 1, title: '入门', goal: '成长', climax: '守城', endState: '入筑基', plannedChapterCount: 10, arcIds: ['arc'] }],
    unresolvedQuestions: [], createdAt: new Date().toISOString(),
  } as StoryBible;
}

/** Locks a minimal world pack and story bible through the author review path. */
export async function lockMinimalDesign(workflow: ChapterWorkflow, workId: string): Promise<void> {
  await workflow.saveWorldPack(workId, minimalWorldPack());
  await workflow.reviewWorldPack(workId);
  const lockedWorld = await workflow.lockWorldPack(workId);
  await workflow.saveStoryBible(workId, minimalStoryBible(lockedWorld));
  await workflow.reviewStoryBible(workId);
  await workflow.lockStoryBible(workId);
}

export function minimalOutline(chapterNumber: number, volumeId = 'vol-1'): ChapterOutline {
  return {
    id: `chapter-${chapterNumber}`, chapterNumber, volumeId, title: `第${chapterNumber}章`, summary: `林渊第${chapterNumber}次闯关`,
    characterGoals: '林渊要变强', conflict: '外门考核', choice: '冒险突破', cost: '耗损寿元', threads: [], endState: `第${chapterNumber}关通过`,
    characterIds: ['hero'], scenes: [], source: 'author',
  };
}

/** A structurally complete plan: one volume per `volumeSize` chapters and outlines for the first `outlined` chapters. */
export function minimalPlan(targetChapterCount = 10, options: { volumeSize?: number; outlined?: number } = {}): BookPlan {
  const volumeSize = options.volumeSize ?? targetChapterCount;
  const volumes: VolumePlan[] = [];
  for (let start = 1, order = 1; start <= targetChapterCount; start += volumeSize, order += 1) {
    volumes.push({
      id: `vol-${order}`, order, title: `第${order}卷`, startChapter: start, endChapter: Math.min(targetChapterCount, start + volumeSize - 1),
      goal: '守住青州', opposition: '魔宗', characterIds: ['hero'], climax: `第${order}卷决战`, endState: '宗门得保', carryOver: '',
    });
  }
  const outlined = options.outlined ?? Math.min(50, targetChapterCount);
  const volumeOf = (chapterNumber: number) => volumes.find((volume) => volume.startChapter <= chapterNumber && volume.endChapter >= chapterNumber)!.id;
  return {
    targetChapterCount, volumeCount: volumes.length, mainConflict: '宗门存亡', theme: '代价', protagonistArc: '从怯懦到担当', endingDirection: '守住家园',
    keyTurns: [], volumes, chapters: Array.from({ length: outlined }, (_, index) => minimalOutline(index + 1, volumeOf(index + 1))),
    milestones: [], dependencies: [], openQuestions: [],
  };
}

/** Saves, reviews and approves a plan through the author path. */
export async function approveMinimalPlan(workflow: ChapterWorkflow, workId: string, plan: BookPlan = minimalPlan()): Promise<PlanRevision> {
  const { latest } = await workflow.planOverview(workId);
  const saved = await workflow.savePlan(workId, { plan, baseRevisionId: latest?.id });
  const review = await workflow.reviewPlan(workId, saved.id);
  if (!review.passed) throw new Error(`fixture plan failed review: ${review.issues.map((issue) => issue.message).join('; ')}`);
  return workflow.approvePlan(workId, saved.id);
}

/** A work that passes formal readiness for chapter 1: covenant filled in, design locked, a 10-chapter plan approved. */
export async function createReadyWork(workflow: ChapterWorkflow, title: string, plan: BookPlan = minimalPlan()): Promise<Work> {
  const work = await workflow.createWork(title, readyCovenant());
  await lockMinimalDesign(workflow, work.id);
  await approveMinimalPlan(workflow, work.id, plan);
  return work;
}
