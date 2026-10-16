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

// v23 scopes the growth criterion added after the other local story criteria.
// Older runs retain the original question so their saved inputs still replay.
const localGrowthCriterion = '核验本批实际提供的主角成长安排：人物为何主动选择、想学会或改变什么、获得了哪些学习条件、实际训练或选择、可观察的阶段回报，以及支付与后果是否相连。分清目标、资格、训练和已取得能力；仅说明境界规则或远期愿望不能替代实际行动，本批已给成长缺口或矛盾仍须具体返修。只为本批明确依赖而尚未读到的前置或回报，指出待核事实并请求全部必要来源；不能只因尚未完成全书成长验收便笼统索要全部开篇或后续章纲。允许有意义的知识、判断、关系或职业成长，不强求本批升级，不放宽伤势、训练、资源和寿储限制。全书近期成长承诺及跨阶段兑现仍由完整覆盖后的综合按原标准判断。';

// v24 applies the same local/global distinction to world capacity. Whole-book
// coverage is enforced by the schedule and final synthesis, not by asking each
// partition to independently re-read all remaining chapters.
const localWorldCapacityCriterion = '核验本批实际提供的世界差异、规则作用与扩展空间：地域、资源、制度和势力的差异是否改变本批行动的选择、限制、风险或代价，是否只是换名词、堆条目或重复同一种冲突。已给规则自身的空白、无来源扩张、无代价便利和具体行动矛盾仍须返修；不能因为尚未读到全书其余章节、后续成长或全部跨域节点，就要求本批独自证明目标篇幅与全书预算均已闭合。只有本批某项具体容量判断确实依赖未读的现有来源时，指出该安排、待核事实并请求全部必要来源；全书尚待验收本身不是待补读问题。按已规划阶段衡量本批可见的承载作用，不要求一次写出远期全部地点、物品或后半本细纲。全书世界容量、跨区差异和目标篇幅的匹配仍须在全部原文、跨批检查与必要补读完成后，按原全局标准综合验收。';

// v20 gives power partitions the same local/global distinction as story
// partitions. A local reviewer must still inspect every supplied high-tier
// rule, but need not independently re-read the entire unseen inventory.
const localPowerCriteria: Record<string, string> = {
  tiers: '逐项核验本批实际提供的境界、功法、法宝和资源分级，以及本批角色起点、晋阶和施术所需的资格。境界承载不等于已掌握术式：作者明确的开篇前学习可作为初始设定，书内新增学习须有前置；仍需核具体训练、实测、对象与使用门槛。若已读条目或行动明确依赖某个未读术式、器物或资源，指出该条目、具体依赖和所需原文再请求补读；目录中其他未读等级或物品的存在本身，不构成本批必须全读的理由。全等级分级的一致性由全部原文批次、交叉检查与综合共同验收。',
  costs: '核算本批实际给出的规则成本和行动收支：力量来源、寿储、法力、资源剂量、恢复、冷却及不可逆代价应分别闭合；疗伤不等于延寿，未来收入不能预支。已给高阶规则即使尚未用于章纲，也必须审其自身成本、供能和限制。对具体已读安排确实缺少的前置账目，定位完整必要来源请求补读；不能仅因为其余资源表或后续章节尚未读到，就要求本批独自证明全书预算闭合。材料中已经存在的超支、重复收入或免费恢复必须保留返修。',
  counters: '逐项审查本批已给能力的对象、范围、上限、打断、撤退和反制，以及本批越阶或同阶胜利的实际条件；公共高阶规则也不能跳过。若已读能力明确援引另一个未读术式来证明反制或上限，应说明具体关系并补读相应原文；不要把未使用、未关联的全部功法法宝和后续章节都当成本批待核材料。已给规则自身的万能能力、无代价越阶或明确冲突仍须返修，整体反制体系由全量覆盖后的综合检查。',
};

