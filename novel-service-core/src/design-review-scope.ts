import { designReviewRubrics, type DesignReviewInput } from './design-review.ts';

// A global question such as “are all first 50 chapters paced well?” cannot be
// answered by every local partition. Evaluate its actual contribution here;
// the unchanged global rubric is applied after complete coverage in synthesis.
const localStoryCriteria: Record<string, string> = {
  causality: '核验本批行动、转折和后果与其直接前置能否相连，以及本批可对照的兑现是否重复。不得要求每个局部批次独自证明全书因果闭合。',
  timeline: '核算本批提供的日期、行程、疗程、战斗及晋阶时序，核验实际出现的章节与对应分卷安排是否冲突。只为本批某一具体时序依赖请求确切的外部来源，不笼统请求所有其他章节。',
  payoff: '核验本批实际出现的伏笔、秘密、承诺和兑现动作，检查其条件、代价、归宿及可见的重复消费。若本批明确依赖某个未读条目，定位该依赖再补读；不能要求每批都包含全部秘密与开放线。',
  opening: '比较本批实际提供章节的冲突、选择、后果与高潮递进；重复模板或过早终局必须由实际材料证明。需要跨段对比时指出具体场景和待比来源；本批未包含前五十章的全部细纲本身不是材料不足。整体高潮分布留给完整覆盖后的综合。',
  pacing: '比较本批实际章节的戏剧目标、场次与后果，核查连续核账、问询或同类救援是否真的带来新变化。执行账可留在作者层，但移字段不等于节奏改善；喘息与情感场也可有价值，不要求章章战斗。具体重复须引用对应场景；本批没有全书其余章节本身不是节奏缺陷。',
  genre: '根据本批作者偏好、世界与实际场景，检查奇异环境、修炼和探索是否改变人物选择、风险或回报，还是只作术语装饰。有限能力与有代价的胜利可以成立；不要借此要求免费升级、越阶或新增万能法宝，也不能仅因本批没有高阶战斗判缺乏玄幻感。需要跨段对照时定位具体已存在来源。',
};

export function localDesignReviewRubric(input: DesignReviewInput, scheduleVersion = 7): Record<string, string> {
  return Object.fromEntries(Object.entries(input.rubric).map(([criterion, description]) => [criterion,
    `本项是局部原文检查，pass仅表示本批可检验的安排成立，不代表整个领域通过。${input.area === 'story' && description === designReviewRubrics.story[criterion] ? localStoryCriteria[criterion] ?? description : description}`
    + (input.area === 'power' ? '本批完整提供的各等级境界、功法、法宝和资源规则本身也是待审对象，包含尚未在章纲中使用的高阶规则；公共来源不只是背景。必须检查其自身约束，再核具体角色行动，不能只核低阶行动账而跳过已经给出的高阶能力缺口。' : '')
    + '逐一核验实际提供的规则和行动；本批自身缺少关键约束、预算不闭合或出现矛盾仍须返修。'
    + (scheduleVersion >= 8 ? '分卷、里程碑和圣经章概要不是完整的逐章执行账；摘要未列某项费用、余量或时机，本身不能证明细纲缺失。先查来源目录中对应的plan/chapters/章节号：如尚未读到，针对该动作以insufficient和awaitingSources请求对应细纲，不能直接判revise；已完整读到仍无必要规则或支出，或原文彼此冲突，必须保留revise。不能凭目录存在就假定细纲会补齐，更不能把摘要缺项自动判pass。规则自身缺陷仍须独立检查，不依赖章纲补救。' : '')
    + (scheduleVersion >= 9 ? '上述细纲补读只适用于sourceLengths确实列出的plan/chapters来源。plan/overview列出的作品细纲范围与本领域来源目录分开：世界领域可以只纳入宏观计划，目录没有某章不等于作品缺少该章。coverage.planRanges仅标明现有分卷/里程碑原文自述的章号范围与标题，帮助定位，不是已读取内容、已实现剧情或可引用证据。对尚未逐章展开的后段，先据范围定位相关宏观原文；尚未读全且它关系本批判断时，用awaitingSources请求这些实际存在的来源，不能只因没有对应逐章ID便断言无材料。核验宏观安排的实际前置、时间、资源、选择与后果；已经完整读到仍缺关键因果、预算或准入时，保留具体不足或返修。不要要求为本次评审一次生成后半本细纲，不得因范围覆盖自动判pass。' : '')
    + '仅当本批某条安排的正确性确实依赖其他已存在但未读的来源时，列出具体待核事实与完整所需来源并用awaitingSources；不要把尚未完成整体验收改报为本批缺料，也不能脑补未读事实。',
  ]));
}

