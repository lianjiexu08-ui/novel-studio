# Implementation handoff

这个目录是给后续模型继续实现的工作基线。不要从零重新讨论产品方向；先运行现有测试，再沿着下面的边界扩展。

## 已完成

- `docs/MASTER-PLAN.md`：当前总方案。
- `docs/PRODUCT-AND-ARCHITECTURE.md`：页面、领域对象、代码分层和实施阶段。
- `docs/INTERACTION-AND-ACCEPTANCE.md`：页面交互和验收案例。
- `docs/OPEN-SOURCE-REVIEW.md`：四个开源项目的机制调研；没有复制第三方代码。
- `novel-service-spike/`：Python 领域 Spike 与 Node 持久任务队列，已验证候选隔离、检查门、早章失效、恢复幂等、同书串行和跨书并行。
- `novel-service-core/`：Node 22 可直接执行的 TypeScript 领域切片，继续补强即可接入数据库和 API。
- `packages/contracts/`：模型输出、ContextManifest、任务载荷的运行时校验。
- `packages/model-gateway/`：OpenAI-compatible/Gemini 适配器、预算账本和日志脱敏。
- `packages/persistence/prisma/schema.prisma`：版本、候选、事件、来源、检查、任务、outbox 和发布意图的数据模型草案。
- `packages/application/`：API/worker 应调用的章节工作流、事务仓储端口和 outbox 适配器。
- `packages/worker/`：任务去重、租约恢复、有限重试和作品级串行的可替换实现。
- `apps/api/`：Fastify 垂直切片，请求/路径走 contracts Zod 校验，领域异常映射为稳定错误码（STALE_CANDIDATE、ADOPTION_BLOCKED 等），可选 Bearer 鉴权（API_TOKEN）与 CORS 白名单。
- `apps/web/`：React + Vite + TS + Ant Design 5 深色主题，六个页面的路由骨架（HashRouter），类型直接 import 自 contracts，已打通建书→生成→检查→采用→outbox 主流程；`npm run dev:web` 启动。
- `packages/persistence/`：Prisma + SQLite（本地优先，单文件 `data/novel-studio.db`），`PrismaWorkRepository` 实现完整聚合映射：DB 事务 + stateRevision 乐观锁 + outbox 去重，人物状态不落库（从 active 事件重建投影）。重启后数据不丢，已由 roundtrip 与重启测试验证。PostgreSQL 版 schema 保留在 `prisma/schema.postgresql.prisma`，上云时切换 provider 并恢复 enum/Json 列。仓储端口已全面异步化。

## 当前核心不变量

1. 候选稿、采用稿、合格存稿、发布快照是不同状态。
2. 候选事件和模型声明不能直接修改正式故事状态。
3. 必需检查只有 `passed` 才能采用；`failed`、`inconclusive`、`unavailable` 和缺失都阻断。
4. 锁定关系和锁定正文片段不能由模型解除或覆盖。
5. 未来大纲和人物弧光不能提前成为当前事实。
6. 正式事实必须指向不可变正文版本、证据位置和故事时间。
7. 早章修改会使依赖它的后文、状态投影和检查结果失效。
8. stale 版本只能审计，不能进入续写上下文。
9. 采用正文和摘要、检索索引、导出等派生任务分开；派生失败不能重复采用正文。
10. 投稿超时先核验平台结果，再决定是否重试。

## 推荐接手顺序

1. 在 `novel-service-core` 运行 `npm test`。
2. 用 `packages/persistence/prisma/schema.prisma` 生成 migration，实现 `packages/application` 的 `WorkRepository` 和 Prisma transaction，把内存 `Work` 聚合映射到 PostgreSQL，保留事务和版本校验。
3. 在 `packages/model-gateway` 上加入密钥加密、限流、重试和供应商能力探测；所有模型输出先经过 `packages/contracts` 校验。
4. 实现真实的事实抽取、声明/观察变化比对、玄幻 Obligation 和 PlanRealization。
5. 把 `packages/worker` 和 `apps/api` 映射到 PostgreSQL/Redis 与真实模型，再实现 React 页面；页面通过应用用例访问领域核心。
6. 在平台未选定前只实现 `PlatformAdapter` 接口和替身，不假设通用投稿 API。

## 不要做的事

- 不要让模型直接写数据库中的人物关系、锁定设定或发布状态。
- 不要把向量检索结果当作唯一事实来源。
- 不要在发布超时后无核验重试。
- 不要把“样章文风认可”误当作“样章剧情采用”。
- 不要把审查模型的意见当作已证实事实；回到正文证据。

## 后续模型需要补的正式目录

```text
apps/api
apps/worker
apps/web
packages/contracts
packages/core
packages/persistence
packages/model-gateway
packages/platform-adapters
infra
```

先完成单作品、玄幻、连续 10--20 章的可恢复闭环，再扩展题材和平台。
