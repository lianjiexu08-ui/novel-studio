# 给后续模型的开发提示词

你正在继续实现 `D:\project\novel-studio` 的个人小说自动创作与连载服务。

请先阅读：

1. `IMPLEMENTATION-HANDOFF.md`
2. `docs/MASTER-PLAN.md`
3. `docs/PRODUCT-AND-ARCHITECTURE.md`
4. `novel-service-core/src/core.ts`
5. `novel-service-core/test/core.test.ts`
6. `packages/contracts/src/index.ts`
7. `packages/model-gateway/src/index.ts`
8. `packages/persistence/prisma/schema.prisma`
9. `packages/application/src/index.ts`
10. `packages/worker/src/index.ts`
11. `apps/api/src/server.ts`

先运行：

```powershell
cd D:\project\novel-studio\novel-service-core
npm test
```

## 你的实现目标

把当前内存领域切片逐步接到可恢复的正式服务：

1. 保留现有五项核心测试和所有状态不变量。
2. 增加 `packages/contracts`，用 Zod 或 JSON Schema 定义 API、模型输出、事件和任务载荷。
3. 根据已有 `packages/persistence/prisma/schema.prisma` 实现 `packages/application` 的 `WorkRepository`、migration、repositories 和事务封装。
4. 在已有模型网关端口上增加 Key 服务端加密保存、重试、限流、能力探测和用量审计。
5. 将已有 worker 任务接口映射到 PostgreSQL/Redis，补充任务恢复、后台调度和 outbox 消费；同一作品章节串行，不同作品受控并行。
6. 将 `apps/api` 的内存 provider/repository 替换为真实模型和 PostgreSQL/Redis，再做 React 页面；页面必须展示依据、证据、状态版本和失效影响。

## 强制规则

- 候选事件不得进入正式状态。
- `failed`、`inconclusive`、`unavailable` 或缺失的必需检查都阻断采用。
- 锁定关系、锁段和作者硬约束不能由模型解除。
- 大纲未来节点不能冒充已发生事实。
- 正文抽取结果必须与模型声明的变化比对；没有正文证据不能入账。
- 早章修改后，受影响后文、检查、索引和发布资格都必须失效。
- stale 版本只能审计，不能进入续写上下文。
- 发布超时先查询平台结果，再重试。

不要先接真实投稿平台，也不要先追求漂亮页面。先完成数据库事务、模型输出校验、任务恢复和一条假模型端到端流程，再接入真实 API。
