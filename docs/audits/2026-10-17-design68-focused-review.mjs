// Bounded, isolated content checks. Never saves a design or formal review.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = value => createHash('sha256').update(value).digest('hex');
const fileHash = file => sha(fs.readFileSync(file));
const hash = value => sha(JSON.stringify(value));
const control = path.resolve('data/audit-runtimes/design68-focused-review');
const manifestPath = path.join(control, 'manifest.json');
const baseline = read('data/audit-runtimes/design68-review/baseline.json');
const checkpointPath = 'data/audit-runtimes/design68-review/result.json';
const candidatePath = 'data/design-candidates/design68-combined-draft-v16.json';
const oldBinding = read('data/audit-runtimes/design68-runtime-bound.json');
const saveProof = read('docs/audits/2026-10-16-design68-v16-save-rehearsal.json');
const mode = process.argv[2];
assert.ok(['--prepare', '--execute', '--verify'].includes(mode));

async function checkProduction() {
  process.env.DATABASE_URL = `file:${path.resolve('data/novel-studio.db')}`;
  const { PrismaWorkRepository } = await import(`${oldBinding.runtimePath}/packages/persistence/src/prisma-repository.ts`);
  const repo = new PrismaWorkRepository();
  try {
    const work = await repo.get(baseline.workId);
    assert.ok(work);
    const protectedHash = hash({ world: work.worldPack, bible: work.storyBible, plans: [...work.plans], activePlanId: work.activePlanId,
      versions: [...work.versions], events: [...work.events], manuscripts: [...work.manuscripts], candidates: [...work.candidates] });
    assert.equal(protectedHash, baseline.protectedHash);
    for (const [id, expected] of baseline.oldRuns) assert.equal(hash(work.designReviewRuns.get(id)), expected);
    for (const [id, expected] of baseline.oldReports) assert.equal(hash(work.designContentReviews.get(id)), expected);
    const checkpoint = read(checkpointPath);
    assert.equal(checkpoint.status, 'completed');
    for (const run of checkpoint.runs) assert.equal(hash(work.designReviewRuns.get(run.id)), hash(run));
    for (const report of checkpoint.reports) assert.equal(hash(work.designContentReviews.get(report.id)), hash(report));
    return { protectedHash, plans: work.plans.size, chapterVersions: work.versions.size, events: work.events.size,
      manuscripts: work.manuscripts.size, candidates: work.candidates.size, approvedPlan: work.plans.get(work.activePlanId).revision };
  } finally { await repo.disconnect(); }
}

