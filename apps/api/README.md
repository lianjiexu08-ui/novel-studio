# Local API

这是一个无外部依赖的本地 API 垂直切片，用于验证领域、应用事务和 outbox 可以通过 HTTP 串起来。

```powershell
cd D:\project\novel-studio\apps\api
npm test
npm start
```

当前默认使用确定性假模型和内存仓储。生产接入时替换 `createApiServer()` 的 provider 与 repository；API 路由不应直接修改 Work 内部状态。

当前路由：

- `GET /health`
- `POST /works`：`{"title":"..."}`
- `POST /works/:workId/chapters/generate`：`{"chapterNumber":1,"runId":"..."}`
- `POST /works/:workId/candidates/:candidateId/check`
- `POST /works/:workId/candidates/:candidateId/adopt`：`{"expectedStateRevision":0}`
- `GET /works/:workId/outbox`
