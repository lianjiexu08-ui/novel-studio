// Serve the tested annotation-aware runtime and frozen UI for the new proposal.
// No model invocation, migration or design mutation is performed at startup.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = process.cwd();
const read = p => JSON.parse(fs.readFileSync(p));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const bindingPath = 'data/audit-runtimes/design77-formal-runtime-bound.json', binding = read(bindingPath);
const prepare = process.argv.includes('--prepare'), execute = process.argv.includes('--execute');
assert.notEqual(prepare, execute);
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(sha(path.join(binding.runtimePath, p)), h);
for (const [p, h] of Object.entries(binding.dependencyHashes)) assert.equal(sha(p), h);
const uiRoot = path.resolve('data/audit-ui/design77-formal-reconsideration-v5/dist');
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]).sort();
const uiFiles = Object.fromEntries(files(uiRoot).map(p => [path.relative(uiRoot, p), sha(p)]));
assert.ok(uiFiles['index.html']);
const { loadModelStore, activeChannel, connectionOf } = await import(`${binding.runtimePath}/apps/api/src/model-settings.ts`);
const settingsPath = path.join(root, 'data/model-settings.json'), settingsHash = sha(settingsPath);
const store = loadModelStore(settingsPath), connection = connectionOf(activeChannel(store), store.source);
assert.equal(connection.planningModel, 'gpt-5.6-luna');
assert.equal(connection.writingModel, 'gpt-5.6-luna');
assert.ok(store.channels.every(c => !c.fallback));
const proofPath = 'docs/audits/2026-10-18-design77-formal-api-preflight-v5.json';
const proof = { sourceCommit: binding.sourceCommit, runtimeBindingSha256: sha(bindingPath), runnerSha256: sha(process.argv[1]),
  uiRoot, uiFiles, backendPort: 8787, frontendPort: 5180, corsOrigin: 'http://127.0.0.1:5180',
  model: connection.planningModel, fallback: false, annotationSnapshotsSupported: true, formalReconsiderationSupported: true, modelCalls: 0, productionWrites: 0,
  limitation: 'Artifact preparation only; actual startup and browser verification are separate.' };
if (prepare) {
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ prepared: true, sourceCommit: binding.sourceCommit, uiFiles: Object.keys(uiFiles).length }));
} else {
  assert.deepEqual(read(proofPath), proof);
  assert.equal(process.env.DATABASE_URL, 'file:' + path.join(root, 'data/novel-studio.db'));
  assert.equal(process.env.API_CORS_ORIGIN, proof.corsOrigin);
  assert.equal(process.env.NOVEL_ENABLE_BATCH_RUNS, 'false');
  const { createApiServer } = await import(`${binding.runtimePath}/apps/api/src/server.ts`);
  const { app, repository } = createApiServer({ manageModelSettings: true, modelSettingsPath: settingsPath, writeProcessEnvironment: false, allowBatchRuns: false });
  assert.equal(sha(settingsPath), settingsHash);
  await app.listen({ port: 8787, host: '127.0.0.1' });
  const state = { pid: process.pid, startedAt: new Date().toISOString(), sourceCommit: binding.sourceCommit,
    runtimeRoot: binding.runtimePath, preflightSha256: sha(proofPath), settingsUnchangedAtStartup: true,
    backendPort: 8787, corsOrigin: proof.corsOrigin, batchWritingEnabled: false };
  fs.writeFileSync(`data/audit-runtimes/design77-formal-api-start-${process.pid}.json`, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(state));
  process.once('SIGTERM', async () => { await app.close(); await repository.disconnect?.(); process.exit(0); });
}
