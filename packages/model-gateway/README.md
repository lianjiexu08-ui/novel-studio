# Model gateway

模型网关把规划、正文、事实抽取和审查统一为同一种调用边界。

- `OpenAICompatibleAdapter` 支持 GPT 及兼容 `/chat/completions` 的服务。
- `GeminiAdapter` 使用 Gemini `generateContent` 接口。
- `UsageLedger` 在调用前检查估算费用，在返回后记录实际费用。
- `redactSecrets` 用于日志和错误边界；API Key 不应进入任务载荷或前端。

生产实现还需要加超时、指数退避、并发/速率限制、响应契约校验、供应商能力探测和加密凭证仓储。适配器不拥有作品状态，也不能直接采用章节或发布内容。
