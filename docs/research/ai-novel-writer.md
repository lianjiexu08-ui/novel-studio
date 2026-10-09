# 开源核验：EthanYoQ/AI-Novel-Writer

核验日期：2026-10-09（Asia/Shanghai）。方法：公开 GitHub 元信息、固定提交的 README、许可证、2 份 ADR、5 个关键源码文件。未运行项目、未执行测试、未验证真实模型质量或投稿平台接入。以下明确区分源码实现、文档陈述与我们的设计建议。

- 仓库：<https://github.com/EthanYoQ/AI-Novel-Writer>
- 固定提交：`791439eaf87d1703c1c6bae425e67e206cfe0ba2`（提交时间 2026-10-09T02:37:32Z）。
- 根许可证：[GPL-3.0](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/LICENSE)。研究架构与复制代码是不同的复用方式；若复制、修改并分发其桌面代码，需按实际范围履行 GPL 义务。README 提及单独 DSH 插件使用 MIT，但本次核验的是根桌面应用，不能把插件许可证套用到整个仓库。
- 项目定位：[README](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/README.md#L84) 明确它是本地桌面创作编排层，而非在线小说平台。其 Electron/SQLite 和人工确认习惯不应原样套用到我们的网页后台自动运行服务。

## 值得采用的具体机制

### 1. 上下文必须区分来源与性质

[source-selection.ts](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/src/services/workflows/source-selection.ts#L4) 定义作者输入、定稿历史、未来计划、派生定位和参考材料等类别；另有来源标识与未定稿候选的准入条件。选择逻辑拒绝来源未知、项目会话不符和未获准候选，并排除将剧情树当作正文证据的路径。

对我们的优化：将“计划发生”“已经发生”“人物相信”“模型推测”显式隔离；写作上下文不能只是一段混合摘要。作者硬约束、本章任务与必要事实应成为必需项。候选稿可以为连续草拟提供上下文，但必须保留批次、版本、候选标识，不能晋升为已发生事实。

### 2. 必需材料超限不能静默丢失

[source-selection.ts 的选择与结果逻辑](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/src/services/workflows/source-selection.ts#L182) 优先必需材料，记录每次省略；覆盖不完整时返回 `split-required` 或 `capacity-conflict`。必需来源无效与容量不足有不同原因。这里是代码已实现的判断，不依赖模型自行声明“已阅读全部设定”。

对我们的优化：上下文服务返回 `ready / needs_split / blocked`，先尝试按场景拆分、减少可选资料或切换更大窗口模型，仍无法满足才暂停相关任务。不要因 token 额度充裕就忽略单次上下文限制与信息干扰。

### 3. 记录实际使用的上下文及省略理由

[context-snapshot.ts](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/src/services/workflows/context-snapshot.ts#L51) 对纳入材料的来源、版本、哈希、类别、正文及完整省略决策进行稳定排序与哈希，产生可追溯快照标识。源码使用 UTF-8 字节估计，不能将它声称为准确 token 计数。

对我们的优化：为每次写作持久化上下文清单、实际请求、配置版本、省略原因；章节工作台增加“本章依据”抽屉。出现错误时能区分“资料没取到”“取到了但模型忽略”“资料本身已过期”。使用真实模型 tokenizer 或有误差说明的估计器，而非直接复制字节算法。

### 4. 人物动态状态需要字段级来源

[current-character-projection.ts](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/electron/services/current-character-projection.ts#L15) 在位置、能力、身心状态、关键物品等字段上检查 provenance。派生字段必须关联当前有效定稿、正文哈希、版本和投影代次；不满足条件的动态字段从本次提示词投影中移除。数据表里存在某值不等于它能进入当前写作上下文。

[ADR 0017](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/docs/adr/0017-source-bound-character-state-and-continuity.md) 进一步说明：作者值、模型派生值、无法归属的 legacy 值分别处理；作者输入的“当前在某城”不是永久锁定人物位置；旧摘要失效后可以回读版本化原文，但精确引用不等于语义正确。

对我们的优化：`value + provenance + source_revision + effective_story_time + validity`。静态锁定关系与动态位置/伤势分别建模。过期投影不得成为后续写作事实；有可用原文则定点重建，不必默认重抽整本书。不要把 legacy 的保存策略当作“未知来源已得到确认”。

### 5. 定稿与派生输出分开处理，并可安全重试

[finalization-service.ts](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/electron/services/finalization-service.ts#L88) 使用不可变快照、哈希、定稿 ID；重复提交同一冻结请求复用结果，内容不同的请求被拒绝；重试只读取已提交记录。写出失败返回“定稿已提交、实体稿待发布”，不会假装数据库回滚。

[ADR 0003](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/docs/adr/0003-finalization-commit-and-manuscript-publication.md) 说明数据库事务中同时提交定稿与 outbox，实体稿是可恢复投影。服务源码可验证前后阶段与重试行为，本次没有另读 repository 事务实现。

对我们的优化：采用正文和事件记录在业务事务中提交；摘要、索引、导出由 outbox 驱动的派生任务完成，分别显示状态。后续创作所依赖的必要投影未就绪时，不应误报整个链条完成。平台发布也可借鉴提交记录与幂等思路，但必须另有外部结果核验。

重要边界：这里的 `manuscriptPublisher` 是将章节文本写入本地项目目录，不是番茄、起点等平台自动投稿。不得把其 `publicationStatus` 当作已有平台接入证据。

### 6. 审稿、修订、复查绑定原稿版本

[review-revision-generation.ts](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/electron/services/review-revision-generation.ts#L192) 提交审稿或修订时检查来源、产物哈希及生成凭据，用事务保存；重复提交返回既有结果，不同产物冲突；修订还要通过完整性检查，拒绝空结果和无变化结果。审稿结果、修订结果与复查保持 lineage。

[恢复入口](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/electron/services/review-revision-generation.ts#L272) 在来源或模型/模板变化后保留原候选，但 `canResume` 受来源是否仍有效约束，不能直接接着旧上下文执行。

对我们的优化：新增明确状态 `candidate_saved / source_conflict / pending_adoption / adopted / recheck_required`；“生成成功”“保存成功”“采用成功”“复查完成”分别追踪。自动模式按作品策略执行采用，不照搬该项目“目标类问题必须作者点选”的人工审批路径。

## 页面和架构建议

不再增加大量顶层页面。在章节工作台内加入“依据、检查、修订、任务”的关联视图；人物字段可打开来源和历史；任务中心提供可恢复候选、来源冲突与下一步动作；正文采用与派生资料更新状态分别可见。

核心模块补充：

- `context`：来源分类、必需覆盖、分配预算、清单与快照；
- `story-state`：字段级来源、有效时间、派生版本与失效；
- `writing`：不可变候选、采用事务、乐观版本检查；
- `runs`：持久化尝试、产物、检查点与恢复资格；
- `quality`：审稿—修订—复查链路和精确原稿版本；
- `persistence`：outbox、幂等键、派生任务状态。

## 技术栈与是否直接改造

[package.json](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/package.json#L45) 确认 React 19、TypeScript、Vite、Zustand、CodeMirror 6、Electron 41、better-sqlite3、LanceDB。`main` 是 `dist-electron/main.js`；[主进程](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/electron/main.ts#L144) 创建 BrowserWindow，业务通过 Electron 主进程/IPC 与 renderer 协作。本次没有发现可以直接部署的独立 Web API + 常驻无界面 worker 入口，不应把有持久化 generation-run 记录等同于具备云端服务部署能力。

[项目切换实现](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/src/stores/project-store.ts#L120) 在新建、打开或关闭项目时提示并取消当前创作任务，表明现有工作流与桌面项目会话绑定。它与我们的“关网页仍运行、多作品独立后台任务”存在实际架构差异。

[portable-project-format.ts](https://github.com/EthanYoQ/AI-Novel-Writer/blob/791439eaf87d1703c1c6bae425e67e206cfe0ba2/electron/services/portable-project-format.ts#L10) 有明确的可迁移字段策略：保存业务数据、保留不可重放历史、排除机器权限、重建过期投影。值得借鉴迁移契约；这仍不能证明整个桌面运行时可直接迁到云端。

结论：对个人立即试写，它是值得实际试用的候选，可先验证现成工作台是否已足够；对已确定的网页后台服务、尽量自动连续创作及投稿目标，不建议仅凭功能丰富就直接将整个仓库作为主干。推荐先做“能否无 UI 驱动一次完整流程”的小范围验证，再决定 fork、抽离模块或重新实现。个人使用本身不应被误描述为禁止或必须商用授权；根 GPL 条款主要在后续代码复用、修改与分发方案中评估。

作出直接改造决定前还需验证两点：

1. **运行时独立性**：不开 Electron 窗口、浏览器断开、进程重启、两个作品并发时，能否创建/恢复完整创作流程；需要改动哪些 renderer store、IPC、项目会话与文件权限边界。本次是源码推断，未进行实际改造实验。
2. **自动采用与对外发布**：能否以作品策略替换人工选项、完成连续 10–20 章的采用/复查/派生重建；另行验证目标平台登录、提交与结果核验。现有本地实体稿导出不覆盖这一步。

## 不直接采用的部分与证据边界

- 不将 Electron、SQLite、本地项目根目录管理原样移植成服务端架构；保留我们网页/API/worker 与 PostgreSQL 的方向。
- 不复制该项目必须作者逐项选择目标修稿的操作要求。用户要求尽量自动完成；应以可配置自动采用策略和异常处理替代普遍人工确认。
- 不因为仓库文件与测试众多，就声称其真实长篇质量已得到验证。本次只读源码，未执行测试，也没有评估跨数十万字的实稿。
- 没有从本次检查的代码确认商业连载平台提交能力。平台适配仍需独立核实。
- 不需要第一版建设第二套可写的知识图谱、所有可能的元数据或全书反复抽取；先建立权威正文、来源记录与可重建索引。

## 建议新增验收案例

1. 本章必需的锁定关系装不进上下文：返回拆分/阻断并说明，不能遗漏后继续写。
2. 大纲写“未来背叛”，前文尚未发生：历史事实和人物知情范围不能出现这次背叛。
3. 用户修改受伤章节：旧伤势摘要失效，后文不得直接引用过期字段。
4. 模型调用进行时原稿改变：候选保留但不能覆盖当前稿。
5. 定稿已提交、摘要生成失败：正文保留，派生任务重试，不能重复采用或谎报回滚。
6. 恢复候选所依赖的大纲已变：保留可阅读内容，拒绝原断点直接续写。
7. 审稿有原文定位但曲解语义：只能证明定位存在，不能将它当作已证实冲突。
