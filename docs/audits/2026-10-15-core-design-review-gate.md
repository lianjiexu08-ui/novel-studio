# 底层正文入口的设计评审门禁

检查发现，应用层ChapterWorkflow已经阻止未通过设计评审的长篇生成与采纳，但可直接调用的NovelService.prepareGeneration和adoptCandidate没有同样检查。内部脚本若直接使用同步、异步生成或runUntil，可以绕过应用层门禁；直接采纳及旧章替换也存在相同缺口。旧百章单元测试甚至先运行100章，再补入计划及评审假数据，不能证明先审设计再写作的顺序。

修复在底层生成准备和采纳入口检查当前四领域评审。缺失、未完成、过期或返修均返回DESIGN_REVIEW_REQUIRED。采纳检查在改变章节版本、事件和状态之前；对已采纳候选的幂等重试仍返回原版本，不改写历史。应用层已有检查保留，以维持其事务入口和错误语义。

新增回归覆盖同步生成、异步生成、直接runUntil、直接采纳、旧章替换，以及近期成长项返修时禁止生成。断言拒绝发生时写作模型调用数不增加，已采纳版本和事实不变。百章、收束及成稿历史测试改为先设置明确的计划与评审假数据，再进入章节循环；这些都是工程假数据，不代表真实模型的文学质量验收。

验证结果：

- 旧实现运行新增回归失败，错误为Missing expected exception，证明缺失门禁确实可复现。
- 修复后在隔离目录通过全部350项测试（0失败）。执行node scripts/test-all.mjs；未在生产生成Prisma客户端或迁移数据库。
- 生产只读readiness接口返回ready=false，包含CANON_NOT_READY、PLAN_OUTDATED和DESIGN_REVIEW_REQUIRED，必需检查包括独立正文评审。

本修复只改工作区代码，不替换正在运行的固定设计61评审副本。生产API原有应用层门禁已生效；底层增强需在后续运行时更新中部署。设计61的原文、输入哈希和评审标准未修改，未批准提案、未关闭阻塞、未生成正文。

验证日志：`/tmp/novel-core-design-gate-before.log`、`/tmp/novel-core-design-gate-after.log`、`/tmp/novel-core-design-gate-full-tests.log`。正式评审首批证据另见 `2026-10-15-design61-first-batches-proof.json`，其部分批次核验不等于全领域通过。
