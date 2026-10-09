# Long-Novel-GPT：源码核验记录

核验日期：2026-10-09。本文为静态源码阅读，未部署、未调用模型、未验证长篇小说质量。

## 来源与版本

- 实际仓库：[MaoXiaoYuZ/Long-Novel-GPT](https://github.com/MaoXiaoYuZ/Long-Novel-GPT)。此前候选地址 `yudot/Long-Novel-GPT` 返回 404，经 GitHub 仓库搜索找到本项目。
- 固定提交：`107c31e54686947a6d00404e332475a60b66e630`。
- 已读：README、完整目录树、`core/writer.py`、`core/draft_writer.py`、`core/backend.py`、`backend/app.py`。其中 `core/backend.py` 带有旧界面路径，结论优先引用当前 Flask API 路径。
- GitHub 仓库元数据的 `license` 为 `null`，本次完整目录树中未发现 LICENSE 文件。只能确认公开可读；没有确认可复制、修改和分发的许可。建议借鉴设计思想，不直接纳入代码，复用前另行确认授权。
- [固定版本 README](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/107c31e54686947a6d00404e332475a60b66e630/readme.md) 宣称分层扩写、导入小说、片段改写、查看提示词和费用。README 对百万字、签约质量的表述是作者宣称，本次没有验证。

## 直接观察到的机制

### 1. 剧情与正文成对组织，范围编辑带相邻上下文

`Writer.xy_pairs` 把较短剧情与相应正文建立映射。`Chunk` 区分要修改的正文范围和只作为上下文的邻近片段。

- [Chunk 的目标片段和上下文](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/107c31e54686947a6d00404e332475a60b66e630/core/writer.py#L14)：`text_pairs` 是目标，`chunk_pairs` 是包含周边内容的上下文。
- [get_chunk](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/107c31e54686947a6d00404e332475a60b66e630/core/writer.py#L168)：根据范围和 context_length 扩展只读上下文。
- [write_text](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/107c31e54686947a6d00404e332475a60b66e630/core/writer.py#L400)：将目标剧情、目标正文、上下文剧情、上下文正文及 global_context 分别传入提示词。

对我们方案的优化：给章节工作台增加“剧情节点—正文场景”对应视图，编辑请求明确 target 与 context 的边界。采用稳定场景 ID 和稿件版本定位，不只依赖文本偏移；在上下文记录里保存每条材料的来源和纳入原因。

### 2. 多个局部修改必须先确认范围没有交叉

- [apply_chunks](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/107c31e54686947a6d00404e332475a60b66e630/core/writer.py#L234)：先检查片段占用范围不能重叠，再按从后向前的顺序应用，避免早先修改让后面的索引偏移。
- [get_chunk_pair_span](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/107c31e54686947a6d00404e332475a60b66e630/core/writer.py#L207)：先检查原位置内容，不匹配时用首尾文本查找，最后断言完整片段匹配。
- [当前 API 的差异输出](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/107c31e54686947a6d00404e332475a60b66e630/backend/app.py#L173)：保存初始 Writer，生成完成后调用 diff_to 返回原文与新文差异。

对我们方案的优化：将“非重叠、目标版本一致、锁定范围不变”定义为提交补丁的程序校验条件。对并行审稿得出的多项修订先统一合并，冲突修订不能由各个模型直接覆盖正文。

### 3. 正文生成后重新对齐剧情与正文

- [map_text](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/107c31e54686947a6d00404e332475a60b66e630/core/writer.py#L461)：拆分剧情与正文，调用辅助模型生成 `plot2text`，将两者重新组织成对应片段。
- [batch_write_apply_text](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/107c31e54686947a6d00404e332475a60b66e630/core/writer.py#L509)：先生成，再建立映射，最后将新片段应用。
- [DraftWriter.summary](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/107c31e54686947a6d00404e332475a60b66e630/core/draft_writer.py#L23)：将已有正文分块后提炼剧情，说明流程可以由正文反向提取，而不只依赖事先大纲。

对我们方案的优化：增加“计划落实情况”检查，区分计划节点、正文证据和正文实际发生的事件。剧情计划不能直接进入事实库。节点应标记已落实、部分落实、未落实或发生偏离，再决定补写、改稿或调整后续计划。

## 局限及不能直接照搬的部分

1. **局部上下文不是完整故事事实系统。** 已读核心实现主要围绕文本对、字符范围和 global_context 工作。仅凭这些代码，不能声称项目已实现锁定关系、人物知情边界或事件溯源的一致性保障。
2. **对齐模型也可能出错。** `writer.py` 第 462 行仍有检查映射内容与上下文是否误配的 TODO。我们的对齐结果需校验覆盖、顺序和原文引用，并保留不确定状态。
3. **审稿闭环有限。** [review_text](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/107c31e54686947a6d00404e332475a60b66e630/core/writer.py#L434) 注明评分机制尚未实装；[batch_review_write_apply_text](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/107c31e54686947a6d00404e332475a60b66e630/core/writer.py#L519) 用审稿文本驱动重写，但这不等于具备有类型的问题单、证据校验及发布门禁。
4. **请求内流式执行不适合作为长期自动任务的唯一基础。** [write 路由](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/107c31e54686947a6d00404e332475a60b66e630/backend/app.py#L226) 在 SSE 响应生成器中执行写作；[active_streams](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/107c31e54686947a6d00404e332475a60b66e630/backend/app.py#L329) 为进程内字典。本次所读路径未显示持久检查点与断线后的任务重接语义。我们的数据库任务、独立 worker 和幂等采用仍应保留。
5. **并行扩写不等于剧情可以并行定稿。** 项目通过 `batch_yield` 调度多个文本片段的生成；相互有因果依赖的章节仍需统一状态顺序。我们可并行准备场景候选和审稿，采用正文及提交故事状态必须遵守依赖。

## 建议增加的验收案例

- 同一章节有两项范围重叠的修改时，系统报告冲突，不静默覆盖。
- 前文编辑导致位置偏移后，旧任务结果不能写入错误场景。
- 模型把某剧情节点映射到只读上下文时，该映射不能作为节点已落实的证据。
- 大纲要求交付物品，但正文未写出交付时，物品归属保持原状态，并提示计划未落实。
- API 连接断开后任务仍有持久状态，重新打开页面可恢复查看；这项要求不能仅靠 SSE 流和进程内字典实现。

## 对产品结构的最小增补

无需为以上机制再增加一批顶级页面。将“剧情与正文对应”“本次上下文”“候选修改差异”放入章节工作台的侧栏；在质量中心显示节点落实与依赖冲突；任务中心保留可重接进度。代码上扩展 `context`、`editing`、`outline` 和 `runs` 模块即可。
