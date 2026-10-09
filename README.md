# novel-studio

个人使用的玄幻长篇小说自动创作与连载服务。

当前目录包含产品与架构文档、开源调研、状态边界 Spike，以及供后续模型继续实现的 TypeScript 核心切片。

先阅读：

1. `docs/MASTER-PLAN.md`
2. `docs/PRODUCT-AND-ARCHITECTURE.md`
3. `IMPLEMENTATION-HANDOFF.md`
4. `novel-service-spike/README.md`

## 目录

- `docs/`：产品、架构、交互验收和开源调研
- `novel-service-spike/`：已通过测试的 Python/Node 状态验证
- `novel-service-core/`：无外部运行时依赖的 TypeScript 领域切片
- `packages/contracts/`：模型输出、上下文清单和任务载荷的运行时校验
- `packages/model-gateway/`：GPT/Gemini/OpenAI-compatible 调用边界、预算和脱敏
- `packages/persistence/`：PostgreSQL/Prisma 数据模型草案
- `packages/application/`：章节生成、检查、采用事务和 outbox 用例
- `packages/worker/`：任务去重、租约恢复、重试和作品级串行
- `apps/api/`：本地 HTTP 垂直切片，可跑通建作、生成、检查、采用和 outbox

## 重要边界

候选稿不改变正式故事状态；只有检查全部通过的采用事务才能产生事实。早章修改会使受影响后文和检查结果失效。发布超时必须先核验平台结果再重试。
