// Detached, bounded review of the new identity-boundary edits. Preparation and
// replay are offline; real calls require a terminal-verified formal segment.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const read = p => JSON.parse(fs.readFileSync(p));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const mode = process.argv[2];
assert.ok(['--prepare', '--execute', '--verify'].includes(mode));
const proofPath = 'docs/audits/2026-10-18-design76-followup-knowledge-v3.json';
const proof = read(proofPath), candidate = read(proof.candidatePath);
assert.equal(hash(candidate), proof.candidateSha256);
const control = 'data/audit-runtimes/design76-followup-v3-review';
const bindingPath = 'data/audit-runtimes/design76-citation-operations-runtime-bound.json';
const binding = read(bindingPath);
for (const [p, h] of Object.entries(binding.sourceHashes)) assert.equal(fileHash(`${binding.runtimePath}/${p}`), h);
for (const [p, h] of Object.entries(binding.dependencyHashes)) assert.equal(fileHash(p), h);
const source = (id, value) => { assert.notEqual(value, undefined, id); return {id, text: JSON.stringify(value, null, 2)}; };
const formalControl = 'data/audit-runtimes/design76-citation-edits-review';
const scope = read(`${formalControl}/inputs.json`).story.scope;
const context = source('candidate/context', {
  stage: 'unapplied_followup_draft', formalAcceptance: false,
  note: '只核第33章严涛身份知情边界及其在32—39章、关系档、秘密档和里程碑中的承接。prior-design76仅为旧版对照，不与候选同时生效。作者叙述使用名字不自动等于角色已知；须按实际当面行动、见闻或取得记录区分。不能把已知脸/被救押货者、获悉姓名、核对工牌、证明私挪责任或查清货物去向合为一次确认。候选尚未应用，原41项阻塞保留；不得把局部复审当作全书或正文验收。请逐句比较同一状态的所有来源，发现冲突、未交代的来源或范围过大应明确提出，不替作者脑补补平。人物编号必须对应原表：陆沉舟char_16是哥哥，陆沉川char_21是弟弟，不得交换押送、亲历和供述主体。',
});
const sources = [context,
  ...proof.changes.map((x, i) => source(`prior-design76/changed-field/${i + 1}`, {sourceId:x.sourceId, field:x.field, before:x.before})),
  ...candidate.storyBible.characters.filter(x => ['char_01','char_15','char_16','char_19','char_20','char_21'].includes(x.id)).map(x => source(`story/characters/${x.id}`, x)),
  ...candidate.plan.chapters.filter(x => x.chapterNumber >= 32 && x.chapterNumber <= 39).map(x => source(`plan/chapters/${x.chapterNumber}`, x)),
  ...candidate.storyBible.chapterPlans.filter(x => x.chapterNumber >= 32 && x.chapterNumber <= 39).map(x => source(`story/chapterPlans/${x.id}`, x)),
  source('story/relationships/rel_17', candidate.storyBible.relationships.find(x => x.id === 'rel_17')),
  source('story/secrets/sec_04', candidate.storyBible.secrets.find(x => x.id === 'sec_04')),
  source('story/openThreads/th_05', candidate.storyBible.openThreads.find(x => x.id === 'th_05')),
  source('plan/milestones/ms_v2_loss', candidate.plan.milestones.find(x => x.id === 'ms_v2_loss')),
];
const rubrics = {
  characters: {
    knowledge: '逐句核对林辰在32风暴、33交割与侧门独立视角、34索伪证和常钧陈述、35取得侧门底册、37获救者自报、38当面核实和39货物核对时分别知道什么。核33章末、圣经endHook、rel_17和sec_04是否一致，后续有没有倒填姓名、私挪全貌、陆氏兄弟关系或箱内去向；原错误的修改必须有对应来源且不产生新知情缺口。',
    relationships: '核rel_17第33章状态与34—37、38以后阶段的因果承接：救过一个人、拒绝伪证、工牌核对、私挪责任分别由何事改变关系，是否把尚未确认身份写成已核实或提前认罪；不得因作者给关系端点编号就判角色已知。保持人物自身选择和责任，不移花接木陆氏兄弟。',
  },
  story: {
    causality: '只核32—39章失箱调查链及本次六字段修订。33章末与独立侧门场景、圣经章纲、关系阶段及卷级ms_v2_loss不得互相冲突。34章面对的被救押货者、35章底册中的工牌姓名、38—39对质与实物核验须有各自来源；不能从作者视角偷渡给林，也不能为了修知情而消除已有实际行为。',
    payoff: '六号箱的追查是否仍按亲见搬移、常钧有限陈述、侧门册、陆弟便条与分架页、严常对质、实物核验分步兑现；修正不得提前证明货物去向、火因、兄弟关系或幕后。核候选与旧版差异是否只修提前知情而保留原冲突和后果。',
  },
};
assert.ok(JSON.stringify(sources).length <= 240000);
const inputs = Object.fromEntries(Object.entries(rubrics).map(([area, rubric]) => [area,
  {area, scope, sources, rubric, inputHash: hash({area, scope, rubric, sources})}]));
