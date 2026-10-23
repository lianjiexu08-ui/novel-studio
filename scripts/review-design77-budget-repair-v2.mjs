// Read-only model review for the detached chapter-31 ledger repair.
// It records raw calls and never mutates production state.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = p => JSON.parse(fs.readFileSync(p));
const hashText = value => createHash('sha256').update(value).digest('hex');
const hash = value => hashText(JSON.stringify(value));
const candidate = read('data/design-candidates/design77-budget-repair-v2.json');
const proof = read('docs/audits/2026-10-23-design77-budget-repair-v2-candidate.json');
assert.equal(hash(candidate), proof.candidateSha256);
const control = 'data/audit-runtimes/design77-budget-repair-v2-review';
assert.ok(!fs.existsSync(`${control}/result.json`));
fs.mkdirSync(`${control}/model-calls`, { recursive: true });
const save = (file, value) => fs.writeFileSync(`${control}/${file}`, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', flush: true });
const source = (id, value) => ({ id, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) });
const planChapter = n => candidate.plan.chapters.find(item => item.chapterNumber === n);
const bibleChapter = n => candidate.storyBible.chapterPlans.find(item => item.chapterNumber === n);
const inputBase = {
  area: 'story', scope: { worldPackRevision: 41, storyBibleRevision: 73, planRevisionId: proof.basePlanId, planRevision: 77 },
  sources: [
    source('candidate/overview', { workId: proof.workId, basePlanId: proof.basePlanId, changes: proof.changes, limitation: '候选尚未写入生产，不能当作正文事实。' }),
    source('review/prior-finding', { criterion: 'causality', priorVerdict: 'revise', finding: '第31章cost写验货费扣当次奖金，但场景又写六枚基础劳务先抵舱费四枚、再抵复验费半枚、余一枚半；第33—39章另签轻役总酬六枚并结算为三枚，需逐笔区分。' }),
    source('plan/chapters/29', planChapter(29)), source('plan/chapters/31', planChapter(31)),
    source('plan/chapters/33', planChapter(33)), source('plan/chapters/37', planChapter(37)), source('plan/chapters/39', planChapter(39)),
    source('plan/milestones/ms_v2_loss', candidate.plan.milestones.find(item => item.id === 'ms_v2_loss')),
    source('story/chapterPlans/31', bibleChapter(31)), source('story/chapterPlans/33', bibleChapter(33)),
    source('story/chapterPlans/37', bibleChapter(37)), source('story/chapterPlans/39', bibleChapter(39)),
  ],
  rubric: {
    causality: '只核第29、31、33、37、39章现金账户的定义、来源、日期、付款方和余额。必须区分第31章本航次基础护货劳务六枚（舱费四枚、复验费半枚、加急奖金不计，最终一枚半）、程记账户支付的港务验籍费、第33章217—230日另签轻役总酬六枚（租符两枚、药费一枚、净三枚）和未到账追偿。每一笔只能扣一次，不能将第31章一枚半与后段三枚混算，也不能把候选文字冒认正文；仍有冲突判revise，材料不足判insufficient。',
    timeline: '核第31章214日、第33章217日、第37章225夜、第39章230日的支付与结算顺序，禁止预支未来收入。',
    growth: '仅检查账目修复是否保持林辰的伤势、轻役限制、选择和后果，不把钱账误写成修炼能力或寿储收入。',
  },
};
const input = { ...inputBase, inputHash: hash(inputBase) };
save('input.json', input);
const binding = read('data/audit-runtimes/design77-navigation-runtime-bound.json');
const { loadModelStore, activeChannel, connectionOf } = await import(`${binding.runtimePath}/apps/api/src/model-settings.ts`);
const { UsageLedger, redactSecrets, ModelGateway, OpenAICompatibleAdapter } = await import(`${binding.runtimePath}/packages/model-gateway/src/index.ts`);
const { JsonDesignPlanner } = await import(`${binding.runtimePath}/packages/planner/src/index.ts`);
const settings = loadModelStore('data/model-settings.json'), connection = connectionOf(activeChannel(settings), settings.source);
assert.equal(connection.planningModel, 'gpt-5.6-luna'); assert.ok(settings.channels.every(channel => !channel.fallback));
const endpoint = connection.endpoint.replace(/\/$/, '').replace(/(?:\/v1)?$/, '/v1');
const ledger = new UsageLedger(Infinity, undefined, { maxCalls: 2 });
const gateway = new ModelGateway(new Map([['openai-compatible', new OpenAICompatibleAdapter(fetch, connection.timeoutMs, true)]]), ledger);
const state = { status: 'running', model: connection.planningModel, fallback: false, candidateSha256: proof.candidateSha256, inputHash: input.inputHash, productionWrites: 0, formalAcceptance: false, calls: 0, startedAt: new Date().toISOString() };
save('result.json', state);
const planner = new JsonDesignPlanner({ complete: async request => {
  const number = ++state.calls, prefix = `model-calls/${String(number).padStart(5, '0')}`;
  const sent = { role: request.role ?? 'reviewing', model: connection.planningModel, system: request.system, user: request.user, maxOutputTokens: request.maxOutputTokens, responseFormat: 'json', temperature: 0.2 };
  save(`${prefix}.started.json`, { number, request: sent, at: new Date().toISOString() });
  try {
    const response = await gateway.complete(sent, 'openai-compatible', { endpoint, apiKey: connection.apiKey });
    save(`${prefix}.response.json`, { number, response, usage: ledger.summary(), at: new Date().toISOString() });
    return response.text;
  } catch (error) {
    save(`${prefix}.failure.json`, { number, error: String(redactSecrets(error.message)), usage: ledger.summary(), at: new Date().toISOString() });
    throw error;
  }
} });
try { state.result = await planner.reviewDesignContent(input); state.status = 'completed'; }
catch (error) { state.status = 'failed'; state.failure = { error: String(redactSecrets(error.message)), modelResponses: error.modelResponses ?? [] }; }
state.usage = ledger.summary(); state.finishedAt = new Date().toISOString();
fs.writeFileSync(`${control}/result.pending.json`, JSON.stringify(state, null, 2) + '\n'); fs.renameSync(`${control}/result.pending.json`, `${control}/result.json`);
console.log(JSON.stringify({ status: state.status, candidateSha256: proof.candidateSha256, modelCalls: state.calls, productionWrites: 0, formalAcceptance: false, checks: state.result?.checks?.map(({ criterion, verdict, awaitingSources, resolves }) => ({ criterion, verdict, awaitingSources, resolves })) }));
