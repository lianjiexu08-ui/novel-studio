// Independently recheck one disputed fee against its complete definition.
// Detached evidence only: this never changes formal runs, verdicts or design.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = p => JSON.parse(fs.readFileSync(p));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const mode = process.argv[2]; assert.ok(['--prepare', '--execute', '--verify'].includes(mode));
const directory = 'data/audit-runtimes/design77-sword-inspection';
const bindingPath = 'data/audit-runtimes/design77-runtime-bound.json', binding = read(bindingPath);
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(sha(`${binding.runtimePath}/${p}`), h);
for (const [p, h] of Object.entries(binding.dependencyHashes)) assert.equal(sha(p), h);
const formal = read('data/audit-runtimes/design77-shared-review/inputs.json').power;
const responsePath = 'data/audit-runtimes/design77-shared-review/model-calls/00013.response.json';
const original = JSON.parse(read(responsePath).response.text).checks.find(check => check.criterion === 'costs');
assert.equal(original.verdict, 'revise');
const ids = ['world/artifacts/art_03', 'world/techniques/tech_04', 'world/realms/realm_02',
  'plan/chapters/18', 'plan/chapters/20', 'plan/chapters/21', 'story/chapterPlans/chapter-plan-20'];
const sources = formal.sources.filter(source => ids.includes(source.id) || source.id.startsWith('world/axioms/'));
for (const id of ids) assert.ok(sources.some(source => source.id === id), id);
const originalRequest = JSON.parse(read('data/audit-runtimes/design77-shared-review/model-calls/00012.started.json').request.user);
assert.ok(!originalRequest.sources.some(source => source.origin?.sourceId === 'world/artifacts/art_03'));
sources.push({ id: 'review/disputed-fee', text: JSON.stringify({ context: '历史模型意见，不是世界设定或必须采纳的结论。以下复核可能支持或否定该返修项，须以本次完整原文为准。', original }, null, 2) });
const base = { area: 'power', scope: formal.scope, sources, rubric: {
  costs: '独立核对第20章低流量试注半成真元是否已有明确规则依据。完整阅读art_03的费用和全部限制、tech_04以及18/20/21章；区分剑诀攻击、普通挥击、御物、冷却后的器身检查。核资格与第18章训练、作用对象/效果、费用基数与预付时点、中断/失败/异响/发热后果、是否再次免费施术，以及20章10−2−0.5+1.5=9、21章再扣0.5的账。原评审没有携带art_03；这既不能证明设计不存在，也不能自动证明原设计正确。若定义仍缺或彼此冲突应revise并准确引用；材料确实不足应insufficient；若本项已闭合可pass并指出具体依据。不能为通过而加写规则、改章纲或把这次局部复核当成完整力量领域通过。证据引用实际设定/章纲原文，不能仅引用历史意见证明其自身。',
} };
const input = { ...base, inputHash: hash(base) };
assert.ok(JSON.stringify(sources).length < 240000);
const manifest = { inputSha256: hash(input), formalInputHash: formal.inputHash, responsePath, responseSha256: sha(responsePath),
  runtimeBindingSha256: sha(bindingPath), runnerSha256: sha(process.argv[1]), originalArtifactOmitted: true };
