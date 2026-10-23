// Read-only API session for inspecting the proposed v78 design in the web UI.
// Every mutating request is rejected while this process is running.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = process.cwd();
const binding = JSON.parse(fs.readFileSync('data/audit-runtimes/design77-navigation-runtime-bound.json'));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for (const [file, digest] of Object.entries(binding.sourceHashes)) assert.equal(sha(path.join(binding.runtimePath, file)), digest);
for (const [file, digest] of Object.entries(binding.dependencyHashes)) assert.equal(sha(file), digest);
assert.equal(process.env.DATABASE_URL, `file:${path.join(root, 'data/novel-studio.db')}`);
assert.equal(process.env.API_CORS_ORIGIN, 'http://127.0.0.1:5180');
assert.equal(process.env.NOVEL_ENABLE_BATCH_RUNS, 'false');
const settingsPath = path.join(root, 'data/model-settings.json');
const { createApiServer } = await import(`${binding.runtimePath}/apps/api/src/server.ts`);
const { app, repository } = createApiServer({ manageModelSettings: true, modelSettingsPath: settingsPath, writeProcessEnvironment: false, allowBatchRuns: false });
app.addHook('onRequest', async (request, reply) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return reply.code(409).send({ error: { code: 'READ_ONLY_UI_SESSION', message: '只读核验会话不接受写请求' } });
});
const port = 8788;
await app.listen({ port, host: '127.0.0.1' });
const statePath = 'data/audit-runtimes/design77-budget-repair-ui-api.json';
fs.writeFileSync(statePath, JSON.stringify({ pid: process.pid, port, workId: 'work_8b6c9133e13d404083ca33acc63f4f61', planRevision: 78, sourceCommit: binding.sourceCommit, startedAt: new Date().toISOString(), readOnly: true }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ pid: process.pid, port, readOnly: true }));
process.once('SIGTERM', async () => { await app.close(); await repository.disconnect?.(); process.exit(0); });
