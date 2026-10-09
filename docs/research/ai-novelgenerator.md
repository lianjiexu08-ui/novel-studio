# AI_NovelGenerator：源码核验笔记

核验日期：2026-10-09  
仓库：[YILING0013/AI_NovelGenerator](https://github.com/YILING0013/AI_NovelGenerator)  
固定提交：f9aefef90b1493c579d7f72547efb4a3d8a0da25  
方法：GitHub API 确认仓库与提交，读取固定提交的 README、LICENSE 和关键源码；没有运行生成、模型调用或桌面界面。

最初候选地址 CQlio/AI_NovelGenerator 返回 404，通过 GitHub 仓库搜索确认上述地址。结论仅适用于固定提交。

## 已核验的机制

1. 近期章节 + 摘要 + 人物状态 + 检索的分层上下文。
   - [chapter.py L27](https://github.com/YILING0013/AI_NovelGenerator/blob/f9aefef90b1493c579d7f72547efb4a3d8a0da25/novel_generator/chapter.py#L27) 定义读取最近若干章，生成流程使用最近三章。
   - L65 将摘要输入裁至尾部 4000 字符，L108/L110 将摘要输出裁至 2000 字符。
   - [chapter.py L370](https://github.com/YILING0013/AI_NovelGenerator/blob/f9aefef90b1493c579d7f72547efb4a3d8a0da25/novel_generator/chapter.py#L370) 获取近期原文，L427 解析检索词，L445 调用检索，L496 拼接最终提示词。
   - 可借鉴：分层选取上下文。我们的实现需要按模型实际上下文容量分配预算，锁定规则与关键证据不能被静默截断，并记录本次选入/排除原因。

2. 定稿后更新记忆。
   - [finalization.py L64](https://github.com/YILING0013/AI_NovelGenerator/blob/f9aefef90b1493c579d7f72547efb4a3d8a0da25/novel_generator/finalization.py#L64) 读取旧摘要和人物状态，调用模型生成新内容。
   - [finalization.py L95](https://github.com/YILING0013/AI_NovelGenerator/blob/f9aefef90b1493c579d7f72547efb4a3d8a0da25/novel_generator/finalization.py#L95) 依次写摘要、人物状态，然后更新向量库。
   - L23 的辅助函数使用临时文件与 os.replace，属于单个文件的原子替换；三个更新不是一个事务。不能把它描述成所有记忆与正文原子提交。
   - 可借鉴：正文生成与记忆更新拆开。我们保留候选状态差异校验，采用事务与后续索引任务，以处理部分失败。

3. 简洁的四阶段创作流程。
   - README 提供设定、目录、草稿、定稿与可选审校。
   - [ui/generation_handlers.py L388](https://github.com/YILING0013/AI_NovelGenerator/blob/f9aefef90b1493c579d7f72547efb4a3d8a0da25/ui/generation_handlers.py#L388) 调用定稿，L412 通过桌面守护线程运行。
   - 可借鉴：让用户看到少量清楚的主步骤。我们的后台仍须持久化运行状态，不能靠窗口进程中的线程实现关页后继续与重启恢复。

## 边界与不应照搬的部分

- [consistency_checker.py L27](https://github.com/YILING0013/AI_NovelGenerator/blob/f9aefef90b1493c579d7f72547efb4a3d8a0da25/consistency_checker.py#L27) 的检查是组装提示词并返回模型回复，没有在这个函数中实现结构化规则判定和阻断发布。
- [ui/generation_handlers.py L441](https://github.com/YILING0013/AI_NovelGenerator/blob/f9aefef90b1493c579d7f72547efb4a3d8a0da25/ui/generation_handlers.py#L441) 的检查入口传入 novel_setting 与 plot_arcs 为空。这说明 UI 中有检查按钮并不代表所有设定依据都实际进入检查。
- [vectorstore_utils.py L199](https://github.com/YILING0013/AI_NovelGenerator/blob/f9aefef90b1493c579d7f72547efb4a3d8a0da25/novel_generator/vectorstore_utils.py#L199) 将文本片段包装为只有 page_content 的 Document，再追加到库。在所审查的写入路径中没有章节版本元数据和替换旧版本的操作，因此不能直接作为我们支持改稿后版本过滤的索引实现。
- README 的项目维护说明称重构版仅完成框架。不能据此认定任何分支已形成可上线的完整服务。
- 本次查看的核心写作路径不构成对网文平台自动投稿/更新的验证。

## 许可证

[LICENSE](https://github.com/YILING0013/AI_NovelGenerator/blob/f9aefef90b1493c579d7f72547efb4a3d8a0da25/LICENSE) 为 AGPL-3.0。当前只做源码阅读与架构参考，没有将实现复制进我们的服务。未来若直接复用或派生代码，需要按实际用途核对该许可证要求。

公开源码快照保存在 research/sources/ai-novelgenerator，仅供本次审查追溯，不属于应用运行代码。

