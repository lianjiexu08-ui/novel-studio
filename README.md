# novel-studio

个人使用的玄幻长篇小说自动创作服务。本地可以完成：建书、创作约定、世界包与 Story Bible、人物设定与大纲、章节生成、检查、采用、质量回看，以及成稿冻结和导出。

候选稿不是事实。世界包和 Story Bible 要先审核再锁定，章节只有检查通过并被采用之后才进入正式故事。锁定项不能被模型改写。改早章会把其后已采用正文标成失效。

## 本地运行

需要 Node.js。依赖装好后，先生成 Prisma 客户端并建好 SQLite 库，再分别启动 API 和网页。

```powershell
npm install
New-Item -ItemType Directory -Force data | Out-Null
$env:DATABASE_URL = "file:$($PWD.Path.Replace('\', '/'))/data/novel-studio.db"
npm run generate -w novel-studio-persistence
npm run push -w novel-studio-persistence
npm run dev:api
```

另开一个终端：

```powershell
npm run dev:web
```

- API：<http://127.0.0.1:8787>（可用 `PORT` 改端口）
- 网页：<http://localhost:5173>
- 数据库文件：`data/novel-studio.db`。不设置 `DATABASE_URL` 时，API 也会默认写到这里
- 测试：`npm test`

不配置模型时，正文生成使用确定性占位稿，世界包和 Story Bible 不会生成。接入模型时复制 `.env.example` 为本地环境变量，说明见 `docs/MODEL-CONNECTION.md`。密钥只留在服务端，不进浏览器，也不提交到 Git。`data/` 和 `.env` 已被忽略。

真实模型里程碑：

```powershell
npm run model:milestone
```

脚本默认跑 100 章并导出成稿。设置 `NOVEL_MILESTONE_EXPAND=true` 会在 100 章之后继续到 450 章。中断后用同一个作品 ID 和 runId 可以接着跑。

## 网页

创作空间里已经接上的页面：

- **概览**：作品进度
- **世界构建**：生成、查看、审核并锁定世界包和 Story Bible；可看历史快照，也可从 100 章扩展到 450 章
- **约定**：题材、终局、文风和锁定约束
- **设定**：人物、关系（客观关系 / 人物认知）、世界规则，可锁定
- **大纲**：全书、分卷、章节节点；正文落实只由采用稿决定
- **章节 / 章节创作**：单章生成、检查、采用，以及按蓝图后台连续生成
- **质量**：章节证据、检查覆盖和成稿质量；可冻结并下载成稿

任务中心、发布和系统设置仍是占位。模型角色和超时目前用环境变量配置，不在网页里改。长篇连续生成跑在 API 进程里，失败会停在检查点，服务重启后用同一个 runId 继续。`packages/worker` 里的租约和重试还没有接到这条运行路径上。

## 目录

- `docs/`：产品、架构、百万字内容模型和模型连接说明
- `novel-service-core/`：作品状态、采用门禁、世界包和 Story Bible
- `packages/contracts/`：接口、模型输出和世界设计的运行时校验
- `packages/planner/`：OpenAI-compatible 规划与正文适配
- `packages/model-gateway/`：模型调用、预算和脱敏边界
- `packages/application/`：生成、检查、采用和设计流程
- `packages/persistence/`：本地 SQLite；`schema.postgresql.prisma` 是以后换库用的草案
- `packages/worker/`：任务去重、租约和重试，尚未接入 API
- `apps/api/`：本地 HTTP 服务
- `apps/web/`：创作网页
- `novel-service-spike/`：早期状态边界验证
- `scripts/run-model-milestone.mjs`：真实模型的 100 章 / 450 章验收

## 先读

1. `docs/MASTER-PLAN.md`
2. `docs/PRODUCT-AND-ARCHITECTURE.md`
3. `docs/NOVEL-CONTENT-MODEL.md`
4. `docs/MODEL-CONNECTION.md`
5. `IMPLEMENTATION-HANDOFF.md`
