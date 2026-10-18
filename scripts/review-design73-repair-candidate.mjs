// Scoped model review for the unapplied design73 repair candidate.
// It writes review artifacts only; it never saves a work or approves prose.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const candidate = JSON.parse(fs.readFileSync('data/design-candidates/design73-repairs-v4.json'));
const proof = JSON.parse(fs.readFileSync('docs/audits/2026-10-18-design73-repairs-v4-candidate.json'));
assert.equal(createHash('sha256').update(JSON.stringify(candidate)).digest('hex'), proof.candidateSha256);
const control = 'data/audit-runtimes/design73-repair-v4-review';
fs.mkdirSync(control, { recursive: true });
const sha = value => createHash('sha256').update(value).digest('hex');
const source = (id, value) => ({ id, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) });
const planMilestone = id => candidate.plan.milestones.find(item => item.id === id);
const planChapter = n => candidate.plan.chapters.find(item => item.chapterNumber === n);
const bibleChapter = n => candidate.storyBible.chapterPlans.find(item => item.chapterNumber === n);
const worldRealm = id => candidate.worldPack.realms.find(item => item.id === id);
const worldTechnique = id => candidate.worldPack.techniques.find(item => item.id === id);
const worldResource = id => candidate.worldPack.resources.find(item => item.id === id);
const scope = { worldPackRevision: 37, storyBibleRevision: 69, planRevisionId: proof.basePlanId, planRevision: 72 };

const common = [
  source('candidate/overview', { workId: proof.workId, basePlanId: proof.basePlanId, changes: proof.changes,
    limitation: '这是尚未保存的候选修订；历史事实与正文均未因候选文字而自动实现。' }),
  source('plan/overview', { targetChapterCount: candidate.plan.targetChapterCount, volumeCount: candidate.plan.volumeCount,
    mainConflict: candidate.plan.mainConflict, theme: candidate.plan.theme, protagonistArc: candidate.plan.protagonistArc,
    endingDirection: candidate.plan.endingDirection }),
  source('story/overview', { coreConflict: candidate.storyBible.coreConflict, endingDirection: candidate.storyBible.endingDirection,
    promises: candidate.storyBible.promises, openThreads: candidate.storyBible.openThreads }),
];
const requests = {
  world: {
    sources: [
      ...common,
      source('world/realms/realm_03', worldRealm('realm_03')),
      source('world/techniques/tech_19', worldTechnique('tech_19')),
      source('world/resources/res_01', worldResource('res_01')),
      source('world/factions/fac_02', candidate.worldPack.factions.find(item => item.id === 'fac_02')),
      source('world/factions/fac_08', candidate.worldPack.factions.find(item => item.id === 'fac_08')),
      source('story/characters/char_14', candidate.storyBible.characters.find(item => item.id === 'char_14')),
      source('plan/chapters/29-31', [29, 30, 31].map(planChapter)),
      source('story/chapterPlans/29-31', [29, 30, 31].map(bibleChapter)),
      source('plan/milestones/ms_growth_v1_aftermath', planMilestone('ms_growth_v1_aftermath')),
      source('plan/milestones/ms_growth_v1_crossing', planMilestone('ms_growth_v1_crossing')),
    ],
    rubric: {
      geography: '只评审第29—31章新增的实体通行许可、签发/验放责任、有效期、货物与人员范围、山路和港务费用支付。必须区分商盟引荐、护货合同、内陆文牒、港务验籍、复验费和船费；不能用境界、关系或一句“合同负责”替代实际证件、实付和核验。',
      history: '只检查新增行政与付款安排是否与现有势力权限、程记责任、林辰当时知情边界和既有时间线相容；不能把候选安排冒认成已发生正文。',
      pacing: '检查新增账目能否在第29—31章的场景中实际完成，是否引入无来源的瞬时办理、未定义的免费资源或不必要的新角色；指出会阻塞写作的具体缺口。',
    },
  },
  power: {
    sources: [
      ...common,
      source('world/realms/realm_03', worldRealm('realm_03')),
      source('world/techniques/tech_04', worldTechnique('tech_04')),
      source('world/techniques/tech_19', worldTechnique('tech_19')),
      source('world/resources/res_01', worldResource('res_01')),
      source('plan/chapters/48', planChapter(48)),
      source('story/chapterPlans/48', bibleChapter(48)),
      source('plan/milestones/ms_v2_boundary', planMilestone('ms_v2_boundary')),
      source('plan/milestones/ms_v3_training', planMilestone('ms_v3_training')),
      source('plan/milestones/ms_v3_advancement', planMilestone('ms_v3_advancement')),
      source('plan/milestones/ms_v3_convoy', planMilestone('ms_v3_convoy')),
    ],
    rubric: {
      tiers: '检查玄府的辟建丹府门槛是否有明确功法、资源、训练周期、失败后果、静置、医修诊察、元罡承载复核以及与十元载支付的先后；不能因境界名或时间经过自动晋阶，也不能把新增训练写成既有人物已掌握。',
      costs: '检查tech_19六周期灵石账、第48章半成低流量试注、tech_04完整剑诀二成、元罡/真元余额、冷却、失败和中断后果是否分开记账；诊断不得免费施术，法力不得替代寿储、神识或伤情许可。',
      counters: '逐场检查第61—66和88—95反制动作卡是否固定对象与材质、距离和可见路径、蓄势/间隔、费用、受击次数、伤后余量、近身打断、遮挡和撤退分支；不能以属性克制、已付成本或车角遮挡自动保证命中、挡击、救人或获胜。',
    },
  },
  characters: {
    sources: [
      ...common,
      source('story/chapterPlans/bible-chapter-33', bibleChapter(33)),
      source('plan/chapters/33', planChapter(33)),
      source('story/chapterPlans/bible-chapter-34-35', candidate.storyBible.chapterPlans.filter(item => [34, 35].includes(item.chapterNumber))),
      source('story/secrets/sec_04', candidate.storyBible.secrets.find(item => item.id === 'sec_04') ?? 'sec_04 未在当前局部候选中提供；不得据摘要补写。'),
    ],
    rubric: {
      knowledge: '只检查第33章林辰的知情边界。林辰只能知道实体现场、交班记录和后来当面/册页来源；读者独立侧门视角不得回写他的endHook。确认第34章常钧当面说明、第35章侧门册核验的时点是否与候选一致。',
      agency: '检查删去越界知情后，林辰、常钧、严涛、陆沉川和苏凌霜是否仍有各自行动与选择；不能用修复知识项抹掉实际责任或把独立视角改成主角全知。',
      relationships: '检查第33章信息延后是否破坏林辰与苏、程记、船方和承运人的关系递进；应指出需要在正文中保留的证据、交班或后续对质。',
    },
  },
};

