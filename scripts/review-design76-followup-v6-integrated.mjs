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
const control = 'data/audit-runtimes/design76-followup-v6-integrated';
const candidatePath = 'data/design-candidates/design76-followup-controls-v6.json';
const candidate = read(candidatePath), base = read('data/design-candidates/design76-baseline.json');
const proof = read('docs/audits/2026-10-18-design76-followup-admission-v6.json');
assert.equal(hash(candidate), proof.candidateSha256);
assert.equal(validateDesignCandidate(candidate).valid, true);
const bindingPath = 'data/audit-runtimes/design76-fragment-index-runtime-bound.json', binding = read(bindingPath);
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(sha(`${binding.runtimePath}/${p}`), h);
for (const [p, h] of Object.entries(binding.dependencyHashes)) assert.equal(sha(p), h);
const source = (id, value) => ({ id, text: JSON.stringify(value, null, 2) });
function documents(bundle) {
  return ['worldPack', 'storyBible', 'plan'].flatMap(key => Object.entries(bundle[key]).flatMap(([field, value]) =>
    Array.isArray(value) && value.every(item => item && typeof item === 'object' && item.id)
      ? value.map(item => source(`${{ worldPack: 'world', storyBible: 'story', plan: 'plan' }[key]}/${field}/${key === 'plan' && field === 'chapters' ? item.chapterNumber : item.id}`, item)) : []));
}
const before = documents(base.candidate), after = documents(candidate);
const changes = after.filter(item => before.find(old => old.id === item.id)?.text !== item.text);
const changedIds = changes.map(s => s.id);
function fieldChanges(a, b, pointer = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => fieldChanges(a[key], b[key], `${pointer}/${key}`));
  }
  return [{ pointer, before: a ?? null, after: b ?? null }];
}
const chapters = new Set([20,21,22,23,32,33,34,35,36,37,38,39,48,49,50]);
const chapterSource = s => (s.id.startsWith('plan/chapters/') || s.id.startsWith('story/chapterPlans/')) && chapters.has(JSON.parse(s.text).chapterNumber);
const common = s => /^story\/(characters|relationships|secrets)\//.test(s.id) || s.id.startsWith('story/arcBeats/message-') || chapterSource(s)
  || /^plan\/milestones\/(ms_v2_loss|ms_v2_fire|ms_v3_return|ms_v3_training|ms_v3_payoff)$/.test(s.id);
const filters = {
  power: s => /^world\/(axioms|tierLadders)\//.test(s.id) || /^world\/realms\/realm_0[234]$/.test(s.id)
    || /^world\/artifacts\/art_(04|06|08)$/.test(s.id) || s.id === 'world/techniques/tech_07' || s.id === 'world/resources/res_01',
  characters: common,
  world: s => /^world\/(locations|factions)\//.test(s.id) || /^story\/characters\//.test(s.id)
    || /^plan\/milestones\/(ms_v3_return|ms_v3_training|ms_v3_payoff)$/.test(s.id) || s.id === 'world/resources/res_01',
  story: s => common(s) || /^plan\/volumes\//.test(s.id) || s.id === 'story/openThreads/th_05',
};
const rubrics = {
  power: {
    tiers: '三件修订法宝的玄府使用资格、训练与实测是否完整，不偷用未定义神识或自动赋予神海穿透烟障能力。比较旧版与候选，检查新增资格不会与已有境界和本境法力规则冲突。',
    costs: '逐件核持续、预付、失败和中断费用；真元/元罡/当境法力、灵石与注意力不可混账，不能将注意力造为新神识余额。',
    counters: '具体推演烟罩挡本人视线、凝晶环落水或结冰遮视、拂尘脱手失供；接触控制、目标范围、复用间隔、残冰残丝及物理后果须明确，不能脑补新操作或仅凭境界突破限制。',
  },
  characters: {
    knowledge: '核全部相关修订：21章林苏只获前哨亲见和秦的主营方向口述，22实核布局、23辨明指挥者不能提前；32—39救人、作者用名、工牌姓名、核名和箱货定责不能合并；50外院/门口及52脚夫见闻、53赵阅报、438抵都/439面报须一致。重点逐字比对sec_02、char_19、rel_17、message-dispatch与两套章纲，不因旧局部通过省略核查。',
    relationships: '救人与信任、拒绝伪证、秦有限带路和送信、陆氏兄弟各自见闻、贺访客陪同应保持实际选择和权限边界；修订不能偷改人物立场、提前获得证据或取消代价。',
  },
  world: {
    geography: '重点推演315日贺返乡交证：loc_29规定的准入与药役白榆身份、核验登记、药舍外间陪同、离院、许可失败和延期条件是否闭合；旧315会面安排与新增陪同须可同时成立。海港担保、商盟身份、林的弟子身份不能代替贺访客准入。不赋予档房/内门/医疗或居住权。',
    history: '315交证、780费用与封存220、316林复诊、贺离程、311夜返岗/318阅回执、438程抵都/439面报在现有路线与身份下是否相容；区分返乡事实提案和后续人物才收到的消息。',
  },
  story: {
    causality: '综合本次人物知情与场景改动：21—23前哨至主营、32—39失箱核名调查、50门口救人到52—53报令、315返乡交证、438抵都/439面报。改动后的前置、现场行动、认知触发、下一场后果须匹配，独立视角不能回写角色知识；新访客手续并入既有场景，不凭未写的路程、付款、登记或对话补洞。',
    payoff: '失箱证据递进、工人自主脱控、贺有限合作及独立见证、赵有限知情是否仍保留冲突与后果，不能因修一致性提前兑现秘密或把角色沦为手续工具。只评设计可写性，不声称正文已经实现；51—100宏观无需伪装成已完成细纲。',
  },
};
const inputs = Object.fromEntries(Object.keys(filters).map(area => {
  const selected = after.filter(filters[area]);
  const old = changes.filter(filters[area]).map(item => source(`prior-design76/${item.id}`, { sourceId: item.id,
    changedFields: fieldChanges(JSON.parse(before.find(s => s.id === item.id).text), JSON.parse(item.text)) }));
  const context = source('candidate/context', { stage: 'unapplied_v6_proposal', changedSourceIds: changes.filter(filters[area]).map(s => s.id),
    note: '仅审本次完整改动及给出的依赖；prior-design76是旧稿对照，不与候选同时生效。候选尚未应用，41条待处理记录包括正文实现事项，本次不关闭。核对引用是否真正支持解释，严格区分陆沉舟与陆沉川、主角已知与作者已知。允许明确新增的作者场景提案，但不能把提案当历史已发生。寻找遗漏、冲突和不可执行之处，不按已有复审结论表态；材料不足请点名具体缺失来源。' });
  const sources = [context, ...old, ...selected];
  assert.ok(JSON.stringify(sources).length <= 240000, `${area} too large`);
  const input = { area, scope: { worldPackRevision: 40, storyBibleRevision: 72, planRevisionId: base.basePlanId, planRevision: 76 }, rubric: rubrics[area], sources };
  return [area, { ...input, inputHash: hash(input) }];
}));
assert.ok(changedIds.every(id => Object.values(inputs).some(i => i.sources.some(s => s.id === id))), 'All changed documents must be reviewed');
const manifest = { candidatePath, candidateSha256: hash(candidate), baseInputHash: base.expectedInputHash, bindingPath, bindingSha256: sha(bindingPath),
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
  durable('docs/audits/2026-10-18-design76-followup-v6-integrated-review.json', { verified: true, ...manifest, statePath: outputPath, stateSha256: sha(outputPath),
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
const ledger = new UsageLedger(Infinity, undefined, { maxCalls: 8 });
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