const manifestPath = `${control}/manifest.json`, outputPath = `${control}/result.json`;
const manifest = {candidateSha256: hash(candidate), proofSha256: fileHash(proofPath), bindingSha256: fileHash(bindingPath),
  runnerSha256: fileHash(process.argv[1]), inputs: Object.fromEntries(Object.entries(inputs).map(([a, i]) => [a, hash(i)]))};
if (mode === '--prepare') {
  assert.ok(!fs.existsSync(manifestPath));
  fs.mkdirSync(control, {recursive: true});
  for (const [area, input] of Object.entries(inputs)) fs.writeFileSync(`${control}/${area}-input.json`, JSON.stringify(input, null, 2) + '\n', {flag: 'wx'});
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({prepared: true, areas: Object.keys(inputs), sourceCharacters: JSON.stringify(sources).length, modelCalls: 0, productionWrites: 0}));
  process.exit(0);
}
assert.deepEqual(read(manifestPath), manifest);
for (const [area, input] of Object.entries(inputs)) assert.deepEqual(read(`${control}/${area}-input.json`), input);
const {JsonDesignPlanner} = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const journal = `${control}/model-calls`;
const durable = (p, x) => fs.writeFileSync(p, JSON.stringify(x, null, 2) + '\n', {flag: 'wx', flush: true});
if (mode === '--verify') {
  const state = read(outputPath);
  assert.equal(state.status, 'completed');
  try { process.kill(state.pid, 0); assert.fail('Detached worker still live'); } catch (e) { assert.equal(e.code, 'ESRCH'); }
  assert.equal(state.candidateSha256, hash(candidate));
  assert.equal(state.model, 'gpt-5.6-luna'); assert.equal(state.fallback, false);
  assert.deepEqual(state.areas.map(a => a.area), Object.keys(inputs));
  const names = fs.readdirSync(journal).filter(n => n.endsWith('.started.json')).sort();
  assert.equal(names.length, state.calls);
  const calls = names.map((name, index) => {
    const start = read(`${journal}/${name}`), resultPath = `${journal}/${name.replace('.started.json', '.response.json')}`;
    const result = read(resultPath);
    assert.equal(start.number, index + 1); assert.equal(result.number, start.number); assert.equal(result.area, start.area);
    assert.ok(!fs.existsSync(`${journal}/${name.replace('.started.json', '.failure.json')}`));
    return {start, result, startSha256: fileHash(`${journal}/${name}`), responseSha256: fileHash(resultPath)};
  });
  for (const area of state.areas) {
    assert.equal(area.status, 'completed');
    const areaCalls = calls.filter(c => c.start.area === area.area);
    assert.deepEqual(area.rawResponses, areaCalls.map(c => c.result.response.text));
    let next = 0;
    const planner = new JsonDesignPlanner({complete: async req => {
      const call = areaCalls[next++]; assert.ok(call);
      assert.deepEqual(call.start.request, {role: req.role ?? 'reviewing', model: state.model, system: req.system,
        user: req.user, maxOutputTokens: req.maxOutputTokens, responseFormat: 'json', temperature: 0.2});
      return call.result.response.text;
    }});
    assert.deepEqual(await planner.reviewDesignContent(inputs[area.area]), area.result);
    assert.equal(next, areaCalls.length);
  }
  assert.ok(calls.every(c => state.areas.some(a => a.area === c.start.area)));
  assert.equal(fileHash(state.formalVerificationPath), state.formalVerificationSha256);
  const formal = read(state.formalVerificationPath);
  assert.equal(fileHash(formal.checkpointPath), state.formalCheckpointSha256);
  durable('docs/audits/2026-10-18-design76-followup-v3-review.json', {
    kind: 'design76_followup_v3_review_replayed', observedAt: new Date().toISOString(), verified: true,
    statePath: outputPath, stateSha256: fileHash(outputPath), candidatePath: proof.candidatePath, ...manifest,
    model: state.model, fallback: false, originalModelCalls: state.calls, modelCalls: 0, productionWrites: 0,
    formalCheckpointSha256: state.formalCheckpointSha256, formalVerificationPath: state.formalVerificationPath,
    results: state.areas.map(a => ({area: a.area, result: a.result})),
    journal: calls.map(c => ({number: c.start.number, area: c.start.area, startSha256: c.startSha256, responseSha256: c.responseSha256})),
    blockersClosed: 0, formalAcceptance: false,
    limitation: 'Local identity-boundary candidate review only; verdicts are preserved as returned and may require revision. No production application or whole-book acceptance.',
  });
  console.log(JSON.stringify({verified: true, calls: state.calls, checks: state.areas.map(a => ({area: a.area, checks: a.result.checks.map(c => ({criterion: c.criterion, verdict: c.verdict}))})), formalAcceptance: false}));
  process.exit(0);
}

