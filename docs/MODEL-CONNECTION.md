# 模型连接

服务端通过 OpenAI-compatible 接口调用规划和写作模型。密钥只放在服务端环境变量中，不写入作品数据、浏览器或 Git。

```sh
export NOVEL_MODEL_ENDPOINT=https://api.autofish.club
export NOVEL_MODEL_API_KEY=<your-api-key>
export NOVEL_PLANNING_MODEL=gpt-5.6-sol
# 可选；不设置时正文使用规划模型
export NOVEL_WRITING_MODEL=gpt-5.6-sol
# 可选；单位 USD
export NOVEL_MODEL_BUDGET_USD=20
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

模型输出必须是结构化 JSON。世界包和 Story Bible 会先经过合同校验、引用校验和锁定门禁；正文模型的事件声明和观察结果也必须匹配，否则不能采用。

真实模型调用有 60 秒超时保护。一次调用超时只会让候选生成失败，不会写入章节事实；重新生成时使用新的 runId。
