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
npm run push -w novel-studio-persistence
npm run dev:api
```

`/v1` 会由适配器自动补齐。世界构建页的流程是：

1. 生成 World Pack；
2. 查看规则、境界、功法、法宝、资源、大陆、势力和历史；
3. 审核并锁定 World Pack；
4. 生成 Story Bible；
5. 查看人物关系、秘密、人物弧光、伏笔节点和分卷大纲；
6. 审核并锁定 Story Bible；
7. 进入章节候选的生成、检查、采用流程。

世界包和 Story Bible 的每次生成、审核、锁定都会保存设计快照，可通过 `GET /works/:workId/design/history` 查询；成稿同时记录采用时的世界包和 Story Bible revision。

章节页的“按蓝图连续生成”会以后台 run 执行，接口立即返回；进度从检查点轮询，失败会标为 `paused` 并保留错误原因。服务重启后使用同一个 runId 重试即可继续。

模型输出必须是结构化 JSON。世界包和 Story Bible 会先经过合同校验、引用校验和锁定门禁；正文模型的事件声明和观察结果也必须匹配，否则不能采用。

真实模型调用有 60 秒超时保护。一次调用超时只会让候选生成失败，不会写入章节事实；重新生成时使用新的 runId。

连接配置完成并启动 API 后，可以用验收脚本跑通首个真实模型里程碑：

```sh
npm run dev:api
# 另开终端
node scripts/run-model-milestone.mjs
```

脚本会创建一个验收作品，等待 100 章完成，冻结 ManuscriptRevision，并把导出 JSON 写入被 Git 忽略的 `data/` 目录。若中途暂停，检查日志里的章节号和错误原因后，使用同一个 `runId` 从 API 重试。

100 章验收通过后，作品的“世界构建与全书蓝图”页可以执行“扩展并启动450章”。系统会重新生成并锁定严格 450 章的 Story Bible，保留已经采用的前100章，从第101章继续；100章版本仍作为历史 ManuscriptRevision 保留。
