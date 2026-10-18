# 第76版正式评审恢复

原进程在模型调用之前内存崩溃。只读核验和真实规模副本演练已完成，见`2026-10-18-design76-worker-crash.json`及`2026-10-18-design76-history-recovery-rehearsal.json`。生产设计仍为世界40、故事圣经72、待审计划76；没有再次修订小说内容。

本次使用提交`26b5f8f`中的分块历史保存实现。冻结目录为`data/audit-runtimes/design76-recovery-runtime`，新控制目录为`data/audit-runtimes/design76-recovery`。准备和执行都验证崩溃证明、原检查点以及演练使用的持久化源码哈希。三个原任务保留，新任务有明确重启来源；未创建成功的故事任务从头创建。模型调用预算仍从零开始，因为原任务没有发出请求。

首次执行：

```sh
DATABASE_URL=file:/Users/lianjie/Documents/ChatGPT/novel/data/novel-studio.db \
  node --experimental-strip-types scripts/run-design76-recovery.mjs --execute --stage-limit=12
```

启动后只能检查同一进程及其日志`/tmp/novel-design76-recovery-segment0.log`，不能因观察超时重复启动。后续恢复须使用当前终止检查点的真实`--resume-sha256`；工作进程结束后使用`verify-design76-recovery.mjs`回放请求、响应及生产库只读备份。旧`design76-review`目录及其“running”检查点是崩溃现场，不能据该字段判断旧进程仍存活，也不能用旧执行脚本恢复新任务。

本记录证明恢复准备及运行边界，不表示12步已完成或内容质量通过。正式结论、41项阻塞处置、逐章正文及最终书稿仍待验收。
