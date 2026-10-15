# 世界包生成保留待解决的阻断问题

生成器把“存在 open 阻断问题”放进长篇规模拒绝条件，导致内容规模和引用均有效的世界包无法作为待评审提案保存。骨架提示词还要求关键问题直接定案，历史阶段只允许不阻断开篇的问题；这与先生成草案、再评审修订的流程不符。

修订将提案生成与质量放行分开：生成阶段保留 unresolvedQuestions 的问题、blocking 与状态；四个阶段提示词要求不确定的关键规则如实记为 open 阻断，不可为继续流程删除、降级或虚标已解决。规模、品阶、资源使用和引用检查仍执行。世界审核、锁定及章节生成的阻断检查没有放宽。

新增三项回归：完整响应和四阶段响应都通过真实 ChapterWorkflow 保存为 proposed，并保留 open/deferred 阻断问题及历史快照；结构审核、锁定和写作仍被阻断；不足规模和无效境界引用仍拒绝。修复前两条保存回归失败，错误为“world pack is too small ... blocking unresolved questions must be resolved”；修复后三项全部通过。

隔离工作区执行 `node scripts/test-all.mjs`：核心类型检查与全部 379 项测试通过。日志 `/tmp/novel-world-proposal-tests.log`。未运行根目录 Prisma 生成、生产迁移或新增真实模型请求。正在使用的 API 与正式设计 62 评审仍绑定冻结 9df9154，本修订尚未部署到该后端。
