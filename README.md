# novel-studio

个人使用的玄幻长篇小说自动创作服务。本地可以完成：建书、创作约定、世界包与 Story Bible、人物设定与大纲、章节生成、检查、采用、质量回看，以及成稿冻结和导出。

候选稿不是事实。世界包和 Story Bible 要先审核再锁定，章节只有检查通过并被采用之后才进入正式故事。锁定项不能被模型改写。改早章会把其后已采用正文标成失效。

内容评审默认针对最新计划提案，也可选择当前批准版；提案评审不会自动批准计划。100 章及以上的长篇还必须在世界构建页完成四项**内容评审**：世界与历史、力量体系、人物关系、故事与章纲。原有“审核／锁定”是结构检查，不代表内容质量通过。内容评审保存所审材料、逐项结论、原文引文和返修要求；修改约定、设定或批准计划后旧结论失效。模型失败、材料不足或任何一项需返修时，不能继续正式写作或采纳新候选。内容评审不代替已写正文的逐章审核。

大材料支持分批原文评审、跨批对照和综合结论；每步自动保存，刷新或失败后可以续审，全部完成前不放行。升级现有 SQLite 库前请按[分批评审与迁移说明](docs/design-review-runs.md)备份并新增进度字段。

历史书稿导出保存冻结时的书名、约定和具体设计引用；旧数据缺失的元数据会明确标注。已有数据库需在评审及恢复任务结束后按[书稿快照升级说明](docs/manuscript-export-snapshots.md)新增可空字段，再生成客户端并重启。

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

升级到包含分项内容评审的版本时，先备份数据库，再按上方命令重新执行 `generate` 和 `push`，为 Project 增加 `designContentReviews` 字段。已有作品不会自动获得“通过”结论。

不配置模型时，正文生成使用确定性占位稿，世界包和 Story Bible 不会生成。在“系统设置”中可保存和测试模型渠道、选择规划与写作模型及切换当前渠道；未保存渠道时也可使用环境变量，详见[模型连接说明](docs/MODEL-CONNECTION.md)。保存的密钥留在本机服务端，查询配置不会返回完整密钥。`data/` 和 `.env` 已被 Git 忽略。

真实模型里程碑：

```powershell
npm run model:milestone
```

脚本尝试启动 100 章并导出成稿。先在界面准备并锁定对应设计、批准全书计划、通过四项内容评审，再设置 `NOVEL_MILESTONE_WORK_ID` 指向该作品；批量入口默认关闭，需要显式开启 `NOVEL_ENABLE_BATCH_RUNS=true`。设置 `NOVEL_MILESTONE_EXPAND=true` 会尝试继续到 450 章，但仍要求单独审核过的 450 章设计和计划，不会自动扩写或批准。中断后用同一个作品 ID 和 runId 可以接着跑。

设计评审完成后，可先独立核查保存的报告：

```sh
DATABASE_URL='file:/absolute/path/novel-studio.db' node --experimental-strip-types scripts/audit-design-reviews.mjs --work-id WORK_ID --plan-id PLAN_ID --output review-audit.json
```

工具在同一个只读事务中读取作品，随后重建每项已完成评审的全部批次，核对原文引用、补读解除记录、结论、报告来源和当前设计绑定；未完成的新评审不能沿用旧通过记录。不会调用模型、批准计划、解除阻塞或改写数据库。输出文件必须尚不存在，避免覆盖历史证据。退出码 `0` 表示四项当前设计报告均通过且重建一致，`2` 表示尚未验收（包括未完成、返修、过期或无法重建的旧报告），`1` 表示证据不一致或工具执行失败。报告一致性不能替代文学质量判断和后续逐章正文验收。

## 网页

创作空间里已经接上的页面：

- **概览**：作品进度
- **世界构建**：生成、查看、审核并锁定世界包和 Story Bible；可看历史快照，也可从 100 章扩展到 450 章
- **约定**：题材、终局、文风和锁定约束
- **设定**：人物、关系（客观关系 / 人物认知）、世界规则，可锁定
- **大纲**：全书、分卷、章节节点；正文落实只由采用稿决定
- **章节 / 章节创作**：单章生成、检查、采用，以及按蓝图后台连续生成
- **质量**：章节证据、检查覆盖和成稿质量；可冻结并下载成稿
- **任务中心**：查看连续生成检查点、错误与采用后的派生任务；暂停、取消或从检查点继续已有运行
- **系统设置**：管理模型渠道、测试连接、拉取模型列表、选择规划与写作模型及设置超时

发布平台接入仍是占位。长篇连续生成跑在 API 进程里，失败会停在检查点，服务重启后用同一个 runId 继续；恢复仍受设计质量和批量入口开关约束。`packages/worker` 里的租约和重试还没有接到这条运行路径上。

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
- `scripts/audit-design-reviews.mjs`：只读重建与核验四项当前设计评审

## 先读

1. `docs/MASTER-PLAN.md`
2. `docs/PRODUCT-AND-ARCHITECTURE.md`
3. `docs/NOVEL-CONTENT-MODEL.md`
4. `docs/MODEL-CONNECTION.md`
5. `IMPLEMENTATION-HANDOFF.md`