const checkpointPath = `${formalControl}/result.json`, checkpoint = read(checkpointPath);
assert.ok(['stopped_after_stage_limit','stopped_after_failure','stopped_after_budget','stopped_by_signal','completed'].includes(checkpoint.status));
try { process.kill(checkpoint.pid, 0); assert.fail('Formal review worker still live'); } catch (e) { assert.equal(e.code, 'ESRCH'); }
const formalVerificationPath = `docs/audits/2026-10-18-design76-citation-edits-review-segment-${checkpoint.segment}.json`;
const verification = read(formalVerificationPath);
assert.equal(fileHash(checkpointPath), verification.checkpointSha256);
assert.equal(verification.workerAbsent, true); assert.equal(verification.unsettledCalls, 0);
assert.ok(!fs.existsSync(outputPath), 'Inspect existing results rather than repeat calls');
const {loadModelStore, activeChannel, connectionOf} = await import(`${binding.runtimePath}/apps/api/src/model-settings.ts`);
const {UsageLedger, ModelGateway, OpenAICompatibleAdapter, redactSecrets} = await import(`${binding.runtimePath}/packages/model-gateway/src/index.ts`);
const settings = loadModelStore('data/model-settings.json'), conn = connectionOf(activeChannel(settings), settings.source);
assert.equal(conn.planningModel, 'gpt-5.6-luna'); assert.ok(settings.channels.every(c => !c.fallback));
const state = {status: 'running', pid: process.pid, startedAt: new Date().toISOString(), candidateSha256: hash(candidate),
  formalVerificationPath, formalVerificationSha256: fileHash(formalVerificationPath), formalCheckpointSha256: verification.checkpointSha256,
  model: conn.planningModel, fallback: false, productionWrites: 0, formalAcceptance: false, areas: [], calls: 0};
const save = () => { fs.writeFileSync(outputPath + '.pending', JSON.stringify(state, null, 2) + '\n'); fs.renameSync(outputPath + '.pending', outputPath); };
save(); fs.mkdirSync(journal, {recursive: true});
const ledger = new UsageLedger(Infinity, undefined, {maxCalls: 4});
const gateway = new ModelGateway(new Map([['openai-compatible', new OpenAICompatibleAdapter(fetch, conn.timeoutMs, true)]]), ledger);
for (const [area, input] of Object.entries(inputs)) {
  const record = {area, status: 'running', rawResponses: []}; state.areas.push(record); save();
  const planner = new JsonDesignPlanner({complete: async req => {
    const number = ++state.calls, prefix = `${journal}/${String(number).padStart(5, '0')}`;
    const request = {role: req.role ?? 'reviewing', model: conn.planningModel, system: req.system, user: req.user,
      maxOutputTokens: req.maxOutputTokens, responseFormat: 'json', temperature: 0.2};
    durable(prefix + '.started.json', {number, area, startedAt: new Date().toISOString(), request}); save();
    let response;
    try { response = await gateway.complete(request, 'openai-compatible', {endpoint: conn.endpoint.replace(/\/$/, '').replace(/(?:\/v1)?$/, '/v1'), apiKey: conn.apiKey}); }
    catch (e) { durable(prefix + '.failure.json', {number, area, finishedAt: new Date().toISOString(), error: String(redactSecrets(e.message))}); throw e; }
    durable(prefix + '.response.json', {number, area, finishedAt: new Date().toISOString(), response});
    record.rawResponses.push(response.text); save(); return response.text;
  }});
  try { record.result = await planner.reviewDesignContent(input); record.status = 'completed'; }
  catch (e) { record.status = 'failed'; record.error = String(redactSecrets(e.message)); state.status = 'failed'; process.exitCode = 1; }
  record.finishedAt = new Date().toISOString(); state.usage = ledger.summary(); save();
  console.log(JSON.stringify({area, status: record.status, calls: state.calls, checks: record.result?.checks.map(c => ({criterion: c.criterion, verdict: c.verdict})), error: record.error}));
  if (record.status === 'failed') break;
}
if (state.status === 'running') state.status = 'completed';
state.finishedAt = new Date().toISOString(); save();
