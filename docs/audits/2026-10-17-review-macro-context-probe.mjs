import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.ok(process.argv.includes('--execute'));
const proof = read('docs/audits/2026-10-17-review-macro-context-preflight.json');
assert.equal(sha(proof.inputPath), proof.inputSha256);
for (const [name, expected] of Object.entries(proof.sourceHashes)) assert.equal(sha(path.join(proof.runtimePath, name)), expected);
const output = path.join(path.dirname(proof.inputPath), 'result.json');
assert.ok(!fs.existsSync(output), 'Never overwrite an existing model experiment');
const { loadModelStore, activeChannel, connectionOf } = await import(`${proof.runtimePath}/apps/api/src/model-settings.ts`);
const { UsageLedger, redactSecrets, ModelGateway, OpenAICompatibleAdapter } = await import(`${proof.runtimePath}/packages/model-gateway/src/index.ts`);
const { JsonDesignPlanner } = await import(`${proof.runtimePath}/packages/planner/src/index.ts`);
const settings = loadModelStore('data/model-settings.json'), connection = connectionOf(activeChannel(settings), settings.source);
assert.equal(connection.planningModel, 'gpt-5.6-luna');
assert.ok(settings.channels.every(channel => !channel.fallback));
const ledger = new UsageLedger(Infinity, undefined, { maxCalls: 2 });
const gateway = new ModelGateway(new Map([['openai-compatible', new OpenAICompatibleAdapter(fetch, connection.timeoutMs, true)]]), ledger);
const endpoint = connection.endpoint.replace(/\/$/, '').replace(/(?:\/v1)?$/, '/v1');
const planner = new JsonDesignPlanner({ complete: async request => (await gateway.complete({
  role: request.role ?? 'reviewing', model: connection.planningModel, system: request.system + proof.suffix,
  user: request.user, maxOutputTokens: request.maxOutputTokens, responseFormat: 'json', temperature: 0.2,
}, 'openai-compatible', { endpoint, apiKey: connection.apiKey })).text });
const state = { status: 'running', pid: process.pid, startedAt: new Date().toISOString(), inputSha256: proof.inputSha256,
  model: connection.planningModel, fallback: false, maxCalls: 2, productionWrites: 0, formalAcceptance: false };
fs.writeFileSync(output, JSON.stringify(state), { flag: 'wx' });
try { state.result = await planner.reviewDesignContent(read(proof.inputPath)); state.status = 'completed'; }
catch (error) { state.status = 'failed'; state.failure = { error: String(redactSecrets(error.message)), modelResponses: error.modelResponses ?? [] }; process.exitCode = 1; }
finally {
  state.finishedAt = new Date().toISOString(); state.usage = ledger.summary();
  state.runtimeUnchanged = Object.entries(proof.sourceHashes).every(([name, expected]) => sha(path.join(proof.runtimePath, name)) === expected);
  fs.writeFileSync(`${output}.pending`, JSON.stringify(state, null, 2)); fs.renameSync(`${output}.pending`, output);
  console.log(JSON.stringify({ status: state.status, calls: state.usage.calls, runtimeUnchanged: state.runtimeUnchanged,
    checks: state.result?.checks.map(({ criterion, verdict, explanation, awaitingSources }) => ({ criterion, verdict, explanation, awaitingSources })), error: state.failure?.error }));
}
