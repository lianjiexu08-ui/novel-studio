# 恢复核心静态类型检查

上轮额外运行核心tsc时，基线已有29条诊断：Node类型声明缺失导致内置模块、计时器和unref不可识别；ES2022类型库没有代码已使用的findLast；百章测试的事件数组从首项被推断成只接受数值，随后秘密与收束事件的布尔值、对象不符合该推断。

本次明确添加开发依赖 `@types/node` 和 `typescript`，锁定文件记录实际版本24.19.2和5.9.3。核心tsconfig指定Node类型与ES2023类型库，保留ES2022目标、strict和noEmit；测试数组使用已有EventDraft类型，没有跳过类型检查或放宽为any。新增 `npm run typecheck:core`，并在统一测试入口 `node scripts/test-all.mjs` 开始时执行该检查。

验证结果：

- 隔离目录与实际工作区的 `npm run typecheck:core` 均退出0。
- 新统一测试入口先通过核心tsc，再通过全部352项测试，0失败。
- 隔离目录前端构建通过，保留已有包体积警告。
- 依赖安装使用ignore-scripts；安装前后已有Prisma客户端13个文件逐一哈希相同，未执行生成或迁移。
- 运行中的设计61固定副本115份源文件哈希全部保持原值；正式评审继续使用原标准和原输入。

日志：`/tmp/novel-core-typecheck-fixed.log`、`/tmp/novel-root-core-typecheck.log`、`/tmp/novel-types-full-tests.log`、`/tmp/novel-types-web-build.log`。

此处只证明所列核心源码、其类型依赖和测试通过静态检查，不宣称已经对整个仓库建立统一tsc工程。真实小说的设计质量仍由正式评审处理，正文尚未放行。
