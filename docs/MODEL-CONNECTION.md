# 模型连接

服务端通过 OpenAI-compatible 接口调用规划和写作模型。密钥只放在服务端环境变量中，不写入作品数据、浏览器或 Git。

```sh
export NOVEL_MODEL_ENDPOINT=https://api.autofish.club
export NOVEL_MODEL_API_KEY=<your-api-key>
export NOVEL_PLANNING_MODEL=gpt-5.6-sol
# 首轮里程碑生成 100 章；扩展完整长篇时改为 450
export NOVEL_PLANNING_CHAPTER_TARGET=100
# 可选；不设置时正文使用规划模型
export NOVEL_WRITING_MODEL=gpt-5.6-sol
# 可选；单位 USD
export NOVEL_MODEL_BUDGET_USD=20
# 可选；默认 60000 毫秒，长规划响应可提高到 120000 或 180000
export NOVEL_MODEL_TIMEOUT_MS=120000
# 默认对每章正文再做一次独立事件抽取；预算紧张时才关闭
export NOVEL_INDEPENDENT_EXTRACTION=true
mkdir -p data
DATABASE_URL="file:$(pwd)/data/novel-studio.db" npm run push -w novel-studio-persistence
npm run dev:api
```

`/v1` 会由适配器自动补齐。世界构建页的流程是：

1. 生成 World Pack；
2. 查看规则、境界、功法、法宝、资源、大陆、势力和历史；
3. 审核并锁定 World Pack；
4. 生成 Story Bible；
5. 查看人物关系、秘密、人物弧光、伏笔节点、分卷大纲和前 50 章逐章计划；
6. 审核并锁定 Story Bible；
7. 进入章节候选的生成、检查、采用流程。

长篇 Story Bible 在 50 章以上的目标下必须先产出 `chapterPlans`，完整覆盖第 1 至 50 章。每项计划包含本章目的、冲突、转折、章末钩子、人物/地点引用和必须发生的事件；当前章节写作请求会携带对应计划。正式创作建议在章节页逐章执行“生成候选 → 运行检查 → 采用”，连续生成只用于里程碑验收和可恢复存稿，不作为一次性产出整本书的替代。

世界包和 Story Bible 的每次生成、审核、锁定都会保存设计快照，可通过 `GET /works/:workId/design/history` 查询；成稿同时记录采用时的世界包和 Story Bible revision。

章节页的“按蓝图连续生成”会以后台 run 执行，接口立即返回；进度从检查点轮询，失败会标为 `paused` 并保留错误原因。服务重启后使用同一个 runId 重试即可继续。

模型输出必须是结构化 JSON。世界包和 Story Bible 会先经过合同校验、引用校验和锁定门禁；正文生成后会再调用一次抽取角色独立读取正文，事件声明、独立观察结果和世界引用必须全部匹配，否则不能采用。

启用真实模型配置时，章节长度检查要求正文达到创作约定单章目标的至少 75%，避免用短摘要填满长篇章节数；冻结书稿会继续显示实际字数与目标字数的覆盖率。

真实模型调用有 60 秒超时保护。一次调用超时只会让候选生成失败，不会写入章节事实；重新生成时使用新的 runId。

连接配置完成并启动 API 后，可以用验收脚本跑通首个真实模型里程碑：

```sh
npm run dev:api
# 另开终端
node scripts/run-model-milestone.mjs
```

脚本会创建一个验收作品，等待 100 章完成，冻结 ManuscriptRevision，并把导出 JSON 写入被 Git 忽略的 `data/` 目录。输出会同时显示实际字数、目标字数和收束覆盖率；若中途暂停，检查日志里的章节号和错误原因后，可以复用同一个作品和 runId 继续。脚本支持 `NOVEL_MILESTONE_WORK_ID`、`NOVEL_MILESTONE_RUN_ID`，扩展阶段另设 `NOVEL_MILESTONE_EXPANSION_RUN_ID`：

```sh
NOVEL_MILESTONE_WORK_ID=<已有作品 ID> \
NOVEL_MILESTONE_RUN_ID=<原 100 章 runId> \
npm run model:milestone
```

需要按验收顺序自动继续到完整长篇时，设置 `NOVEL_MILESTONE_EXPAND=true`。脚本会先导出 100 章版本，再生成 450 章蓝图、从第 101 章继续，最后导出 450 章版本：

```sh
NOVEL_MILESTONE_EXPAND=true npm run model:milestone
```

100 章验收通过后，作品的“世界构建与全书蓝图”页可以执行“扩展并启动450章”。系统会重新生成并锁定严格 450 章的 Story Bible，保留已经采用的前100章，从第101章继续；100章版本仍作为历史 ManuscriptRevision 保留。
