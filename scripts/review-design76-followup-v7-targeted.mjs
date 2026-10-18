// Review the complete v6 change set and its dependencies without touching the
// formal assessment, production database, approved plan or manuscripts.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateDesignCandidate } from '../packages/application/src/design-candidate.ts';
const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const mode = process.argv[2];
assert.ok(['--prepare', '--execute', '--verify'].includes(mode));
const control = 'data/audit-runtimes/design76-followup-v7-targeted';
const candidatePath = 'data/design-candidates/design76-followup-controls-v7.json';
const candidate = read(candidatePath), proof = read('docs/audits/2026-10-18-design76-followup-reuse-v7.json');
assert.equal(hash(candidate), proof.candidateSha256);
assert.equal(validateDesignCandidate(candidate).valid, true);
const actualBase = read('docs/audits/2026-10-18-design76-repairs-applied.json');
const formalInputs = read('data/audit-runtimes/design76-notes30-review/inputs.json');
const base = { basePlanId: actualBase.appliedPlanId, expectedInputHash: formalInputs.world.inputHash };
assert.equal(base.basePlanId, formalInputs.world.scope.planRevisionId);
const priorProofPath = 'docs/audits/2026-10-18-design76-followup-v6-integrated-review.json';
const prior = read(priorProofPath);
assert.equal(sha(prior.statePath), prior.stateSha256);
assert.equal(prior.candidateSha256, proof.parentSha256);
const bindingPath = 'data/audit-runtimes/design76-fragment-index-runtime-bound.json', binding = read(bindingPath);
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(sha(`${binding.runtimePath}/${p}`), h);
for (const [p, h] of Object.entries(binding.dependencyHashes)) assert.equal(sha(p), h);
const source = (id, value) => ({ id, text: JSON.stringify(value, null, 2) });
const rows = (key, field, filter = () => true) => candidate[key][field].filter(filter).map(item => source(`${{ worldPack: 'world', storyBible: 'story', plan: 'plan' }[key]}/${field}/${item.id}`, item));
const context = source('candidate/context', {
  stage: 'unapplied_v7_proposal', formalAcceptance: false,
  note: '这是局部复核，不改上轮原答。新增两件法宝复用规则是作者选择的新约束，不是世界原来已发生的事实，也不要求所有法宝同一冷却。另复核上轮费用、程的行程、白榆身份三项疑点，须逐字核实际来源；可能是设计缺陷，也可能是前次漏读或材料未带齐，不沿用旧结论。前次world未提供ms_v3_convoy，这次给出完整里程碑；不要把人物初始locationId当作任何后续时点仍在该地。正文未写不否定合理设计提案，但不能声称已实现。',
});
const power = read('data/audit-runtimes/design76-followup-v6-integrated/power-input.json').sources
  .filter(s => !s.id.startsWith('prior-design76/') && s.id !== 'candidate/context')
  .map(s => s.id.startsWith('world/artifacts/') ? source(s.id, candidate.worldPack.artifacts.find(a => s.id.endsWith('/' + a.id))) : s);