export function designReviewPlanRanges(input: DesignReviewInput): NonNullable<NonNullable<DesignReviewInput['stage']>['coverage']>['planRanges'] {
  return input.sources.flatMap(source => {
    if (!source.id.startsWith('plan/volumes/') && !source.id.startsWith('plan/milestones/')) return [];
    let value: unknown;
    try { value = JSON.parse(source.text); } catch { return []; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const { startChapter, endChapter, title } = value as Record<string, unknown>;
    if (typeof startChapter !== 'number' || !Number.isSafeInteger(startChapter) || startChapter < 1
      || typeof endChapter !== 'number' || !Number.isSafeInteger(endChapter) || endChapter < startChapter) return [];
    return [{ sourceId: source.id, startChapter, endChapter, ...(typeof title === 'string' ? { title } : {}) }];
  });
}

/** Names locate original entity records; they cannot establish any rule or verdict. */
export function designReviewSourceNames(input: DesignReviewInput): Record<string, string> {
  return Object.fromEntries(input.sources.flatMap(source => {
    // Chapter numbers and macro ranges already locate plans. Keep the directory
    // compact by naming world entities and characters, not every chapter title.
    if (!source.id.startsWith('world/') && !source.id.startsWith('story/characters/') && !source.id.startsWith('settings/characters/')) return [];
    let value: unknown;
    try { value = JSON.parse(source.text); } catch { return []; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const { name, title } = value as Record<string, unknown>;
    const label = typeof name === 'string' && name.trim() ? name : title;
    return typeof label === 'string' && label.trim() ? [[source.id, label]] : [];
  }));
}

/** Locate acquisition/training/use candidates without interpreting their meaning.
 * A negative statement ("has not learned X") is still a mention, not evidence
 * that X is available. Missing entries must never establish absence of a skill. */
export function designReviewEntityMentions(input: DesignReviewInput, includeCharacterProfiles = false): Record<string, string[]> {
  const strings = (value: unknown): string[] => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(strings);
    if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
    return [];
  };
  const candidatePrefixes = ['plan/chapters/', 'plan/milestones/', 'story/chapterPlans/', ...(includeCharacterProfiles ? ['story/characters/', 'settings/characters/'] : [])];
  const candidates = input.sources.flatMap(source => {
    if (!candidatePrefixes.some(prefix => source.id.startsWith(prefix))) return [];
    try { return [{ id: source.id, strings: strings(JSON.parse(source.text)) }]; } catch { return []; }
  });
  return Object.fromEntries(input.sources.flatMap(source => {
    if (!['world/techniques/', 'world/artifacts/', 'world/resources/'].some(prefix => source.id.startsWith(prefix))) return [];
    let value: unknown;
    try { value = JSON.parse(source.text); } catch { return []; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const { name, id } = value as Record<string, unknown>;
    const label = typeof name === 'string' && name.trim().length >= 2 ? name : undefined;
    const entityId = typeof id === 'string' && id && source.id.endsWith(`/${id}`) ? id : undefined;
    if (!label && !entityId) return [];
    const mentions = candidates.filter(candidate => candidate.strings.some(text => label && text.includes(label) || entityId && text === entityId)).map(candidate => candidate.id);
    return mentions.length ? [[source.id, mentions]] : [];
  }));
}
