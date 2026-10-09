# Persistence boundary

`prisma/schema.prisma` 是生产 PostgreSQL 模型草案。

`src/json-repository.ts` 是本地运行用的持久化适配器：

- 使用临时文件加原子重命名写入；
- 保存 Work 版本、事件、状态、关系、计划和检查点；
- 保存 outbox 事件；
- 事务失败时恢复 Work 和 outbox 快照；
- 重新创建 repository 后可以恢复已采用章节。

它实现 `packages/application` 的 `WorkRepository` 接口。接入 Prisma 时保留同样的事务语义，采用正文、事实事件和 outbox 必须在一个数据库事务中提交。