// v25 scopes character checks to the supplied arrangements. Final synthesis
// still evaluates the unchanged whole-book character rubric after full coverage.
const localCharacterCriteria: Record<string, string> = {
  agency: '核验本批实际提供的人物目标、利益冲突、关键选择、失败代价和对情节的影响：角色是否因自身利益采取行动，配角是否有拒绝、退出或改变条件的选择，行动后果是否改变本批局面。只有口头目标、被动工具人、无动机转变或取消代价等已给设计问题仍须具体返修。判断某个已读选择确实依赖未读的前置或后果时，指出该选择与待核事实，请求全部必要来源；不能仅因本批没有连续包含前50章或全书全部人物兑现，就把其余章纲整体列成本批缺料。全书人物能动性与连续影响留给完整覆盖后的综合验收。',
  relationships: '核对本批实际出现的关系初始状态、促成变化的行动与付出、生效时点及保留边界，并比较本批可见的关系档案与章纲。终局标签不能代替过程，救援不自动产生信任、服从或免责，同一时点的关系冲突与重复消费代价必须返修。已读变化确实依赖未提供的关系原档、前一阶段或另一处安排时，指出具体关系、时点和待核事实，请求全部必要来源；不能只因本批尚未完成前50章或全书全部关系验收，就要求补读所有其他关系或连续章纲。整体关系链仍须在完整覆盖后按原标准综合验收。',
  knowledge: '核验本批人物知道、相信或误解什么，从谁、何时、通过什么实际来源获得，以及这些认知如何影响选择和弧光。区分读者视角、拟定阶段与角色当时已知；已给的提前知情、消息未到却已知、无来源推断或认知转变断裂必须返修。某项已读认知确实依赖未读秘密原档、消息节点或此前知情阶段时，指出人物、命题、时点与待核事实，请求全部必要来源；不能仅因为本批未覆盖前50章或全书全部揭露过程，就笼统索要其余连续章纲。全书秘密、误解和人物弧光的连续性仍由完整覆盖后的综合验收。',
};

