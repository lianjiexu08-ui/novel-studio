# Model gateway

模型网关把规划、正文、事实抽取和审查统一为同一种调用边界。

- `OpenAICompatibleAdapter` 支持 GPT 及兼容 `/chat/completions` 的服务。
- `GeminiAdapter` 使用 Gemini `generateContent` 接口。
- `UsageLedger` 在调用前预占调用次数、估算费用与请求的输出额度。共用账本的多个网关和角色会计入彼此尚未完成的请求；完成后记录实际用量并释放预占，失败调用仍计入次数。直接调用 `reserve()` 时，调用者须在记录结果后于 `finally` 中执行返回的释放函数。
- `redactSecrets` 用于日志和错误边界；API Key 不应进入任务载荷或前端。

OpenAI 兼容适配器按配置的空闲时间超时，持续收到流式数据时重新计时。预算额度按共用账本计算；服务级并发和速率控制、供应商能力探测及加密凭证仓储仍需另行实现。适配器不拥有作品状态，也不能直接采用章节或发布内容。
