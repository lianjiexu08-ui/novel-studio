# 历史书稿导出与升级

新冻结的书稿保存当时的书名、创作约定、世界包和故事圣经的具体快照 ID、设计历史范围及收束检查结果。后续改名、修改约定、扩充设定、替换早章都不改变这些资料。正文与事件仍按冻结的章节版本取出；导出的事件 `active` 表示在该书稿内生效，不代表当前草稿的状态。书稿 `status` 是当前生命周期状态，产生新版后会变为 `superseded`，不属于不变的书稿内容。

原有书稿未保存的书名与创作约定无法可靠回溯，因此导出中 `work.title`、`work.covenant` 为 `null`，`work.metadataStatus` 为 `unavailable_legacy`；正文和原有设计引用仍可导出，不拿今天的值冒充历史资料。新书稿的状态为 `frozen`。Markdown 下载同样使用冻结书名，旧数据标注“原书名未保存”。新书稿所引用的设计记录若缺失，导出明确报错。

升级已有 SQLite 数据库时，先等待所有正式评审及其恢复任务结束，再停止 API 和写入进程。不要在评审仍运行时替换 Prisma 客户端或迁移数据库。

```sh
python3 scripts/migrate-manuscript-export-snapshot.py data/novel-studio.db
npm run generate -w novel-studio-persistence
```

迁移脚本先使用 SQLite backup 保存完整备份，再给 `ManuscriptRevision` 增加可空的 `exportSnapshot` 列，不重建表、不覆盖旧值、不推测历史元数据；重复运行不再修改。完成后按原有端口配置重启服务。全新数据库仍可使用 README 中的 `generate` 与 `push`。PostgreSQL 参考模型同步增加了可空 JSON 列，需通过对应部署的迁移流程升级；本轮仅验证 SQLite。