export function localDesignReviewRubric(input: DesignReviewInput, scheduleVersion = 7): Record<string, string> {
  if (input.purpose === 'chapter_review') return Object.fromEntries(Object.entries(input.rubric).map(([criterion, description]) => [criterion,
    `本项评审的是共享 draft 正文。${description} 本批只对照实际携带的设定、计划、历史与正文；pass只表示本批没有发现该维度问题，整体结论由全量原文、跨批检查及综合决定。不要把未读的无关后续计划当作本章必须兑现的任务，也不要要求本批独自证明全书一致。只有具体判断依赖目录中确实存在但未读的来源时，用insufficient和awaitingSources列全必要来源并说明问题；不要凭未读资料补完正文。已发现的正文矛盾、缺乏动机或质量问题必须revise，不能用等待掩盖。`,
  ]));
  return Object.fromEntries(Object.entries(input.rubric).map(([criterion, description]) => [criterion,
    `本项是局部原文检查，pass仅表示本批可检验的安排成立，不代表整个领域通过。${scheduleVersion >= 24 && input.area === 'world' && criterion === 'capacity' && description === designReviewRubrics.world.capacity ? localWorldCapacityCriterion
      : input.area === 'story' && description === designReviewRubrics.story[criterion] ? (scheduleVersion >= 23 && criterion === 'growth' ? localGrowthCriterion : localStoryCriteria[criterion] ?? description)
      : scheduleVersion >= 20 && input.area === 'power' && description === designReviewRubrics.power[criterion] ? localPowerCriteria[criterion] ?? description
      : scheduleVersion >= 25 && input.area === 'characters' && description === designReviewRubrics.characters[criterion] ? localCharacterCriteria[criterion] ?? description : description}`
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

/** Copy explicit endpoint IDs; names are added only for uniquely identified profiles.
 * No relationship state, direction reversal, aliases or transitive links are inferred. */
export function designReviewSourceRelationships(input: DesignReviewInput): NonNullable<NonNullable<DesignReviewInput['stage']>['coverage']>['sourceRelationships'] {
  const records = input.sources.flatMap(source => {
    if (!['story/characters/', 'settings/characters/', 'story/relationships/', 'settings/relationships/'].some(prefix => source.id.startsWith(prefix))) return [];
    try {
      const value: unknown = JSON.parse(source.text);
      return value && typeof value === 'object' && !Array.isArray(value) ? [{ sourceId: source.id, value: value as Record<string, unknown> }] : [];
    } catch { return []; }
  });
  const names = new Map<string, Array<unknown>>();
  for (const { sourceId, value } of records) {
    if (!sourceId.startsWith('story/characters/') && !sourceId.startsWith('settings/characters/')) continue;
    if (typeof value.id === 'string' && value.id.trim()) names.set(value.id, [...(names.get(value.id) ?? []), value.name]);
  }
  const name = (id: string): string | undefined => {
    const matches = names.get(id);
    return matches?.length === 1 && typeof matches[0] === 'string' && matches[0].trim() ? matches[0] : undefined;
  };
  return Object.fromEntries(records.flatMap(({ sourceId, value }) => {
    if (!sourceId.startsWith('story/relationships/') && !sourceId.startsWith('settings/relationships/')) return [];
    const { fromCharacterId, toCharacterId, kind } = value;
    if (typeof fromCharacterId !== 'string' || !fromCharacterId.trim() || typeof toCharacterId !== 'string' || !toCharacterId.trim()) return [];
    const fromName = name(fromCharacterId), toName = name(toCharacterId);
    return [[sourceId, { fromCharacterId, toCharacterId, ...(fromName ? { fromName } : {}), ...(toName ? { toName } : {}),
      ...(typeof kind === 'string' && kind.trim() ? { kind } : {}) }]];
  }));
}

/** One explicit planning edge is navigation, never evidence of feasibility.
 * Do not infer links from prose or recursively pull the entire book into a
 * follow-up. Ambiguous and dangling object IDs cannot select a source. */
export function designReviewPlanNeighbors(input: DesignReviewInput, sourceIds: string[]): string[] {
  let overview: unknown;
  try { overview = JSON.parse(input.sources.find(source => source.id === 'plan/overview')?.text ?? 'null'); } catch { return []; }
  if (!overview || typeof overview !== 'object' || Array.isArray(overview)) return [];
  const dependencies = (overview as Record<string, unknown>).dependencies;
  if (!Array.isArray(dependencies)) return [];
  const byObjectId = new Map<string, string[]>();
  for (const source of input.sources) {
    if (!['plan/chapters/', 'plan/milestones/', 'plan/volumes/'].some(prefix => source.id.startsWith(prefix))) continue;
    let value: unknown;
    try { value = JSON.parse(source.text); } catch { continue; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const id = (value as Record<string, unknown>).id;
    if (typeof id === 'string' && id) byObjectId.set(id, [...(byObjectId.get(id) ?? []), source.id]);
  }
  const unique = (id: unknown): string | undefined => typeof id === 'string' && byObjectId.get(id)?.length === 1 ? byObjectId.get(id)![0] : undefined;
  const seeds = new Set(sourceIds), neighbors = new Set<string>();
  for (const edge of dependencies) {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) continue;
    const from = unique(edge.sourceId), to = unique(edge.targetId);
    if (!from || !to) continue;
    if (seeds.has(from) && !seeds.has(to)) neighbors.add(to);
    if (seeds.has(to) && !seeds.has(from)) neighbors.add(from);
  }
  return input.sources.filter(source => neighbors.has(source.id)).map(source => source.id);
}

/** Explicit chapter cast IDs locate complete biographies, not proof of skill.
 * Never infer a cast member from names in prose or follow relationship edges. */
export function designReviewPlanCharacters(input: DesignReviewInput, sourceIds: string[]): string[] {
  const seeds = new Set(sourceIds), characterIds = new Set<string>();
  for (const source of input.sources) {
    if (!seeds.has(source.id) || !source.id.startsWith('plan/chapters/')) continue;
    let value: unknown;
    try { value = JSON.parse(source.text); } catch { continue; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const ids = (value as Record<string, unknown>).characterIds;
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string' && id) characterIds.add(id);
  }
  const matches = new Map<string, string[]>();
  for (const source of input.sources) {
    if (!['story/characters/', 'settings/characters/'].some(prefix => source.id.startsWith(prefix))) continue;
    let value: unknown;
    try { value = JSON.parse(source.text); } catch { continue; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const id = (value as Record<string, unknown>).id;
    if (typeof id !== 'string' || !characterIds.has(id) || !source.id.endsWith(`/${id}`)) continue;
    matches.set(id, [...(matches.get(id) ?? []), source.id]);
  }
  const unique = new Set([...matches.values()].filter(ids => ids.length === 1).flat());
  return input.sources.filter(source => unique.has(source.id)).map(source => source.id);
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
