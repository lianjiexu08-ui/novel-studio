# Application layer

这一层把 `novel-service-core` 接到持久化事务和 outbox 边界。

- `ChapterWorkflow` 是 API 和 worker 应调用的用例入口。
- `WorkRepository.transaction()` 是 PostgreSQL 实现需要提供的最小边界。
- 采用成功后才写入 projection、检索索引和导出 outbox 事件。
- 采用失败或状态版本过期时不产生 outbox。
- 同一作品的事务按 work ID 串行；不同作品可以并行。
- `designCandidate()` 导出最新世界包、人物设定和大纲及其编辑基线；`saveDesignCandidate()` 对整套修订统一校验并原子保存。旧基线冲突时拒绝覆盖，成功仅生成提案，保留已批准计划、正文、评审及未解决问题。
- 逐章上下文保留本章之前各类已采纳事实的最新记录，包括资源、法宝、关系及故事线落实。写作器发送事实内容和证据，不仅发送事件 ID；必需材料超过预算时阻断并要求拆分，不静默丢弃长期状态。

当前 `InMemoryWorkRepository` 只用于本地测试和桌面模式。生产实现需要在 Prisma transaction 中实现同样的接口，并让 outbox 与采用事务写入同一数据库事务。

整体修订接口为 `GET /works/:workId/design/candidate` 与 `PUT /works/:workId/design/candidate`。先读取 `{ basePlanId, expectedInputHash, candidate }`，编辑 `candidate` 中的三份文档后提交同一基线，可附 `note`。三份内容必须通过各自API契约、引用和分卷一致性检查；不允许默默删字段、改章节ID或截断内容。接口允许最大20 MiB，超过限制的内容需由作者明确整理后重试。

保存会由服务端分配设计版本并重绑设定集与计划，清除顶层锁定/评审状态；它不执行模型生成、不批准计划，也不关闭阻断问题。调用方应展示返回的结构问题与待解决事项，再针对新版本启动正式内容评审。CLI `scripts/validate-design-candidate.mjs` 与此用例复用同一套预检逻辑。