const durable = (p, value) => fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', flush: true });
if (mode === '--prepare') {
  assert.ok(!fs.existsSync(directory)); fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(process.argv[1], `${directory}/runner.mjs`);
  durable(`${directory}/input.json`, input); durable(`${directory}/manifest.json`, manifest);
  console.log(JSON.stringify({ prepared: true, sources: sources.length, characters: JSON.stringify(sources).length, productionWrites: 0 }));
  process.exit(0);
}
assert.deepEqual(read(`${directory}/manifest.json`), manifest);
assert.deepEqual(read(`${directory}/input.json`), input);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const statePath = `${directory}/result.json`;
if (mode === '--verify') {
  const state = read(statePath); assert.equal(state.status, 'completed');
  try { process.kill(state.pid, 0); assert.fail('Local reviewer live'); } catch (error) { assert.equal(error.code, 'ESRCH'); }
  let index = 0;
  const planner = new JsonDesignPlanner({ complete: async request => {
    const prefix = `${directory}/${String(++index).padStart(3, '0')}`;
    assert.deepEqual(read(prefix + '.started.json').request, { ...request, role: request.role ?? 'reviewing', model: state.model, responseFormat: 'json', temperature: 0.2 });
    return read(prefix + '.response.json').response.text;
  } });
  assert.deepEqual(await planner.reviewDesignContent(input), state.result);
  assert.equal(index, state.calls);
  durable('docs/audits/2026-10-18-design77-sword-inspection-review.json', { verified: true, ...manifest, statePath, stateSha256: sha(statePath),
    calls: state.calls, result: state.result, model: state.model, fallback: false, modelCalls: 0, productionWrites: 0, formalAcceptance: false,
    limitation: 'Independent local recheck only. Original revise remains in the formal run; no design, annotation or accepted verdict has been changed.' });
  console.log(JSON.stringify({ verified: true, calls: state.calls, checks: state.result.checks.map(c => ({ criterion: c.criterion, verdict: c.verdict })), productionWrites: 0 }));
  process.exit(0);
}
const formalState = read('data/audit-runtimes/design77-shared-review/result.json');
assert.ok(formalState.status.startsWith('stopped_') || formalState.status === 'completed');
try { process.kill(formalState.pid, 0); assert.fail('Wait for the formal segment to stop'); } catch (error) { assert.equal(error.code, 'ESRCH'); }
assert.ok(!fs.existsSync(statePath), 'Inspect existing result; never silently repeat dispatched calls');
const { loadModelStore, activeChannel, connectionOf } = await import(`${binding.runtimePath}/apps/api/src/model-settings.ts`);
const { UsageLedger, ModelGateway, OpenAICompatibleAdapter, redactSecrets } = await import(`${binding.runtimePath}/packages/model-gateway/src/index.ts`);
const store = loadModelStore('data/model-settings.json'), conn = connectionOf(activeChannel(store), store.source);
assert.equal(conn.planningModel, 'gpt-5.6-luna'); assert.ok(store.channels.every(c => !c.fallback));
const ledger = new UsageLedger(Infinity, undefined, { maxCalls: 3 });
const gateway = new ModelGateway(new Map([['openai-compatible', new OpenAICompatibleAdapter(fetch, conn.timeoutMs, true)]]), ledger);
const state = { status: 'running', pid: process.pid, model: conn.planningModel, calls: 0, startedAt: new Date().toISOString() };
const save = () => { fs.writeFileSync(statePath + '.pending', JSON.stringify(state, null, 2) + '\n'); fs.renameSync(statePath + '.pending', statePath); };
save();
try {
  const planner = new JsonDesignPlanner({ complete: async request => {
    const number = ++state.calls, prefix = `${directory}/${String(number).padStart(3, '0')}`;
    const sent = { ...request, role: request.role ?? 'reviewing', model: conn.planningModel, responseFormat: 'json', temperature: 0.2 };
    durable(prefix + '.started.json', { number, request: sent, at: new Date().toISOString() }); save();
    try {
      const response = await gateway.complete(sent, 'openai-compatible', { endpoint: conn.endpoint.replace(/\/$/, '').replace(/(?:\/v1)?$/, '/v1'), apiKey: conn.apiKey });
      durable(prefix + '.response.json', { number, response, usage: ledger.summary(), at: new Date().toISOString() });
      return response.text;
    } catch (error) {
      durable(prefix + '.failure.json', { number, error: redactSecrets(String(error)), at: new Date().toISOString() }); throw error;
    }
  } });
  state.result = await planner.reviewDesignContent(input); state.status = 'completed';
} catch (error) { state.status = 'failed'; state.error = redactSecrets(String(error)); process.exitCode = 1; }
finally { state.finishedAt = new Date().toISOString(); state.usage = ledger.summary(); save(); console.log(JSON.stringify({ status: state.status, calls: state.calls, error: state.error })); }