const specs = {
  power: { sources: [context, ...power, source('candidate/reuse-changes', proof.changes)], rubric: {
    tiers: '核两件新增复用条件与既有玄府训练、本境法力与普通注意力条件相容；不把检查变成新探知或免费施术。',
    costs: '重新使用须完整支付，检查、停用间隔、灵石和法力恢复互不替代；已付起式或控环费用不能退回或在新一次抵扣。核正常停术、到时及受扰后都可执行。',
    counters: '逐件推演新增规则：烟罩完全停纹后连续十息无干扰检查；凝晶环停导流后一刻静息、实际回收、复核可见落点与边界。器损、伤损、疲劳、检查中断、同一交战里再用的条件是否明确，不可重锁接续旧次、不免除残冰物理后果，不能将已付费用变成免费重复攻击。指出真正矛盾或尚欠条件，不强行要求两器相同冷却。',
  } },
  world: { sources: [context, ...rows('plan', 'milestones'), ...rows('worldPack', 'locations'), ...rows('storyBible', 'characters')], rubric: {
    history: '逐项重算返乡同一杂费账：271两符、290诊费、303邮费、275护寒符、275保温衣、其他实际杂费，310税前/税后、后续返乡花费与封存余额；必须把文本列明的保温衣8纳入，不能另加收入或把8漏算后要求把625改633。对照voyage与return的不同拆分口径。若有真缺口仍须revise。另按318、410、433、435、436、438、439逐时点追程的位置与消息来源，结合convoy和payoff核往返普通驿路是否成立；初始港口位置不是永久位置，不凭空添加一次跨海行程。318以前跨海如仍缺具体承接，明确指出未解决的是哪个时段，不把它混为436返都需跨海。',
  } },
  story: { sources: [context, ...rows('storyBible', 'characters'), ...rows('worldPack', 'locations', x => x.id === 'loc_29'),
    ...rows('plan', 'milestones', x => ['ms_v3_return','ms_v3_training','ms_v3_payoff'].includes(x.id))], rubric: {
    causality: '复核315贺交证的准入前置：同时读白榆identity与goal，药役职位、外门医修和loc_29药役登记陪同规则是否足以支持提案，不能只看identity便断言原档没有药役。核登记陪同是否仍需实际获准、林不得代放行、只到药舍外间、结束离院、失败重排及不替代316复诊。若规则未授某项权限，必须指出具体原句与冲突，不发明新岗位或凭目标推定无限权限。',
  } },
};
const inputs = Object.fromEntries(Object.entries(specs).map(([area, spec]) => {
  assert.ok(JSON.stringify(spec.sources).length <= 240000);
  const input = { area, scope: formalInputs[area].scope, ...spec };
  return [area, { ...input, inputHash: hash(input) }];
}));
const changedIds = proof.changes.map(x => x.sourceId);
const manifest = { candidatePath, candidateSha256: hash(candidate), baseInputHash: base.expectedInputHash, bindingPath, bindingSha256: sha(bindingPath), priorProofPath, priorProofSha256: sha(priorProofPath),
  runnerSha256: sha(process.argv[1]), changedSourceIds: changedIds, inputs: Object.fromEntries(Object.entries(inputs).map(([area, input]) => [area, hash(input)])) };
const manifestPath = `${control}/manifest.json`, outputPath = `${control}/result.json`, journal = `${control}/model-calls`;
const durable = (p, value) => fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', flush: true });
if (mode === '--prepare') {
  assert.ok(!fs.existsSync(control)); fs.mkdirSync(control, { recursive: true });
  fs.copyFileSync(process.argv[1], `${control}/runner.mjs`);
  durable(manifestPath, manifest);
  for (const [area, input] of Object.entries(inputs)) durable(`${control}/${area}-input.json`, input);
  console.log(JSON.stringify({ prepared: true, changedSourceIds: changedIds, sourceCharacters: Object.fromEntries(Object.entries(inputs).map(([a, i]) => [a, JSON.stringify(i.sources).length])) }));
  process.exit(0);
}
assert.deepEqual(read(manifestPath), manifest);
for (const [area, input] of Object.entries(inputs)) assert.deepEqual(read(`${control}/${area}-input.json`), input);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
if (mode === '--verify') {
  const state = read(outputPath);
  assert.equal(state.status, 'completed');
  try { process.kill(state.pid, 0); assert.fail('Review worker live'); } catch (e) { assert.equal(e.code, 'ESRCH'); }
  let total = 0;
  for (const record of state.areas) {
    let next = 0;
    const planner = new JsonDesignPlanner({ complete: async request => {
      const number = ++total, prefix = `${journal}/${String(number).padStart(5, '0')}`;
      const sent = read(prefix + '.started.json'), received = read(prefix + '.response.json');
      assert.equal(sent.area, record.area); assert.equal(received.number, number);
      assert.deepEqual(sent.request, { role: request.role ?? 'reviewing', model: state.model, system: request.system, user: request.user, maxOutputTokens: request.maxOutputTokens, responseFormat: 'json', temperature: 0.2 });
      assert.equal(received.response.text, record.rawResponses[next++]);
      return received.response.text;
    } });
    assert.deepEqual(await planner.reviewDesignContent(inputs[record.area]), record.result);
    assert.equal(next, record.rawResponses.length);
  }
  assert.equal(total, state.calls);
  assert.deepEqual(state.areas.map(r => r.area), Object.keys(inputs));
  durable('docs/audits/2026-10-18-design76-followup-v7-targeted-review.json', { verified: true, ...manifest, statePath: outputPath, stateSha256: sha(outputPath),
    model: state.model, calls: total, modelCalls: 0, productionWrites: 0, formalAcceptance: false,
    results: state.areas.map(({ area, result }) => ({ area, result })) });
  console.log(JSON.stringify({ verified: true, calls: total, results: state.areas.map(r => ({ area: r.area, checks: r.result.checks.map(c => ({ criterion: c.criterion, verdict: c.verdict })) })) }));
  process.exit(0);
}
const formalPath = 'data/audit-runtimes/design76-notes30-review/result.json', formal = read(formalPath);
assert.equal(sha(formalPath), read('data/audit-runtimes/design76-notes30-review/baseline.json').predecessorCheckpointSha256);
assert.ok(formal.status.startsWith('stopped_'));
try { process.kill(formal.pid, 0); assert.fail('Formal worker live'); } catch (e) { assert.equal(e.code, 'ESRCH'); }
assert.ok(!fs.existsSync(outputPath), 'Inspect previous attempt; never silently repeat model calls');
const { loadModelStore, activeChannel, connectionOf } = await import(`${binding.runtimePath}/apps/api/src/model-settings.ts`);
const { UsageLedger, ModelGateway, OpenAICompatibleAdapter, redactSecrets } = await import(`${binding.runtimePath}/packages/model-gateway/src/index.ts`);
const settings = loadModelStore('data/model-settings.json'), conn = connectionOf(activeChannel(settings), settings.source);
assert.equal(conn.planningModel, 'gpt-5.6-luna'); assert.ok(settings.channels.every(c => !c.fallback));
const state = { status: 'running', pid: process.pid, candidateSha256: hash(candidate), formalCheckpointSha256: sha(formalPath), model: conn.planningModel, fallback: false,
  startedAt: new Date().toISOString(), calls: 0, areas: [], productionWrites: 0, formalAcceptance: false };
