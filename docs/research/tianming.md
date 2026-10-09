# 天命 AI 小说写作系统：源码核查笔记

核查日期：2026-10-09（Asia/Shanghai）。固定提交：`7786fb72d27ba31fd652d8107f2bbde8e05a69fa`。本笔记只基于公开源码静态阅读，未安装、编译、运行、验证模型效果或长期生成结果。

仓库：https://github.com/zy-zmc/tianming-novel-ai-writer

## 结论

该项目有真实的 .NET/WPF 状态追踪、生成门禁和落盘恢复代码，不是只有提示词。适合参考“按章取状态 → 正文与变更声明 → 校验 → 正文与状态落地”的闭环，以及秘密知情人、誓约、截止期限、跨卷归档等维度。它是桌面应用，不能作为本地可迁云服务的直接技术底座。README 的“3000 章依然连贯”是项目宣传，静态代码不构成质量保证。

许可证状态不清：README 标 MIT，但该提交递归文件树未发现 LICENSE，GitHub metadata license 为 null；README 又要求任何商用先联系作者授权。不能据此把它认定为可直接用于商业 SaaS 的 MIT 依赖。当前只借鉴机制，不纳入代码依赖。

## 实际代码证据

1. [GenerationGate.ValidateAsync](https://github.com/zy-zmc/tianming-novel-ai-writer/blob/7786fb72d27ba31fd652d8107f2bbde8e05a69fa/Services/Modules/ProjectData/Implementations/Generation/GenerationGate/GenerationGate.PublicMethods.cs#L87)：先解析变更协议，再校验短 ID 引用和账本变化；随后并行检查未知实体、描述、世界规则；还有蓝图出场和漏报检查。失败在多个阶段提前返回。
2. [FactSnapshotExtractor.ExtractSnapshotAsync](https://github.com/zy-zmc/tianming-novel-ai-writer/blob/7786fb72d27ba31fd652d8107f2bbde8e05a69fa/Services/Modules/ProjectData/Implementations/Tracking/FactSnapshotExtractor/FactSnapshotExtractor.PublicMethods.cs#L13)：根据章节相关实体构建多维状态快照，部分维度按数量或相关性限制；秘密知情人、誓约和截止状态也进入上下文。说明“无限 token”仍不应等于无选择地填入所有历史。
3. [TrackingChangeModels](https://github.com/zy-zmc/tianming-novel-ai-writer/blob/7786fb72d27ba31fd652d8107f2bbde8e05a69fa/Services/Modules/ProjectData/Models/Tracking/TrackingChangeModels.cs#L6)：定义人物状态、关系、冲突、伏笔、移动、物品转移、秘密、誓约和期限等变更。其中有 CausedBy，但这些声明类型没有统一的段落证据位置和正文版本字段；本项目需要补齐。
4. [LedgerConsistencyChecker](https://github.com/zy-zmc/tianming-novel-ai-writer/blob/7786fb72d27ba31fd652d8107f2bbde8e05a69fa/Services/Modules/ProjectData/Implementations/Tracking/LedgerConsistencyChecker.cs#L44)：有规则化检查，包含伏笔、冲突进展、人物变化、移动链、物品持有和承诺终止动作等。
5. [ContentGenerationCallback](https://github.com/zy-zmc/tianming-novel-ai-writer/blob/7786fb72d27ba31fd652d8107f2bbde8e05a69fa/Services/Modules/ProjectData/Implementations/Generation/ContentGenerationCallback/ContentGenerationCallback.Core.cs#L273)：落盘前再次验证；先写变更 WAL，再 staging 文件、备份和替换正文、更新追踪记录、flush、VerifyCommitSync 后删 WAL；失败区分正式数据与可重建索引，有补偿恢复逻辑。适合借鉴恢复意识，但我们的数据库服务应通过事务提交正文版本、事件与状态，不复制文件式提交方案。

## 不能直接继承的保证与边界

- [门禁 L233-L285](https://github.com/zy-zmc/tianming-novel-ai-writer/blob/7786fb72d27ba31fd652d8107f2bbde8e05a69fa/Services/Modules/ProjectData/Implementations/Generation/GenerationGate/GenerationGate.PublicMethods.cs#L233)：漏报检测异常被记录为“非致命，跳过”，随后可设置 Success=true。我们的必选检查需要独立记录 passed / failed / unknown / unavailable；必选检查未执行或故障不能获得可发布状态。
- [未知实体 L165-L190](https://github.com/zy-zmc/tianming-novel-ai-writer/blob/7786fb72d27ba31fd652d8107f2bbde8e05a69fa/Services/Modules/ProjectData/Implementations/Generation/GenerationGate/GenerationGate.PublicMethods.cs#L165)：按未知实体总数 > 5 或背景实体 > 3 阻断。数量阈值不等于逻辑正确，应改为临时候选实体、别名消歧、关键程度与引用完整性；不能把每个龙套都要求预建完整人物卡。
- [关系检查 L727](https://github.com/zy-zmc/tianming-novel-ai-writer/blob/7786fb72d27ba31fd652d8107f2bbde8e05a69fa/Services/Modules/ProjectData/Implementations/Tracking/LedgerConsistencyChecker.cs#L727)：本方法用无向人物对与关键词归类同章“盟友/敌人”，可能把兄弟且仇敌等合理关系当冲突。我们的亲属、社会关系、单向情绪、公开立场与隐藏意图应分别建模，不能压成单个关系标签。
- [移动与持有 L609](https://github.com/zy-zmc/tianming-novel-ai-writer/blob/7786fb72d27ba31fd652d8107f2bbde8e05a69fa/Services/Modules/ProjectData/Implementations/Tracking/LedgerConsistencyChecker.cs#L609)：移动链和物品转移有实质规则，但位置/持有人不符时，若来源存在于上下文名单会允许跳过（L654、L702）。我们的“出现在上下文中”不能作为状态转移合法的证据，必须要求补足事件依据。
- [README 重点缺失](https://github.com/zy-zmc/tianming-novel-ai-writer/blob/7786fb72d27ba31fd652d8107f2bbde8e05a69fa/README.md#L245)：作者明确列出 CHANGES 中英映射、漏报反馈注入、状态过早记录等待修项。不应把该仓库按生产验证成熟系统推荐。
- [README 许可](https://github.com/zy-zmc/tianming-novel-ai-writer/blob/7786fb72d27ba31fd652d8107f2bbde8e05a69fa/README.md#L270)：MIT 声明与商用另行授权文字并存，需先澄清再考虑复用源码。

## 对我们方案的具体优化

1. **双证据事实变更**：写作模型提交 proposedChanges；独立抽取器从候选正文抽取 observedChanges；比对两者和历史快照。每条采用事件带 chapterRevisionId、evidenceSpan、entityId、storyTime、extractionVersion。模型声明不能直接成为事实。
2. **显式上下文包**：每次生成保存 contextManifest，列出硬约束、当前状态、近期原文、远期证据、未回收承诺和召回原因，并注明来源版本。优先必需约束，剩余额度再用于相关历史。正文一改，依赖相应版本的上下文与检查结果失效。
3. **事务采用与异步索引**：在 PostgreSQL 事务中提交采用版本、已验事件、状态变化和 outbox；向量/关键词索引由后台重建。索引故障记为降级状态，不回滚已成功提交的正文，也不能让过期索引悄悄参与下一章。
4. **事实账本增加义务与截止**：将承诺、誓约、交易条件、任务期限作为专门记录，含当事人、触发条件、后果、状态、时间范围、证据。玄幻的心魔誓、宗门约定、秘境期限都适用。
5. **关系拆维度**：immutable kinship 与 socialRole、directionalTrust、declaredAllegiance、privateIntent 分开，支持有效时间与角色认知范围。固定关系锁定不阻止感情与政治立场变化。
6. **检查覆盖率可见**：页面显示检查类别是否实际执行、证据缺失与降级情况。硬失败阻断，语义疑点按置信度和严重度分流；不能以一个 Success 或总分掩盖必选检查缺席。
7. **先验证状态闭环**：连续生成小规模章节时，先证明“废稿不入账、改稿能撤销旧事件、掉电恢复不双写、检查故障不发布”。不要用总字数或连续调用成功代替长篇质量验收。

## 新增验收案例

- 正文写物品转交，变更声明漏报：检出差异，未通过前不能更新下一章事实快照。
- 变更声明声称得到秘籍，但正文无证据：拒绝事实入账。
- 兄弟互为仇敌，固定血缘仍成立：不误判关系冲突。
- 候选章节同时有“角色认为 A 是父亲”和作者事实“B 是父亲”：分别存认知与客观事实。
- 核心检查器异常：章节标记检查未完成，不能作为合格存稿发布。
- 采用事务成功、向量索引失败：正文只采用一次，索引可恢复，下一章避免使用过期索引。
- 原物主持有 X，另一个被列入上下文的角色出售 X：不能因角色被提及而放过所有权冲突。

原始公开片段仅作为本地研究证据位于 tianming-source/，未作为项目依赖引入。