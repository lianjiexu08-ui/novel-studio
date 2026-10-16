// One isolated model experiment. Never writes a work, report, candidate or plan.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = path => JSON.parse(fs.readFileSync(path));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.ok(process.argv.includes('--execute'), 'Use --execute for this bounded model experiment');
const proof = read('docs/audits/2026-10-16-review-resolution-context-preflight.json');
const control = 'data/audit-runtimes/design68-resolution-context-probe';
const output = `${control}/result.json`;
assert.ok(!fs.existsSync(output), 'Existing experiment must be preserved, not rerun or overwritten');
assert.equal(sha(fs.readFileSync(proof.inputPath)), proof.inputSha256);
for (const [path, expected] of Object.entries(proof.runtimeSourceHashes)) assert.equal(sha(fs.readFileSync(path)), expected, path);
const { loadModelStore, activeChannel, connectionOf } = await import('../../apps/api/src/model-settings.ts');
const { UsageLedger, redactSecrets, ModelGateway, OpenAICompatibleAdapter } = await import('../../packages/model-gateway/src/index.ts');
const { JsonDesignPlanner } = await import('../../packages/planner/src/index.ts');
const settingsPath = 'data/model-settings.json';
const settings = loadModelStore(settingsPath), connection = connectionOf(activeChannel(settings), settings.source);
assert.equal(connection.planningModel, 'gpt-5.6-luna');
assert.equal(connection.timeoutMs, 600000);
assert.ok(settings.channels.every(channel => !channel.fallback));
const ledger = new UsageLedger(Infinity, undefined, { maxCalls: 2 });
const gateway = new ModelGateway(new Map([['openai-compatible', new OpenAICompatibleAdapter(fetch, connection.timeoutMs, true)]]), ledger);
const endpoint = connection.endpoint.replace(/\/$/, '').replace(/(?:\/v1)?$/, '/v1');
const suffix = '\n响应requestId必须逐字使用当前请求中的值，不复用旧编号；证据只引本次sources。请精确区分不同人物、账户、日期、局部综合与全局验收。只依据本步骤实际材料作判断；材料不足应说明缺失来源，不能为了通过而省略冲突。解释与引文保持必要长度，不复制整章，不隐去仍未解决的问题。';
const planner = new JsonDesignPlanner({ complete: async request => (await gateway.complete({
  role: request.role ?? 'reviewing', model: connection.planningModel, system: request.system + suffix,
  user: request.user, maxOutputTokens: request.maxOutputTokens, responseFormat: 'json', temperature: 0.2,
}, 'openai-compatible', { endpoint, apiKey: connection.apiKey })).text });
const state = { status: 'running', pid: process.pid, startedAt: new Date().toISOString(), inputSha256: proof.inputSha256,
  model: connection.planningModel, fallback: false, maxCalls: 2, settingsSha256: sha(fs.readFileSync(settingsPath)),
  modelCalls: 0, productionWrites: 0, formalAcceptance: false };
fs.writeFileSync(output, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' });
try {
  state.result = await planner.reviewDesignContent(read(proof.inputPath));
  state.status = 'completed';
} catch (error) {
  state.status = 'failed';
  state.failure = { error: String(redactSecrets(error.message)), modelResponses: error.modelResponses ?? [] };
  process.exitCode = 1;
} finally {
  state.finishedAt = new Date().toISOString();
  state.usage = ledger.summary();
  state.modelCalls = state.usage.calls;
  state.runtimeUnchanged = Object.entries(proof.runtimeSourceHashes).every(([path, expected]) => sha(fs.readFileSync(path)) === expected);
  fs.writeFileSync(`${output}.pending`, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(`${output}.pending`, output);
  console.log(JSON.stringify({ status: state.status, modelCalls: state.modelCalls, runtimeUnchanged: state.runtimeUnchanged,
    checks: state.result?.checks.map(check => ({ criterion: check.criterion, verdict: check.verdict })), error: state.failure?.error,
    productionWrites: 0, formalAcceptance: false }));
}