const save = () => { fs.writeFileSync(outputPath + '.pending', JSON.stringify(state, null, 2) + '\n'); fs.renameSync(outputPath + '.pending', outputPath); };
fs.mkdirSync(journal); save();
const ledger = new UsageLedger(Infinity, undefined, { maxCalls: 6 });
const gateway = new ModelGateway(new Map([['openai-compatible', new OpenAICompatibleAdapter(fetch, conn.timeoutMs, true)]]), ledger);
for (const [area, input] of Object.entries(inputs)) {
  const record = { area, status: 'running', rawResponses: [] }; state.areas.push(record); save();
  const planner = new JsonDesignPlanner({ complete: async req => {
    const number = ++state.calls, prefix = `${journal}/${String(number).padStart(5, '0')}`;
    const request = { role: req.role ?? 'reviewing', model: conn.planningModel, system: req.system, user: req.user, maxOutputTokens: req.maxOutputTokens, responseFormat: 'json', temperature: 0.2 };
    durable(prefix + '.started.json', { number, area, startedAt: new Date().toISOString(), request }); save();
    let response;
    try { response = await gateway.complete(request, 'openai-compatible', { endpoint: conn.endpoint.replace(/\/$/, '').replace(/(?:\/v1)?$/, '/v1'), apiKey: conn.apiKey }); }
    catch (e) { durable(prefix + '.failure.json', { number, area, finishedAt: new Date().toISOString(), error: String(redactSecrets(e.message)) }); throw e; }
    durable(prefix + '.response.json', { number, area, finishedAt: new Date().toISOString(), response });
    record.rawResponses.push(response.text); save(); return response.text;
  } });
  try { record.result = await planner.reviewDesignContent(input); record.status = 'completed'; }
  catch (e) { record.status = 'failed'; record.error = String(redactSecrets(e.message)); state.status = 'failed'; process.exitCode = 1; }
  record.finishedAt = new Date().toISOString(); state.usage = ledger.summary(); save();
  console.log(JSON.stringify({ area, status: record.status, checks: record.result?.checks.map(c => ({ criterion: c.criterion, verdict: c.verdict })), error: record.error }));
  if (record.status === 'failed') break;
}
if (state.status === 'running') state.status = 'completed';
state.finishedAt = new Date().toISOString(); save();