if (mode === '--prepare') {
  assert.ok(!fs.existsSync(control), 'Preserve existing preparation');
  assert.equal(fileHash(candidatePath), saveProof.candidateSha256);
  assert.equal(fileHash(saveProof.inputsPath), saveProof.inputsSha256);
  const protectedBefore = await checkProduction();
  const inputs = read(saveProof.inputsPath);
  fs.mkdirSync(control);
  const runtimePath = path.join(control, 'runtime');
  const sourceHashes = {};
  for (const name of Object.keys(oldBinding.sourceHashes)) {
    const destination = path.join(runtimePath, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(name, destination);
    sourceHashes[name] = fileHash(destination);
  }
  fs.mkdirSync(path.join(runtimePath, 'node_modules'));
  for (const entry of fs.readdirSync('node_modules')) {
    const source = fs.realpathSync(path.resolve('node_modules', entry));
    const relative = path.relative(process.cwd(), source);
    const target = fs.existsSync(path.join(runtimePath, relative, 'package.json')) ? path.join(runtimePath, relative) : source;
    fs.symlinkSync(target, path.join(runtimePath, 'node_modules', entry));
  }
  const specifications = [
    { area: 'world', rubric: { geography: '仅检查北境七名矿工从285日至291日获救前的生存安排及救援衔接：保暖、通风、口粮、人员、供给来源与时间是否成立，非法扣押如何漏查；区分货船、救援船及不同资金。指出冲突或确缺的必要条件，不替设定补理由。' },
      include: id => id === 'author' || id.startsWith('world/') || id === 'story/overview' || id.startsWith('story/characters/') || id === 'plan/overview' || id.startsWith('plan/volumes/') || id.startsWith('plan/milestones/') },
    { area: 'power', rubric: {
      tiers: '仅检查赤霞斩铁剑低流量试注的训练资格和使用门槛，以及第23章墨幽屠个人实测负荷与实际车重是否对应。区分个人实测、规则上限与现场载荷，不能从境界自动推定掌握。',
      costs: '仅检查低流量试注与挥击、剑诀的分别计费，冷却、停止条件、伤限和历次使用的余额衔接；检查新增训练费用是否有明确时间边界且未挪用后续恢复。说明实际有无重复消费、免费检查或循环验剑。',
      counters: '检查本批两项修订是否越过旧剑不能承载元罡、个人负荷、距离和承重对象等原规则，是否通过新增描述抹去代价或引入万能用途。' },
      include: id => id === 'author' || id.startsWith('world/') || id.startsWith('story/characters/') || id === 'plan/overview' || id.startsWith('plan/milestones/') || /^plan\/chapters\/(18|23|25|26|29|37|43|44|45)$/.test(id) || id === 'story/chapterPlans/chapter-plan-23' },
    { area: 'characters', rubric: {
      agency: '仅核对陆沉舟、陆沉川的身份、责任和第37/50章关键选择归属：按人物编号、关系端点与实际章纲判断，两人各自做了什么、付出什么；同一事件不同来源是否相容。不得靠简称或近似姓名推断。',
      knowledge: '仅核对父案证据与当前撤押令的知情链：哪些资料能支持父案、何时由谁获知；第95章原令实际证明什么，是否与第18/66/72/85章资料混同。评价现有安排，不声称正文已经实现。' },
      include: id => id === 'author' || id === 'story/overview' || id.startsWith('story/characters/') || id.startsWith('story/relationships/') || id.startsWith('story/secrets/') || id.startsWith('story/arcBeats/message-') || id === 'plan/overview' || id.startsWith('plan/milestones/') || /^plan\/chapters\/(18|37|44|49|50)$/.test(id) },
    { area: 'story', rubric: {
      causality: '仅比较第37章与第44章救援的起因、对象、行动、选择和后果，并核第43→44→45章实际衔接。说明每场真实发生了什么；是否重复同一次救援或转移了人物责任。',
      opening: '仅检查33—50章这两场救援是否在困境、人物选择、损失和后续行动上递进，还是用不同场景名称重复同一模板。用确切章号与人物说明，不以账目闭合替代戏剧质量。' },
      include: id => id === 'author' || id === 'story/overview' || id.startsWith('story/characters/') || ['story/relationships/rel_13', 'story/relationships/rel_19', 'plan/overview'].includes(id) || id.startsWith('plan/milestones/ms_v2_') || /^plan\/chapters\/(3[3-9]|4[0-9]|50)$/.test(id) || /^story\/chapterPlans\/bible-chapter-(3[3-9]|4[0-9]|50)$/.test(id) },
  ];
  const requests = specifications.map(({ area, rubric, include }) => {
    const input = { ...inputs[area], rubric, sources: inputs[area].sources.filter(source => include(source.id)) };
    const sourceCharacters = JSON.stringify(input.sources).length;
    assert.ok(sourceCharacters <= 240000, `${area}: ${sourceCharacters}`);
    assert.ok(input.sources.length);
    const inputPath = path.join(control, `${area}-input.json`);
    fs.writeFileSync(inputPath, JSON.stringify(input), { flag: 'wx' });
    return { area, inputPath, inputSha256: fileHash(inputPath), sourceCharacters,
      sources: input.sources.map(source => ({ id: source.id, sha256: sha(source.text) })) };
  });
  const manifest = { observedAt: new Date().toISOString(), candidatePath, candidateSha256: fileHash(candidatePath),
    savedInputsPath: saveProof.inputsPath, savedInputsSha256: saveProof.inputsSha256,
    checkpointSha256: fileHash(checkpointPath), runtimePath, sourceHashes, requests, protectedBefore,
    productionWrites: 0, formalAcceptance: false,
    limitation: 'Four targeted content checks against unchanged sources from an isolated candidate save. Not complete four-domain review, not a new production proposal, not a replacement formal report.' };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ prepared: true, requests: requests.map(({ area, sourceCharacters }) => ({ area, sourceCharacters })), protectedBefore }));
} else {
  const manifest = read(manifestPath);
  assert.equal(fileHash(candidatePath), manifest.candidateSha256);
  assert.equal(fileHash(checkpointPath), manifest.checkpointSha256);
  assert.equal(fileHash(manifest.savedInputsPath), manifest.savedInputsSha256);
  for (const [name, expected] of Object.entries(manifest.sourceHashes)) assert.equal(fileHash(path.join(manifest.runtimePath, name)), expected, name);
  for (const request of manifest.requests) assert.equal(fileHash(request.inputPath), request.inputSha256);
  const { JsonDesignPlanner } = await import(`${manifest.runtimePath}/packages/planner/src/index.ts`);
  if (mode === '--execute') {
    const { loadModelStore, activeChannel, connectionOf } = await import(`${manifest.runtimePath}/apps/api/src/model-settings.ts`);
    const { UsageLedger, redactSecrets, ModelGateway, OpenAICompatibleAdapter } = await import(`${manifest.runtimePath}/packages/model-gateway/src/index.ts`);
    const settings = loadModelStore('data/model-settings.json');
    const connection = connectionOf(activeChannel(settings), settings.source);
    assert.equal(connection.planningModel, 'gpt-5.6-luna');
    assert.ok(settings.channels.every(channel => !channel.fallback));
    const endpoint = connection.endpoint.replace(/\/$/, '').replace(/(?:\/v1)?$/, '/v1');
    for (const request of manifest.requests) {
      const output = path.join(control, `${request.area}-result.json`);
      if (fs.existsSync(output)) { assert.equal(read(output).status, 'completed', 'Preserve and inspect incomplete attempts'); continue; }
      const ledger = new UsageLedger(Infinity, undefined, { maxCalls: 2 });
      const gateway = new ModelGateway(new Map([['openai-compatible', new OpenAICompatibleAdapter(fetch, connection.timeoutMs, true)]]), ledger);
      const planner = new JsonDesignPlanner({ complete: async call => (await gateway.complete({
        role: call.role ?? 'reviewing', model: connection.planningModel, system: call.system,
        user: call.user, maxOutputTokens: call.maxOutputTokens, responseFormat: 'json', temperature: 0.2,
      }, 'openai-compatible', { endpoint, apiKey: connection.apiKey })).text });
      const state = { status: 'running', startedAt: new Date().toISOString(), pid: process.pid, area: request.area,
        inputSha256: request.inputSha256, model: connection.planningModel, fallback: false, maxCalls: 2,
        productionWrites: 0, formalAcceptance: false };
      fs.writeFileSync(output, JSON.stringify(state), { flag: 'wx' });
      try { state.result = await planner.reviewDesignContent(read(request.inputPath)); state.status = 'completed'; }
      catch (error) { state.status = 'failed'; state.failure = { error: String(redactSecrets(error.message)), modelResponses: error.modelResponses ?? [] }; }
      state.finishedAt = new Date().toISOString();
      state.usage = ledger.summary();
      fs.writeFileSync(`${output}.pending`, JSON.stringify(state, null, 2));
      fs.renameSync(`${output}.pending`, output);
      console.log(JSON.stringify({ area: request.area, status: state.status, calls: state.usage.calls,
        checks: state.result?.checks.map(({ criterion, verdict, explanation }) => ({ criterion, verdict, explanation })), error: state.failure?.error }));
      assert.equal(state.status, 'completed', 'Inspect saved failure before further calls');
    }
  } else {
    const savedInputs = read(manifest.savedInputsPath);
    const previousInputs = read('data/audit-runtimes/design68-review/inputs.json');
    assert.equal(fileHash('data/audit-runtimes/design68-review/inputs.json'), baseline.inputsSha256);
    const changedSources = savedInputs.world.sources.filter(source => source.text !== previousInputs.world.sources.find(item => item.id === source.id)?.text)
      .map(source => ({ id: source.id, sha256: sha(source.text), reviewedIn: manifest.requests.filter(request => request.sources.some(item => item.id === source.id)).map(request => request.area) }));
    assert.deepEqual(changedSources.map(source => source.id).sort(), [
      'world/artifacts/art_03', 'story/characters/char_04', 'story/chapterPlans/chapter-plan-23',
      'plan/milestones/ms_v2_boundary', 'plan/chapters/23',
    ].sort());
    assert.ok(changedSources.every(source => source.reviewedIn.length));
    const results = [];
    for (const request of manifest.requests) {
      const output = path.join(control, `${request.area}-result.json`), state = read(output);
      assert.equal(state.status, 'completed');
      assert.equal(state.inputSha256, request.inputSha256);
      const input = read(request.inputPath);
      for (const source of input.sources) assert.deepEqual(source, savedInputs[request.area].sources.find(item => item.id === source.id));
      let cursor = 0;
      const planner = new JsonDesignPlanner({ complete: async () => {
        assert.ok(cursor < state.result.modelResponses.length);
        return state.result.modelResponses[cursor++];
      } });
      assert.deepEqual(await planner.reviewDesignContent(input), state.result);
      assert.equal(cursor, state.result.modelResponses.length);
      results.push({ area: request.area, inputSha256: request.inputSha256, output, outputSha256: fileHash(output),
        modelCalls: state.usage.calls, responsesReplayed: cursor, result: state.result });
    }
    const protectedAfter = await checkProduction();
    assert.deepEqual(protectedAfter, manifest.protectedBefore);
    const proof = { ...manifest, verifiedAt: new Date().toISOString(), manifestPath, manifestSha256: fileHash(manifestPath),
      results, changedSources, protectedAfter, originalSourcesUnchanged: true, allResponsesReplayed: true,
      modelCalls: results.reduce((sum, result) => sum + result.modelCalls, 0), replayModelCalls: 0 };
    fs.writeFileSync('docs/audits/2026-10-17-design68-focused-review.json', JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ verified: true, modelCalls: proof.modelCalls, protectedAfter, productionWrites: 0 }));
  }
}
