import { designReviewRubrics, type DesignReviewInput } from './design-review.ts';

// A global question such as “are all first 50 chapters paced well?” cannot be
// answered by every local partition. Evaluate its actual contribution here;
// the unchanged global rubric is applied after complete coverage in synthesis.
const localStoryCriteria: Record<string, string> = {
  causality: '核验本批行动、转折和后果与其直接前置能否相连，以及本批可对照的兑现是否重复。不得要求每个局部批次独自证明全书因果闭合。',
  timeline: '核算本批提供的日期、行程、疗程、战斗及晋阶时序，核验实际出现的章节与对应分卷安排是否冲突。只为本批某一具体时序依赖请求确切的外部来源，不笼统请求所有其他章节。',
  payoff: '核验本批实际出现的伏笔、秘密、承诺和兑现动作，检查其条件、代价、归宿及可见的重复消费。若本批明确依赖某个未读条目，定位该依赖再补读；不能要求每批都包含全部秘密与开放线。',
  opening: '比较本批实际提供章节的冲突、选择、后果与高潮递进；重复模板或过早终局必须由实际材料证明。需要跨段对比时指出具体场景和待比来源；本批未包含前五十章的全部细纲本身不是材料不足。整体高潮分布留给完整覆盖后的综合。',
};

export function localDesignReviewRubric(input: DesignReviewInput): Record<string, string> {
  return Object.fromEntries(Object.entries(input.rubric).map(([criterion, description]) => [criterion,
    `本项是局部原文检查，pass仅表示本批可检验的安排成立，不代表整个领域通过。${input.area === 'story' && description === designReviewRubrics.story[criterion] ? localStoryCriteria[criterion] ?? description : description}`
    + (input.area === 'power' ? '本批完整提供的各等级境界、功法、法宝和资源规则本身也是待审对象，包含尚未在章纲中使用的高阶规则；公共来源不只是背景。必须检查其自身约束，再核具体角色行动，不能只核低阶行动账而跳过已经给出的高阶能力缺口。' : '')
    + '逐一核验实际提供的规则和行动；本批自身缺少关键约束、预算不闭合或出现矛盾仍须返修。'
    + '仅当本批某条安排的正确性确实依赖其他已存在但未读的来源时，列出具体待核事实与完整所需来源并用awaitingSources；不要把尚未完成整体验收改报为本批缺料，也不能脑补未读事实。',
  ]));
}