const inputs = {};
for (const [area, request] of Object.entries(requests)) {
  const input = { area, scope, inputHash: sha(JSON.stringify({ area, scope, sources: request.sources, rubric: request.rubric })), sources: request.sources, rubric: request.rubric };
  inputs[area] = input;
  fs.writeFileSync(`${control}/${area}-input.json`, JSON.stringify(input, null, 2) + '\n');
}
fs.writeFileSync(`${control}/manifest.json`, JSON.stringify({ createdAt: new Date().toISOString(), candidateSha256: proof.candidateSha256,
  inputs: Object.fromEntries(Object.entries(inputs).map(([area, input]) => [area, { path: `${control}/${area}-input.json`, sha256: sha(JSON.stringify(input, null, 2) + '\n'), inputHash: input.inputHash }])) }, null, 2) + '\n');

const { loadModelStore, activeChannel, connectionOf } = await import('../data/audit-runtimes/design72-runtime/apps/api/src/model-settings.ts');
const { UsageLedger, redactSecrets, ModelGateway, OpenAICompatibleAdapter } = await import('../data/audit-runtimes/design72-runtime/packages/model-gateway/src/index.ts');
const { JsonDesignPlanner } = await import('../data/audit-runtimes/design72-runtime/packages/planner/src/index.ts');
const settings = loadModelStore('data/model-settings.json');
const connection = connectionOf(activeChannel(settings), settings.source);
assert.equal(connection.planningModel, 'gpt-5.6-luna');
assert.ok(settings.channels.every(channel => !channel.fallback));
const endpoint = connection.endpoint.replace(/\/$/, '').replace(/(?:\/v1)?$/, '/v1');
const ledger = new UsageLedger(Infinity, undefined, { maxCalls: 8 });
const gateway = new ModelGateway(new Map([['openai-compatible', new OpenAICompatibleAdapter(fetch, connection.timeoutMs, true)]]), ledger);

for (const [area, input] of Object.entries(inputs)) {
  const outputPath = `${control}/${area}-result.json`;
  assert.ok(!fs.existsSync(outputPath));
  const state = { area, inputHash: input.inputHash, candidateSha256: proof.candidateSha256, model: connection.planningModel,
    fallback: false, maxCalls: 8, status: 'running', startedAt: new Date().toISOString(), rawResponses: [], modelCalls: 0,
    productionWrites: 0, formalAcceptance: false };
  const save = () => fs.writeFileSync(outputPath, JSON.stringify(state, null, 2) + '\n');
  save();
  const planner = new JsonDesignPlanner({ complete: async call => {
    const response = await gateway.complete({ role: call.role ?? 'reviewing', model: connection.planningModel,
      system: call.system, user: call.user, maxOutputTokens: call.maxOutputTokens, responseFormat: 'json', temperature: 0.2 },
      'openai-compatible', { endpoint, apiKey: connection.apiKey });
    state.rawResponses.push(response.text); state.modelCalls += 1; state.usage = ledger.summary(); save(); return response.text;
  } });
  try { state.result = await planner.reviewDesignContent(input); state.status = 'completed'; }
  catch (error) { state.status = 'failed'; state.failure = { error: String(redactSecrets(error.message)), modelResponses: error.modelResponses ?? [] }; }
  state.finishedAt = new Date().toISOString(); state.usage = ledger.summary(); save();
  assert.equal(state.status, 'completed', JSON.stringify(state.failure));
  console.log(JSON.stringify({ area, status: state.status, modelCalls: state.modelCalls,
    checks: state.result.checks.map(({ criterion, verdict, explanation }) => ({ criterion, verdict, explanation })) }));
}
console.log(JSON.stringify({ status: 'completed', candidateSha256: proof.candidateSha256, usage: ledger.summary(), productionWrites: 0, formalAcceptance: false }));
