# Worker

这里是后台任务的最小可靠性实现。

- 任务按 `dedupeKey` 去重。
- 同一作品同一时间只允许一个 running 任务；不同作品可以并行领取。
- 租约过期后任务回到 queued，可由其他 worker 恢复。
- 成功完成是幂等的；重复完成不会覆盖第一次结果。
- handler 失败时默认有限重试，超过 `maxAttempts` 后进入 failed。

`InMemoryTaskStore` 只用于测试。生产实现需要把同样的接口映射到 PostgreSQL 任务表和 Redis 租约/通知，并在数据库中保留任务状态。
