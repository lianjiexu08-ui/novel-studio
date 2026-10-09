# Application layer

这一层把 `novel-service-core` 接到持久化事务和 outbox 边界。

- `ChapterWorkflow` 是 API 和 worker 应调用的用例入口。
- `WorkRepository.transaction()` 是 PostgreSQL 实现需要提供的最小边界。
- 采用成功后才写入 projection、检索索引和导出 outbox 事件。
- 采用失败或状态版本过期时不产生 outbox。
- 同一作品的事务按 work ID 串行；不同作品可以并行。

当前 `InMemoryWorkRepository` 只用于本地测试和桌面模式。生产实现需要在 Prisma transaction 中实现同样的接口，并让 outbox 与采用事务写入同一数据库事务。
