# 开源项目对照与方案优化

版本：研究结论 v1 / 设计建议 v0.4  
核验日期：2026-10-09（Asia/Shanghai）

## 结论

既有开源项目证明了局部改稿、分层上下文、章节定稿和状态回写都有可以参考的具体实现。我们的方案应优先补齐可审查的上下文、计划与正文落实映射、来源绑定的状态、检查覆盖状态，以及采用后的派生任务恢复；界面和初期范围同时收敛。

不建议仅因项目宣称支持几十万或数百万字，就认定它满足自动长篇和平台连载需求。本次实际阅读固定版本源码、README、许可证和部分架构文档，没有安装、运行生成任务或验证真实投稿。

## 1. 研究对象

| 项目 | 固定提交 | 实际阅读的重点 | 对本项目的主要价值 |
| --- | --- | --- | --- |
| [AI_NovelGenerator](https://github.com/YILING0013/AI_NovelGenerator) | f9aefef90b1493c579d7f72547efb4a3d8a0da25 | 章节上下文、定稿、向量库、审校与 GUI 调用 | 简洁写作步骤；近期原文、摘要、状态、检索分层 |
| [Long-Novel-GPT](https://github.com/MaoXiaoYuZ/Long-Novel-GPT) | 107c31e54686947a6d00404e332475a60b66e630 | Writer、剧情正文映射、局部修改、Flask 流式 API | 剧情与正文对应、只读上下文与修改目标分离 |
| [AI-Novel-Writer](https://github.com/EthanYoQ/AI-Novel-Writer) | 791439eaf87d1703c1c6bae425e67e206cfe0ba2 | 来源选择、上下文快照、人物投影、定稿、审稿修订 | 可追溯上下文、字段级来源、恢复与定稿边界 |
| [天命](https://github.com/zy-zmc/tianming-novel-ai-writer) | 7786fb72d27ba31fd652d8107f2bbde8e05a69fa | 事实快照、CHANGES、账本、门禁、提交恢复 | 明确状态变更、规则检查、誓约和期限记录 |

逐项目证据与固定提交链接保存在：
- research/ai-novelgenerator.md
- research/long-novel-gpt.md
- research/ai-novel-writer.md
- research/tianming.md

先前候选地址 CQlio/AI_NovelGenerator 与 yudot/Long-Novel-GPT 返回 404，经 GitHub 仓库搜索找到表中地址。

## 2. 优化一：上下文选择变成可检查的产物

来源：
- [AI_NovelGenerator 的章节上下文](https://github.com/YILING0013/AI_NovelGenerator/blob/f9aefef90b1493c579d7f72547efb4a3d8a0da25/novel_generator/chapter.py#L370)
- [AI-Novel-Writer 的必需来源选择](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/src/services/workflows/source-selection.ts#L182)
- [上下文快照](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/src/services/workflows/context-snapshot.ts#L51)

已有设计只有“组装相关上下文”，不足以解释生成出错的原因。应让 context 模块返回：
- 资料角色：作者硬约束、已发生事件、人物认知、未来计划、候选稿、风格参考。
- 来源与版本、正文位置、选入理由、是否必需。
- 未纳入内容和省略原因。
- 估算用量、估算方式、为输出预留的额度。
- 完整性状态：ready / needs_split / blocked。
- 上下文快照 ID 与实际调用配置版本。

必需材料超限时，先缩减可选资料、拆分场景或使用作品允许的更大窗口模型。仍不满足就暂停相关步骤，不能静默遗漏锁定关系后继续生成。

页面放在章节侧栏“本章依据”。目标是区分没有取到资料、取到了但模型没遵守、资料已经过期三类问题。

## 3. 优化二：大纲节点必须在正文中得到验证

来源：
- [Long-Novel-GPT 的目标与上下文](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/107c31e54686947a6d00404e332475a60b66e630/core/writer.py#L168)
- [剧情与正文对齐](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/107c31e54686947a6d00404e332475a60b66e630/core/writer.py#L461)
- [非重叠补丁](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/107c31e54686947a6d00404e332475a60b66e630/core/writer.py#L234)

增加 PlanRealization，记录 plotNodeId、chapterVersionId、sceneId、evidenceSpan、status、reason。

状态为：未落实、部分落实、已落实、偏离、信息不足。模型映射必须验证证据存在于当前目标版本，不得把邻章只读上下文误当本章已完成事件。

示例：大纲计划第十章交付玉佩，正文只写双方讨论交易。系统不能更新玉佩持有人，而应提示节点尚未落实。

编辑时区分 target 和 readOnlyContext。并行产生的补丁先检查范围冲突，再由同一采用流程应用；不能各自覆盖正文。

## 4. 优化三：人物与资源状态记录到字段来源

来源：
- [AI-Novel-Writer 的人物字段投影](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/electron/services/current-character-projection.ts#L15)
- [天命的变更类型](https://github.com/zy-zmc/tianming-novel-ai-writer/blob/7786fb72d27ba31fd652d8107f2bbde8e05a69fa/Services/Modules/ProjectData/Models/Tracking/TrackingChangeModels.cs#L6)

状态字段保存 value、sourceRevision、evidenceSpan、effectiveStoryTime、origin、validity。人物的当前位置由正文派生，血缘关系可以是作者锁定事实，作者未来安排的人物转变则是计划。三者不能混成一份无类型摘要。

关系至少区分：
- 血缘与身份；
- 师徒、隶属等社会关系；
- 单向信任和情绪；
- 公开立场与隐藏意图；
- 角色对关系的认知。

兄弟也可以是敌人；对方的信任不必对称。不要用单个“盟友/敌人”标签代替全部关系。

玄幻优先增加 Obligation：誓约、承诺、交易条件、截止时间，带当事人、触发条件、后果、状态与证据。先使用关系表，不引入另一套权威图数据库。

## 5. 优化四：核对正文实际发生了什么

来源：
- [天命的变更声明与检查入口](https://github.com/zy-zmc/tianming-novel-ai-writer/blob/7786fb72d27ba31fd652d8107f2bbde8e05a69fa/Services/Modules/ProjectData/Implementations/Generation/GenerationGate/GenerationGate.PublicMethods.cs#L87)

候选稿可以附 proposedChanges。审查阶段由独立抽取步骤从正文提取 observedChanges，先只给它正文与必要历史，避免把写作者声明直接当答案。

比对：
1. 正文发生变化，声明是否漏报；
2. 声明变化，正文是否有依据；
3. 与历史快照、锁定约束是否冲突；
4. 是客观事件、台词声称、人物猜测还是未来计划。

重点检查人物生死、物品归属、能力、移动、关系、秘密获知、誓约与期限。每条采用事件绑定原文版本与证据位置。

独立抽取并不能消除同一模型的相关性错误。它提供另一条核对路径，结果仍要接受规则、证据和已知案例评估。不能把双模型赞同作为正确性证明。

## 6. 优化五：审查未完成不是审查通过

来源：
- [AI_NovelGenerator 的一致性检查](https://github.com/YILING0013/AI_NovelGenerator/blob/f9aefef90b1493c579d7f72547efb4a3d8a0da25/consistency_checker.py#L27) 是一次模型调用，UI 调用还存在未传完整设定的情况。
- [天命的漏报检查异常处理](https://github.com/zy-zmc/tianming-novel-ai-writer/blob/7786fb72d27ba31fd652d8107f2bbde8e05a69fa/Services/Modules/ProjectData/Implementations/Generation/GenerationGate/GenerationGate.PublicMethods.cs#L233) 在异常跳过后可以返回 Success=true。

每一类检查独立记录：
- passed：执行成功并满足该项条件。
- failed：有足够依据的违规或冲突。
- inconclusive：执行了，但证据或结果不足以判断。
- unavailable：没有执行成功，例如超时或结构化输出无效。
- not_applicable：有明确的、不依赖正文自述的适用性理由。

必需检查的失败、不确定或不可用不得被汇总分掩盖。修复或重试仍无解时，保留候选，暂停受影响章节。非阻断的文风建议可以按作品策略处理。

质量中心显示实际覆盖情况，包括没有运行的检查。降级不是成功的别名。

## 7. 优化六：采用成功和资料更新完成分别显示

来源：
- [AI-Novel-Writer 的定稿服务](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/electron/services/finalization-service.ts#L88)
- [定稿事务与实体稿 ADR](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/docs/adr/0003-finalization-commit-and-manuscript-publication.md)
- [AI_NovelGenerator 的定稿写入](https://github.com/YILING0013/AI_NovelGenerator/blob/f9aefef90b1493c579d7f72547efb4a3d8a0da25/novel_generator/finalization.py#L95) 展示单文件原子替换与跨文件事务的区别。

保持数据库事务中采用正文版本、已验证事件与状态变化、证据，以及后续任务通知。派生摘要、检索索引、导出文件由持久任务执行。

章节可以显示：
- 正文已采用；
- 必需状态已提交；
- 相关摘要待更新；
- 检索索引更新失败，可重试；
- 发布核验状态。

可选索引失败不撤销正文，也不允许旧索引冒充当前版本。下一章必须依赖的投影未就绪时等待，或走明确的原文与权威状态回读路径。

注意：AI-Novel-Writer 的 manuscriptPublisher 输出本地实体稿，不是网文平台投稿功能。

## 8. 代码结构和界面收敛

保留 TypeScript、Web/API/worker、PostgreSQL 的建议，不因参考项目使用 Python 或 C# 而立即改变技术栈。具体框架仍需通过最小流程实现验证。

扩展既有模块即可：
- context：来源分类、容量、覆盖、快照。
- outline：场景计划与正文落实。
- editing：目标和只读上下文、非重叠补丁。
- story-state：字段来源、义务与期限、版本失效。
- quality：检查执行状态与覆盖、声明/抽取比对。
- writing / runs / persistence：采用事务、派生任务与恢复资格。

新增数据对象：ContextManifest、ContextItem、PlanRealization、ChangeSet、StateProvenance、Obligation、CheckExecution、ProjectionTask。

首版主导航收敛为“作品、任务、设置”；开书是作品列表的主要操作。
作品内导航保持“概览、创作、设定、大纲、质量、发布”六项：
- 创作包含原章节工作台，侧栏集中放本章依据、节点落实、审稿问题、修订和任务。
- 设定容纳世界、人物、关系、弧光、事实与文风。
- 数据结构可以完整，但用户先看到当前写作所需内容。

首版不为图谱、上下文、伏笔、每个审稿角色再建一批独立顶层页面。原路由可保留为深链接，导航分组更集中。

## 9. 直接改造开源项目还是独立实现

当前结论：机制可以立即纳入设计，整仓 fork 尚不能定论。

AI-Novel-Writer 是本次最值得做进一步可行性验证的候选，因为其版本、来源与恢复机制较完整。但它是 Electron/SQLite 桌面应用；[项目切换逻辑](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/src/stores/project-store.ts#L120) 会取消当前创作任务，与我们的常驻后台、多作品任务目标不同。

开工前做小范围验证：
1. 是否能把完整创作链独立于界面运行，并承受连接断开、重启和不同作品并发；
2. 是否能按作品策略自动采用、连续写作，不要求逐章人工批准；
3. 数据与版本是否能迁移到服务数据库；
4. 10—20 章实稿与跨卷测试是否达到基础质量要求；
5. 第一投稿平台的实际接入与核验方式；
6. 直接复用、派生与分发范围对应的许可要求。

这些验证不要求向真实平台发布试稿。平台动作可以先在可控替身或平台允许的草稿能力中验证，真实提交仍遵循作品中已配置的发布规则。

若迁移工作比独立实现关键流程更大，就保留独立架构，只借鉴已验证机制。不能把桌面“可用”直接等同于云端服务“可部署”。

## 10. 许可证与复用状态

- AI_NovelGenerator：固定提交的 LICENSE 为 AGPL-3.0。
- AI-Novel-Writer：根 LICENSE 为 GPL-3.0；单个插件的许可不能替代根应用许可。
- Long-Novel-GPT：本次元数据和完整文件树未确认许可证。
- 天命：README 写 MIT 又提及商用另行授权，固定提交树未发现 LICENSE；复用权限需要澄清。

本次是阅读和架构参考，没有把第三方实现纳入应用代码。研究快照与笔记仅用于证据追溯。没有因为许可状态而暂停本次架构优化。

## 11. 新增验收

1. 本章必需的锁定关系无法进入上下文：拆分或阻断，不能静默遗漏。
2. 计划交付物品但正文未交付：节点未落实，归属不变。
3. 模型把节点映射到只读邻章：不能作为本章落实证据。
4. 兄弟之间敌对：保留血缘和敌对立场，不误判为互斥。
5. 正文发生变化但声明漏报：比对检出；声明有变化但无正文证据：不入账。
6. 多个局部补丁重叠：报告冲突，不能按到达顺序覆盖。
7. 必需检查超时：unavailable，候选保留但不得发布。
8. 采用成功而索引失败：正文只采用一次，索引恢复后使用正确版本。
9. 修改原文使人物状态过期：恢复该字段依据后再用于相关续写。
10. 续写候选保留但来源版本变化：不能直接从旧断点继续执行。
11. 检索只返回当前作品、允许版本与适当故事时间范围内的材料。
12. 回退采用版本后，关系、物品、知识与摘要投影保持一致或明确等待重建。

## 12. 证据边界

本次完成静态源码核验和设计对照，没有运行开源项目、生成小说、提交投稿或执行开源测试。项目宣传的长篇质量和商业成绩没有独立核实。

因此“可借鉴”表示看到具体实现，“需要保留的保障”是我们针对服务目标的设计决定，“需要验证”表示尚无运行证据。三者在实施与验收时继续分别记录。

